//! Gemini provider (Flash + Pro tiers — architecture.md §6).
//!
//! Model IDs are never hard-coded here: `model` comes from user_settings
//! (`ai_gemini_flash_model` / `ai_gemini_pro_model`), which the router
//! resolves before constructing this struct. Gemini model names change
//! every few months, so a stale hard-coded name would silently break this
//! provider — configurability is the fix, not a "best effort" guess.

use crate::ai::{describe_error, AiError, AiProvider, AiResponse, GenOpts, ProviderStatus};
use std::time::Duration;

pub struct GeminiProvider {
    pub api_key: String,
    pub model: String,
}

impl AiProvider for GeminiProvider {
    fn generate(&self, prompt: &str, opts: &GenOpts) -> Result<AiResponse, AiError> {
        if self.api_key.is_empty() {
            return Err(AiError::NotConfigured(
                "No Gemini API key is set. Add one in Settings → AI.".to_string(),
            ));
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            self.model
        );
        let body = serde_json::json!({
            "contents": [{ "parts": [{ "text": prompt }] }],
            "generationConfig": {
                "temperature": opts.temperature,
                "maxOutputTokens": opts.max_output_tokens,
            }
        });

        let client = reqwest::blocking::Client::builder()
            // No default timeout on reqwest::blocking::Client::new() means
            // a stalled connection can hang indefinitely, or get killed
            // by an intermediate proxy after some idle period — which then
            // surfaces as an opaque "error decoding response body" rather
            // than a clear timeout. 90s comfortably covers normal
            // generation latency (including "thinking" time on reasoning
            // models) without hanging forever.
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|e| AiError::Internal(format!("Couldn't build Gemini HTTP client: {}", describe_error(&e))))?;
        let resp = client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| AiError::Network(format!("Couldn't reach Gemini: {}", describe_error(&e))))?;

        let status = resp.status();
        let text_body = resp
            .text()
            .map_err(|e| AiError::Network(format!("Couldn't read Gemini's response: {}", describe_error(&e))))?;

        if !status.is_success() {
            return Err(AiError::ProviderError {
                provider: "Gemini".to_string(),
                message: friendly_error_message(status.as_u16(), &self.model, &text_body),
            });
        }

        let parsed: serde_json::Value = serde_json::from_str(&text_body)
            .map_err(|e| AiError::InvalidResponse(format!("Gemini returned unparseable JSON: {e}")))?;

        let finish_reason = parsed["candidates"][0]["finishReason"].as_str().unwrap_or("");
        let text = parsed["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .unwrap_or("");

        if text.is_empty() {
            // A present-but-empty "text" is NOT the same as a missing one —
            // .as_str() alone can't tell them apart, so both used to
            // silently produce "" and flow downstream as if generation had
            // succeeded (this is what caused the "Response wasn't valid
            // JSON: expected value at line 1 column 1" error: an empty
            // string handed straight to serde_json).
            //
            // MAX_TOKENS with empty text is a well-documented Gemini 2.5+/
            // 3.x behavior: "thinking" tokens count against maxOutputTokens
            // by default, and a long prompt can exhaust the whole budget on
            // internal reasoning before any visible output is produced,
            // still returning HTTP 200. Distinguish that case with a
            // specific, actionable message rather than a generic one.
            let message = if finish_reason == "MAX_TOKENS" {
                format!(
                    "Gemini used its entire output budget ({} tokens) on internal reasoning before writing a \
                     visible response (finishReason: MAX_TOKENS). Raise \"Max output tokens\" in Settings → AI \
                     and try again.",
                    opts.max_output_tokens
                )
            } else if finish_reason == "SAFETY" || finish_reason == "PROHIBITED_CONTENT" {
                format!("Gemini declined to respond (finishReason: {finish_reason}).")
            } else {
                // Capture a bounded snippet of the raw body so a future
                // occurrence of this error is self-diagnosing without
                // needing to reproduce it — never logged/stored anywhere
                // else in this pipeline (see ai/mod.rs's AiError doc).
                let snippet: String = text_body.chars().take(500).collect();
                format!(
                    "Gemini's response had no text (finishReason: {}). Raw response (truncated): {snippet}",
                    if finish_reason.is_empty() { "unknown" } else { finish_reason }
                )
            };
            return Err(AiError::InvalidResponse(message));
        }
        let text = text.to_string();

        let input_tokens = parsed["usageMetadata"]["promptTokenCount"].as_u64().map(|n| n as u32);
        let output_tokens = parsed["usageMetadata"]["candidatesTokenCount"].as_u64().map(|n| n as u32);

        Ok(AiResponse {
            text,
            model: self.model.clone(),
            input_tokens,
            output_tokens,
            // Gemini's API doesn't return a cost figure — never guessed
            // from a hard-coded $/token table (see ai/mod.rs doc comment).
            estimated_cost_usd: None,
        })
    }

    fn check_status(&self) -> ProviderStatus {
        if self.api_key.is_empty() {
            ProviderStatus::NotConfigured
        } else {
            // Presence of a key is all that's checkable without spending a
            // real request — see the AiProvider::check_status doc comment.
            ProviderStatus::Connected
        }
    }
}

/// Extracts Gemini's nested `error.message` when present, and adds a
/// specific, actionable hint for the status codes a user is most likely to
/// hit — a bare error body is rarely enough to know what to do next.
fn friendly_error_message(status: u16, model: &str, raw_body: &str) -> String {
    let provider_message = serde_json::from_str::<serde_json::Value>(raw_body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()));

    match status {
        404 => format!(
            "Model '{model}' was not found. Gemini model names change often — check the model name \
             in Settings against Google's current API docs and update it there."
        ),
        401 | 403 => "Gemini rejected the API key. Check the key in Settings → AI.".to_string(),
        429 => "Gemini rate limit or quota exceeded. Try again later, or switch providers in Settings.".to_string(),
        _ => provider_message.unwrap_or_else(|| format!("Gemini returned an error (status {status}).")),
    }
}
