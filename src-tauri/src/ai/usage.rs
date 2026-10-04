//! Cost protection + request logging (architecture.md §5 "Cost protection",
//! §9 "AI never computes stats"). All arithmetic here is plain SQL/Rust —
//! never delegated to an AI call.

use crate::ai::{AiError, AiResponse};
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct BudgetCheck {
    pub limit_usd: f64,
    pub spent_this_month_usd: f64,
    /// True whenever a paid call must not be made: either the limit is
    /// literally $0 ("never intentionally make a paid request" — the
    /// spec's explicit $0 option), or spend-to-date has reached the
    /// configured limit.
    pub limit_reached: bool,
}

pub fn check_budget(conn: &Connection, limit_usd: f64) -> Result<BudgetCheck, AiError> {
    let spent: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM ai_requests \
             WHERE status = 'success' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| AiError::Internal(format!("Couldn't check AI spending: {e}")))?;
    Ok(BudgetCheck {
        limit_usd,
        spent_this_month_usd: spent,
        limit_reached: limit_usd <= 0.0 || spent >= limit_usd,
    })
}

/// Paid-tier Gemini requests logged this month: every Gemini request to a model
/// other than the configured Flash model (i.e. Pro). Failed attempts are counted
/// too, on purpose — a request that was sent may still have been billed, and
/// this is a safety limit, so it errs towards counting. Flash (free tier) and
/// OpenRouter are not counted; OpenRouter reports a real cost and is covered by
/// the dollar limit instead. Same UTC month boundary as `check_budget`.
///
/// This exists because Gemini returns no price: its Pro spend never shows up in
/// `check_budget`'s dollar total, so a request COUNT is the only thing that can
/// guard it (see migration 0030).
pub fn paid_gemini_requests_this_month(conn: &Connection, flash_model: &str) -> Result<i64, AiError> {
    conn.query_row(
        "SELECT COUNT(*) FROM ai_requests \
         WHERE provider = 'gemini' AND model <> ?1 \
           AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')",
        params![flash_model],
        |row| row.get(0),
    )
    .map_err(|e| AiError::Internal(format!("Couldn't check Gemini Pro usage: {e}")))
}

/// Logs one provider call, success or failure, so the usage dashboard and
/// budget check both stay accurate even when a call errors out.
pub fn log_request(
    conn: &Connection,
    provider: &str,
    model: &str,
    feature: &str,
    result: &Result<AiResponse, AiError>,
) -> Result<(), String> {
    match result {
        Ok(resp) => {
            let total = match (resp.input_tokens, resp.output_tokens) {
                (Some(i), Some(o)) => Some(i + o),
                _ => None,
            };
            conn.execute(
                "INSERT INTO ai_requests \
                 (provider, model, feature, status, input_tokens, output_tokens, total_tokens, estimated_cost_usd) \
                 VALUES (?1, ?2, ?3, 'success', ?4, ?5, ?6, ?7)",
                params![
                    provider,
                    model,
                    feature,
                    resp.input_tokens,
                    resp.output_tokens,
                    total,
                    resp.estimated_cost_usd
                ],
            )
        }
        Err(e) => conn.execute(
            "INSERT INTO ai_requests (provider, model, feature, status, error_message) \
             VALUES (?1, ?2, ?3, 'error', ?4)",
            params![provider, model, feature, e.to_string()],
        ),
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Per-provider usage rollup for the usage dashboard. Computed by
/// aggregating `ai_requests` at read time — no separate rollup table, same
/// convention Finance/Study analytics already use for their month buckets.
///
/// Grouped by (provider, model) rather than provider alone, so Gemini
/// Flash and Gemini Pro usage never collapse into one "gemini" row —
/// they have very different cost profiles (Flash is free-tier-eligible,
/// Pro always requires paid usage; see ai/router.rs's routing doc
/// comment).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub provider: String,
    pub model: String,
    /// "free" | "paid" — see `classify_tier`. A best-effort label for
    /// display grouping only, not a guarantee (see ai/router.rs's routing
    /// doc comment on why Gemini's free tier can't be cryptographically
    /// guaranteed once billing is enabled on the underlying Google Cloud
    /// project).
    pub tier: String,
    pub request_count: i64,
    pub error_count: i64,
    pub total_tokens: i64,
    /// None when no request in this provider/model's history reported a
    /// cost — shown as "Cost unavailable" rather than 0 (never fabricated).
    pub estimated_cost_usd: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageStats {
    pub month_spent_usd: f64,
    pub monthly_spending_limit_usd: f64,
    /// Paid-tier Gemini requests this month and the cap they count against.
    pub pro_requests_this_month: i64,
    pub pro_request_cap: i64,
    pub by_provider: Vec<ProviderUsage>,
}

/// "free" | "paid" — cheap, no-network-call classification used only for
/// the usage dashboard's display grouping, never for the actual spending
/// gate (that's ai/router.rs::route's job, checked before a call is ever
/// made). Local is always free (no external billing exists for it).
/// Gemini is free only when the model matches the user's configured
/// Flash model — the only Gemini tier with a free Standard-API allowance
/// as of this writing; Pro always requires paid usage. OpenRouter uses
/// the same fast-path naming convention as
/// providers::openrouter::is_free_model's non-network check
/// ("openrouter/free" or a ":free" suffix) rather than a live pricing
/// lookup, since a full check isn't worth a network call just to label a
/// usage row that's already happened.
fn classify_tier(provider: &str, model: &str, gemini_flash_model: &str) -> &'static str {
    match provider {
        // Ollama/local AI was removed in Phase 8c, so no new usage row can
        // have this provider — kept only so pre-existing historical rows
        // (logged back when local AI still existed) still classify
        // correctly instead of falling through to "paid".
        "local" => "free",
        "gemini" => {
            if model == gemini_flash_model {
                "free"
            } else {
                "paid"
            }
        }
        "openrouter" => {
            if model == "openrouter/free" || model.ends_with(":free") {
                "free"
            } else {
                "paid"
            }
        }
        _ => "unknown",
    }
}

pub fn get_usage_stats(
    conn: &Connection,
    monthly_spending_limit_usd: f64,
    gemini_flash_model: &str,
    pro_request_cap: i64,
) -> Result<AiUsageStats, String> {
    let budget = check_budget(conn, monthly_spending_limit_usd).map_err(|e| e.to_string())?;
    let pro_requests = paid_gemini_requests_this_month(conn, gemini_flash_model).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT provider, \
                    model, \
                    COUNT(*), \
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), \
                    COALESCE(SUM(total_tokens), 0), \
                    CASE WHEN SUM(estimated_cost_usd) IS NULL THEN NULL ELSE SUM(estimated_cost_usd) END \
             FROM ai_requests \
             WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') \
             GROUP BY provider, model ORDER BY provider, model",
        )
        .map_err(|e| e.to_string())?;
    let by_provider = stmt
        .query_map([], |row| {
            let provider: String = row.get(0)?;
            let model: String = row.get(1)?;
            let tier = classify_tier(&provider, &model, gemini_flash_model).to_string();
            Ok(ProviderUsage {
                provider,
                model,
                tier,
                request_count: row.get(2)?,
                error_count: row.get(3)?,
                total_tokens: row.get(4)?,
                estimated_cost_usd: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(AiUsageStats {
        month_spent_usd: budget.spent_this_month_usd,
        monthly_spending_limit_usd: budget.limit_usd,
        pro_requests_this_month: pro_requests,
        pro_request_cap,
        by_provider,
    })
}
