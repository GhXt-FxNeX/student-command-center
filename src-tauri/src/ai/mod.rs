//! AI provider abstraction (Phase 6 — architecture.md §5).
//!
//! The rest of the app talks to `router::route()` + a provider's
//! `generate()`, never to Gemini/OpenRouter HTTP details directly.
//! No feature-specific prompts or schemas live here yet — per the roadmap
//! (architecture.md §10, phase 6), this phase is plumbing plus a single
//! generic "test call" so the pipeline is provably wired end to end.
//! Feature-specific prompt templates and structured-output schemas start
//! in Phase 7.

pub mod keychain;
pub mod prompts;
pub mod providers;
pub mod router;
pub mod usage;

use serde::Serialize;

/// Generation parameters. Always sourced from user_settings (temperature,
/// max output tokens) — never hard-coded in a provider — so changing them
/// never requires a rebuild.
#[derive(Debug, Clone)]
pub struct GenOpts {
    pub temperature: f64,
    pub max_output_tokens: u32,
}

/// A successful provider response. Token counts and cost are `Option`
/// because not every provider/response reports them — a missing value is
/// never displayed as 0 or guessed at (architecture.md §10: "Never
/// fabricate quota information").
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub text: String,
    pub model: String,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    /// Only ever `Some` when the provider's own response reports a real
    /// cost figure. Never computed from a hard-coded $/token table here —
    /// published model pricing changes too often to trust a baked-in
    /// constant, and a silently-wrong cost figure is worse than an honest
    /// "unavailable".
    pub estimated_cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderStatus {
    /// Configured (has an API key, or — for Local — reachable) and ready.
    Connected,
    /// No API key set.
    NotConfigured,
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("{0}")]
    NotConfigured(String),
    #[error("{0}")]
    BudgetExceeded(String),
    #[error("{0}")]
    NoProviderAvailable(String),
    #[error("Network error: {0}")]
    Network(String),
    #[error("{message}")]
    ProviderError { provider: String, message: String },
    #[error("{0}")]
    InvalidResponse(String),
    #[error("{0}")]
    Internal(String),
}

/// Lets AiError cross into the rest of the codebase's `Result<T, String>`
/// convention (used by every Tauri command) via the `?` operator, without
/// every call site needing its own `.map_err(|e| e.to_string())`.
impl From<AiError> for String {
    fn from(e: AiError) -> String {
        e.to_string()
    }
}

/// Implemented once per backend (Gemini, OpenRouter). Phase 8c removed
/// the third backend this used to say (Local/Ollama) — see
/// ai/router.rs's module comment for why.
/// Deliberately synchronous (`reqwest::blocking`) rather than `async fn` —
/// avoids pulling in `async-trait` for three HTTP-calling methods, since
/// nothing here is ever used as `dyn AiProvider` (always called on a
/// concrete provider struct). Callers must run these from inside
/// `tokio::task::spawn_blocking`, never directly from a plain (non-async)
/// Tauri command: Tauri v2 runs non-async commands on the *main* thread by
/// default (only `async fn` commands are moved off it), and
/// `reqwest::blocking` panics if called from inside an active async
/// runtime context. See commands/ai.rs for the pattern.
pub trait AiProvider {
    fn generate(&self, prompt: &str, opts: &GenOpts) -> Result<AiResponse, AiError>;
    /// Cheap, no-request-spent check ("is this configured/reachable"), not
    /// a real generation call — an actual "is this key valid" probe would
    /// itself cost a request for some providers.
    fn check_status(&self) -> ProviderStatus;
}

/// Formats an error together with its full `.source()` chain.
///
/// `reqwest::Error`'s `Display` alone is often too shallow to diagnose
/// anything — e.g. a dropped connection, a truncated response body, or a
/// malformed chunked-encoding frame all surface as the bare string "error
/// decoding response body" with no indication of what actually happened
/// underneath. The real cause lives in `.source()` (a `hyper`/`h2`/io
/// error), which reqwest's `Display` doesn't include. Every provider's
/// network-error sites use this instead of a bare `{e}` so a failure like
/// that is diagnosable from the error message alone, not just a generic
/// label.
pub fn describe_error(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut source = e.source();
    while let Some(s) = source {
        parts.push(s.to_string());
        source = s.source();
    }
    parts.join(" — caused by: ")
}
