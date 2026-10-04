//! OpenRouter provider (architecture.md §7) — OpenAI-compatible chat
//! completions endpoint, one API key for 200+ models across providers.

use crate::ai::{describe_error, AiError, AiProvider, AiResponse, GenOpts, ProviderStatus};
use std::time::Duration;

pub struct OpenRouterProvider {
    pub api_key: String,
    pub model: String,
}

impl AiProvider for OpenRouterProvider {
    fn generate(&self, prompt: &str, opts: &GenOpts) -> Result<AiResponse, AiError> {
        if self.api_key.is_empty() {
            return Err(AiError::NotConfigured(
                "No OpenRouter API key is set. Add one in Settings → AI.".to_string(),
            ));
        }

        let body = serde_json::json!({
            "model": self.model,
            "messages": [{ "role": "user", "content": prompt }],
            "temperature": opts.temperature,
            "max_tokens": opts.max_output_tokens,
        });

        let client = reqwest::blocking::Client::builder()
            // Same reasoning as gemini.rs — no default timeout means a
            // stalled connection either hangs indefinitely or gets killed
            // by an intermediate proxy, surfacing as an opaque "error
            // decoding response body" rather than a clear timeout.
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|e| AiError::Internal(format!("Couldn't build OpenRouter HTTP client: {}", describe_error(&e))))?;
        let resp = client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .map_err(|e| AiError::Network(format!("Couldn't reach OpenRouter: {}", describe_error(&e))))?;

        let status = resp.status();
        let text_body = resp
            .text()
            .map_err(|e| AiError::Network(format!("Couldn't read OpenRouter's response: {}", describe_error(&e))))?;

        if !status.is_success() {
            return Err(AiError::ProviderError {
                provider: "OpenRouter".to_string(),
                message: friendly_error_message(status.as_u16(), &self.model, &text_body),
            });
        }

        let parsed: serde_json::Value = serde_json::from_str(&text_body)
            .map_err(|e| AiError::InvalidResponse(format!("OpenRouter returned unparseable JSON: {e}")))?;

        // choices can legitimately be an empty array (e.g. a moderation/
        // refusal response), and message.content can be present-but-empty
        // rather than absent — .as_str() alone can't tell "missing" apart
        // from "empty string", so both used to silently produce "" and
        // flow downstream as if generation had succeeded.
        let finish_reason = parsed["choices"][0]["finish_reason"].as_str().unwrap_or("");
        let text = parsed["choices"][0]["message"]["content"].as_str().unwrap_or("");

        if text.is_empty() {
            let message = if finish_reason == "length" {
                format!(
                    "The model used its entire output budget ({} tokens) without producing a response \
                     (finish_reason: length). Raise \"Max output tokens\" in Settings → AI and try again.",
                    opts.max_output_tokens
                )
            } else if finish_reason == "content_filter" {
                "The model declined to respond (finish_reason: content_filter).".to_string()
            } else {
                // Capture a bounded snippet of the raw body so a future
                // occurrence of this error is self-diagnosing without
                // needing to reproduce it.
                let snippet: String = text_body.chars().take(500).collect();
                format!(
                    "OpenRouter's response had no message content (finish_reason: {}). Raw response (truncated): {snippet}",
                    if finish_reason.is_empty() { "unknown" } else { finish_reason }
                )
            };
            return Err(AiError::InvalidResponse(message));
        }
        let text = text.to_string();

        let input_tokens = parsed["usage"]["prompt_tokens"].as_u64().map(|n| n as u32);
        let output_tokens = parsed["usage"]["completion_tokens"].as_u64().map(|n| n as u32);
        // Opportunistic only: some OpenRouter responses include a real
        // per-request cost in `usage.cost`. If it's absent, this stays
        // None — never computed from a hard-coded price table.
        let estimated_cost_usd = parsed["usage"]["cost"].as_f64();

        Ok(AiResponse {
            text,
            model: self.model.clone(),
            input_tokens,
            output_tokens,
            estimated_cost_usd,
        })
    }

    fn check_status(&self) -> ProviderStatus {
        if self.api_key.is_empty() {
            ProviderStatus::NotConfigured
        } else {
            ProviderStatus::Connected
        }
    }
}

fn friendly_error_message(status: u16, model: &str, raw_body: &str) -> String {
    let provider_message = serde_json::from_str::<serde_json::Value>(raw_body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()));

    match status {
        401 => "OpenRouter rejected the API key. Check the key in Settings → AI.".to_string(),
        402 => {
            "OpenRouter credits are exhausted for this model. Switch to a free model, or add credits at \
             openrouter.ai."
                .to_string()
        }
        404 => format!("Model '{model}' was not found on OpenRouter. Check the model ID in Settings → AI."),
        429 => "OpenRouter rate limit exceeded. Try again shortly.".to_string(),
        _ => provider_message.unwrap_or_else(|| format!("OpenRouter returned an error (status {status}).")),
    }
}

/// Is `model` confirmed to cost $0? Used by the router to guarantee a $0
/// spending limit never calls a paid OpenRouter model — never assumed,
/// always checked. Fast-paths the two well-known free naming conventions
/// (OpenRouter's own "openrouter/free" router, and the ":free" suffix used
/// across free-tier models) so the common case needs no network round
/// trip; anything else is checked against OpenRouter's public pricing
/// endpoint (no auth required), and treated as NOT free if it can't be
/// confirmed — never assumed free on missing/ambiguous data.
pub fn is_free_model(model: &str) -> Result<bool, AiError> {
    if model == "openrouter/free" || model.ends_with(":free") {
        return Ok(true);
    }

    // Lightweight metadata fetch (not a generation call) — a short timeout
    // is enough, and failing fast here matters since this runs as part of
    // the router's decision path, not just on explicit user action.
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AiError::Internal(format!("Couldn't build OpenRouter HTTP client: {}", describe_error(&e))))?;
    let resp = client
        .get("https://openrouter.ai/api/v1/models")
        .send()
        .map_err(|e| AiError::Network(format!("Couldn't check OpenRouter model pricing: {}", describe_error(&e))))?;
    let body: serde_json::Value = resp
        .json()
        .map_err(|e| AiError::Network(format!("Couldn't read OpenRouter's model list: {}", describe_error(&e))))?;
    let models = body["data"]
        .as_array()
        .ok_or_else(|| AiError::InvalidResponse("OpenRouter's model list had an unexpected shape.".to_string()))?;

    let found = models.iter().find(|m| m["id"].as_str() == Some(model));
    match found {
        Some(m) => {
            let prompt_price = m["pricing"]["prompt"].as_str().unwrap_or("");
            let completion_price = m["pricing"]["completion"].as_str().unwrap_or("");
            Ok(prompt_price == "0" && completion_price == "0")
        }
        // Model not found in the public list — never assume free.
        None => Ok(false),
    }
}
