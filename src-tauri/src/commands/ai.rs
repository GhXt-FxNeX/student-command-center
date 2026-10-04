//! Tauri commands for AI: API keys, provider status, the Phase 6 test
//! call, and usage stats.
//!
//! Every command that touches the OS keychain or the network is `async fn`
//! + `tokio::task::spawn_blocking`, never a plain `fn`. Tauri v2 runs
//! non-async commands on the *main* thread by default — only `async fn`
//! commands get moved off it — and `reqwest::blocking` panics if called
//! from inside an active async runtime context. `State<Pool>` can't be
//! captured into a `spawn_blocking` closure directly (the closure must be
//! `'static`, State is a short-lived borrow), so each command clones the
//! underlying `Pool` (cheap — it's an Arc-backed r2d2 handle) *before*
//! spawning, and only ever uses `get_settings_from_pool`/raw `Pool`
//! methods inside the closure, never the Tauri `State` wrapper itself.
//!
//! `get_ai_usage_stats` is the one exception — pure DB aggregation, no
//! network or keychain access, so it stays a plain sync `fn` like every
//! other stats command in this codebase (get_finance_stats, get_exam_stats,
//! get_study_stats).

use crate::ai::providers::{GeminiProvider, OpenRouterProvider};
use crate::ai::{keychain, router, usage, AiProvider, GenOpts};
use crate::commands::settings::get_settings_from_pool;
use crate::db::Pool;
use crate::models::{ProviderStatusInfo, TestCallResult};
use tauri::State;

// ---- API keys (OS keychain — never SQLite, never returned to the frontend) ----

/// Only ever reports whether a key is set, never the key value itself.
#[tauri::command]
pub async fn has_ai_api_key(provider: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || keychain::has_key(&provider))
        .await
        .map_err(|e| format!("Internal error: {e}"))
}

#[tauri::command]
pub async fn set_ai_api_key(provider: String, key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("API key can't be empty.".to_string());
    }
    let key = key.trim().to_string();
    tokio::task::spawn_blocking(move || keychain::set_key(&provider, &key))
        .await
        .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn delete_ai_api_key(provider: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || keychain::delete_key(&provider))
        .await
        .map_err(|e| format!("Internal error: {e}"))?
}

// ---- Provider status (🟢/🔴 indicators) ----

#[tauri::command]
pub async fn get_provider_statuses(pool: State<'_, Pool>) -> Result<Vec<ProviderStatusInfo>, String> {
    // Extract an owned, 'static Pool clone before spawning — see module
    // doc comment. This is the only thing taken from `pool` in this
    // function; everything else happens inside the closure below.
    let pool = pool.inner().clone();

    tokio::task::spawn_blocking(move || -> Result<Vec<ProviderStatusInfo>, String> {
        let settings = get_settings_from_pool(&pool)?;

        let gemini = GeminiProvider {
            api_key: keychain::get_key("gemini").unwrap_or_default(),
            model: settings.ai_gemini_flash_model.clone(),
        };
        let openrouter_provider = OpenRouterProvider {
            api_key: keychain::get_key("openrouter").unwrap_or_default(),
            model: settings.ai_openrouter_model.clone(),
        };

        Ok(vec![
            ProviderStatusInfo {
                provider: "gemini".to_string(),
                status: gemini.check_status(),
                has_key: keychain::has_key("gemini"),
            },
            ProviderStatusInfo {
                provider: "openrouter".to_string(),
                status: openrouter_provider.check_status(),
                has_key: keychain::has_key("openrouter"),
            },
            // Phase 8c: Ollama/local AI was permanently removed (see
            // ai/router.rs's module comment) — this list used to have a
            // third "local" entry here whose status came from a real
            // network probe to the Ollama server. Gone along with the
            // provider itself; Settings no longer shows a Local AI row.
        ])
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

// ---- Test call — the one user-facing AI feature Phase 6 ships, purely to
// prove routing → provider → logging works end to end. No feature-specific
// prompt lives here; that starts in Phase 7. ----

#[tauri::command]
pub async fn test_ai_connection(pool: State<'_, Pool>) -> Result<TestCallResult, String> {
    let pool = pool.inner().clone();

    tokio::task::spawn_blocking(move || -> Result<TestCallResult, String> {
        let settings = get_settings_from_pool(&pool)?;
        let conn = pool.get().map_err(|e| e.to_string())?;

        let decision = router::route(
            &conn,
            &settings,
            &router::RouteRequest {
                complexity: router::Complexity::Simple,
                privacy: router::Privacy::OkExternal,
            },
        )?;

        let opts = GenOpts {
            temperature: settings.ai_temperature,
            max_output_tokens: settings.ai_max_output_tokens as u32,
        };
        let prompt = "Reply with a single short sentence confirming you're connected and working.";

        // generate_with_fallback also handles the case where a $0-limit
        // Gemini Flash call fails with what looks like exhausted free-tier
        // quota — it retries once against a confirmed-free OpenRouter
        // model, returning whichever decision actually produced the
        // result (see ai/router.rs).
        let (decision, result) = router::generate_with_fallback(&settings, decision, prompt, &opts);

        usage::log_request(&conn, &decision.provider, &decision.model, "test_call", &result)?;

        let response = result?;
        Ok(TestCallResult {
            provider: decision.provider,
            model: decision.model,
            reason: decision.reason,
            response_text: response.text,
            input_tokens: response.input_tokens.map(|n| n as i64),
            output_tokens: response.output_tokens.map(|n| n as i64),
        })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

// ---- Usage dashboard ----
//
// Pure DB aggregation, no network/keychain — stays a plain sync fn, same
// as every other *_stats command in this codebase.

#[tauri::command]
pub fn get_ai_usage_stats(pool: State<Pool>) -> Result<usage::AiUsageStats, String> {
    let settings = get_settings_from_pool(&pool)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    usage::get_usage_stats(
        &conn,
        settings.ai_monthly_spending_limit_usd,
        &settings.ai_gemini_flash_model,
        settings.ai_pro_monthly_request_cap,
    )
}
