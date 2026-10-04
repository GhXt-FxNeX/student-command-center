//! Automatic/manual provider routing (architecture.md §9) + the cost-
//! protection gate (§11 "Never silently exceed the limit").
//!
//! `route()` always returns a *decision* (provider + model + a short
//! human-readable reason, per §64 "AI transparency"). `build_provider`/
//! `generate_via`/`generate_with_fallback` below turn a decision into an
//! actual call — kept in this file (not duplicated per-caller) since the
//! quota-exhaustion fallback logic needs to inspect the same decision the
//! router produced.

use crate::ai::providers::openrouter;
use crate::ai::{
    keychain,
    providers::{GeminiProvider, OpenRouterProvider},
    usage, AiError, AiProvider, AiResponse, GenOpts,
};
use crate::models::UserSettings;
use rusqlite::Connection;

/// Single-variant, like `Privacy` below: nothing ever asked for a "complex"
/// route, so that variant (and the Gemini Pro branch it selected) was dead code.
/// Automatic routing therefore always picks Gemini Flash; Gemini Pro is only
/// used when the person selects it manually in Settings → AI. Reintroduce a
/// second variant here if a feature genuinely needs automatic Pro routing —
/// and note it would then be subject to the Pro request cap (see `route()`).
pub enum Complexity {
    Simple,
}

/// Kept as a single-variant enum (rather than removed outright) so the
/// `RouteRequest` call sites in commands/ai.rs and commands/planner.rs
/// don't need touching for what's currently a no-op distinction — Phase
/// 8c removed the one thing this ever meaningfully affected
/// (`PreferLocal` routing to Ollama). If a genuine privacy-routing need
/// comes back (e.g. a future local-only feature that isn't Ollama), this
/// is the natural place to reintroduce a second variant.
pub enum Privacy {
    OkExternal,
}

pub struct RouteRequest {
    pub complexity: Complexity,
    pub privacy: Privacy,
}

#[derive(Clone)]
pub struct RouteDecision {
    pub provider: String, // "gemini" | "openrouter"
    pub model: String,
    /// Concise decision factors shown to the user (§64) — never the
    /// model's internal reasoning, just why this provider/model was
    /// picked.
    pub reason: String,
}

/// The single entry point the rest of the app should call. Budget
/// protection is applied uniformly to whatever gets decided — manual mode
/// is not a way to bypass the spending limit (see the check at the bottom
/// of this function).
///
/// IMPORTANT LIMITATION: Gemini's API has no "free-tier-only" request
/// mode — Google enforces the free tier via rate limits, not a flag the
/// client can set. Treating Gemini Flash as free-tier-eligible here (see
/// `is_free` below) means "this request is *intended* to stay within
/// Google's free allowance," not a cryptographic guarantee it will. If
/// billing is ever enabled on the Google Cloud project behind the API
/// key, requests beyond the free quota are auto-billed with nothing in
/// the response distinguishing that from a free one — this app has no
/// way to see or prevent that. What this app *can* and does guarantee:
/// Gemini Pro is never selected at $0 (it has no free Standard-API tier
/// at all), and a request that fails with what looks like exhausted free
/// quota falls back to a confirmed-free alternative rather than retrying
/// Gemini in a way that might get billed (see `fallback_after_quota_exhaustion`).
pub fn route(conn: &Connection, settings: &UserSettings, req: &RouteRequest) -> Result<RouteDecision, AiError> {
    let decision = if settings.ai_routing_mode == "manual" {
        resolve_manual(settings)?
    } else {
        resolve_automatic(settings, req)
    };

    let budget = usage::check_budget(conn, settings.ai_monthly_spending_limit_usd)?;

    // A confirmed-free OpenRouter model is free; Gemini Flash —
    // specifically the model configured as "Flash" in Settings, never Pro
    // — is treated as free-tier-eligible per Google's current
    // Standard-API free allowance (see the limitation note above). Both
    // bypass the spending gate; anything else, while the budget is
    // exhausted, is blocked outright — most importantly, Gemini Pro is
    // NEVER matched here, so it stays blocked at $0 exactly as before.
    let is_free = (decision.provider == "openrouter" && openrouter::is_free_model(&decision.model).unwrap_or(false))
        || (decision.provider == "gemini" && decision.model == settings.ai_gemini_flash_model);

    if budget.limit_reached && !is_free {
        return Err(AiError::BudgetExceeded(format!(
            "Your monthly AI spending limit (${:.2}) has been reached. Switch to a free OpenRouter model, \
             or raise your spending limit in Settings → AI.",
            budget.limit_usd
        )));
    }

    // Paid-tier Gemini (Pro) is also capped by REQUEST COUNT, because its dollar
    // cost is unknowable (Gemini reports no price — see usage.rs). Reaching here
    // with a paid Gemini model means the dollar gate above passed, i.e. a limit
    // above $0; at $0 Pro was already blocked. A cap of 0 disables Pro.
    if decision.provider == "gemini" && decision.model != settings.ai_gemini_flash_model {
        let used = usage::paid_gemini_requests_this_month(conn, &settings.ai_gemini_flash_model)?;
        let cap = settings.ai_pro_monthly_request_cap;
        if used >= cap {
            return Err(AiError::BudgetExceeded(format!(
                "Your monthly Gemini Pro request cap ({cap}) has been reached ({used} used this month). \
                 Switch to Gemini Flash or a free OpenRouter model, or raise the cap in Settings → AI."
            )));
        }
    }

    Ok(decision)
}

fn resolve_manual(settings: &UserSettings) -> Result<RouteDecision, AiError> {
    match settings.ai_manual_provider.as_str() {
        "gemini" => {
            let (model, tier_label) = if settings.ai_manual_gemini_tier == "pro" {
                (settings.ai_gemini_pro_model.clone(), "Pro")
            } else {
                (settings.ai_gemini_flash_model.clone(), "Flash")
            };
            Ok(RouteDecision {
                provider: "gemini".to_string(),
                model,
                reason: format!("Manually set to Gemini {tier_label}."),
            })
        }
        "openrouter" => Ok(RouteDecision {
            provider: "openrouter".to_string(),
            model: settings.ai_openrouter_model.clone(),
            reason: "Manually set to OpenRouter.".to_string(),
        }),
        other => Err(AiError::NotConfigured(format!(
            "Unknown AI provider '{other}' in Settings — pick Gemini or OpenRouter."
        ))),
    }
}

fn resolve_automatic(settings: &UserSettings, req: &RouteRequest) -> RouteDecision {
    // `req.privacy` and `req.complexity` each have exactly one possible value
    // (see their doc comments) — nothing to branch on until a genuine
    // privacy- or complexity-based destination exists again.
    let _ = (&req.privacy, &req.complexity);

    RouteDecision {
        provider: "gemini".to_string(),
        model: settings.ai_gemini_flash_model.clone(),
        reason: "Simple task, routed to Gemini Flash (fast, low-cost default).".to_string(),
    }
}

/// Constructs the concrete provider for `decision` — the single place
/// that match-on-provider-name happens for *building* a provider. Used by
/// `generate_via` below (single-shot generate) and directly by
/// commands/planner.rs (which needs a `&dyn AiProvider` to hand to
/// `generate_plan_blocks`'s own repair-retry logic, not a one-shot call).
/// Returns an error rather than silently defaulting to some provider if
/// `decision.provider` is ever a string other than the two route()
/// can actually produce — a clear error here is far safer than guessing
/// which provider/credentials to use.
pub fn build_provider(decision: &RouteDecision, _settings: &UserSettings) -> Result<Box<dyn AiProvider>, AiError> {
    match decision.provider.as_str() {
        "gemini" => Ok(Box::new(GeminiProvider {
            api_key: keychain::get_key("gemini").unwrap_or_default(),
            model: decision.model.clone(),
        })),
        "openrouter" => Ok(Box::new(OpenRouterProvider {
            api_key: keychain::get_key("openrouter").unwrap_or_default(),
            model: decision.model.clone(),
        })),
        other => Err(AiError::NotConfigured(format!("Unknown provider '{other}'."))),
    }
}

/// Constructs the concrete provider for `decision` and calls `generate()`.
/// Used for both the primary attempt and the quota-exhaustion fallback
/// retry below, so callers (commands/ai.rs) don't each need their own
/// copy of this dispatch.
pub fn generate_via(
    decision: &RouteDecision,
    settings: &UserSettings,
    prompt: &str,
    opts: &GenOpts,
) -> Result<AiResponse, AiError> {
    build_provider(decision, settings)?.generate(prompt, opts)
}

/// True if `e` looks like a rate-limit/quota-exhaustion signal — used
/// only to decide whether a $0-budget Gemini Flash failure should fall
/// back to a free alternative, never to distinguish any other error
/// class. Matches the 429 status Gemini/OpenRouter both use for this, and
/// the wording their error bodies commonly use (checked via
/// `ProviderError`'s already-friendly message — see gemini.rs/
/// openrouter.rs's `friendly_error_message`, which includes "rate limit"
/// / "quota" for exactly this case). `pub` so commands/planner.rs can
/// reuse the same check for its own (repair-retry-shaped) generation path.
pub fn looks_like_quota_exhausted(e: &AiError) -> bool {
    match e {
        AiError::ProviderError { message, .. } => {
            let m = message.to_lowercase();
            m.contains("429") || m.contains("rate limit") || m.contains("quota")
        }
        _ => false,
    }
}

/// Only called after a Gemini Flash attempt fails at $0 spending limit
/// with what looks like exhausted free-tier quota (see
/// `looks_like_quota_exhausted`) — never for Gemini Pro, which is already
/// blocked outright by the budget gate before reaching this point.
/// Returns a confirmed-free OpenRouter model if configured, else `None`
/// (in which case the caller should just surface the original error —
/// there's nothing free to fall back to). Phase 8c: this used to also
/// fall back to local AI (Ollama); that path is gone along with Ollama
/// itself.
pub fn fallback_after_quota_exhaustion(settings: &UserSettings) -> Option<RouteDecision> {
    if openrouter::is_free_model(&settings.ai_openrouter_model).unwrap_or(false) {
        return Some(RouteDecision {
            provider: "openrouter".to_string(),
            model: settings.ai_openrouter_model.clone(),
            reason: "Gemini's free tier appears exhausted — fell back to a free OpenRouter model.".to_string(),
        });
    }
    None
}

/// Runs `generate_via`, and — only when the attempt was Gemini Flash
/// specifically because the spending limit is $0, and it failed with
/// what looks like exhausted free-tier quota — retries once against
/// `fallback_after_quota_exhaustion`'s pick. Returns whichever decision
/// actually produced the result, so callers can log/display the provider
/// that was really used (requirement: usage tracking must be able to
/// tell a free-tier Gemini call apart from everything else, which starts
/// with knowing which provider actually ran).
pub fn generate_with_fallback(
    settings: &UserSettings,
    decision: RouteDecision,
    prompt: &str,
    opts: &GenOpts,
) -> (RouteDecision, Result<AiResponse, AiError>) {
    let result = generate_via(&decision, settings, prompt, opts);

    let is_free_tier_gemini_flash = decision.provider == "gemini" && decision.model == settings.ai_gemini_flash_model;

    if let Err(e) = &result {
        if is_free_tier_gemini_flash
            && settings.ai_monthly_spending_limit_usd <= 0.0
            && looks_like_quota_exhausted(e)
        {
            if let Some(fallback) = fallback_after_quota_exhaustion(settings) {
                let fallback_result = generate_via(&fallback, settings, prompt, opts);
                return (fallback, fallback_result);
            }
        }
    }

    (decision, result)
}
