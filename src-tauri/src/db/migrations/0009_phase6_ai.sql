-- Phase 6: AI infrastructure — provider/routing settings + request/usage
-- logging. Plumbing only, per architecture.md's roadmap (§10, phase 6):
-- no consumer-facing AI feature is built on top of this yet.
--
-- API keys are NEVER stored here, or anywhere in SQLite. They live in the
-- OS keychain via the `keyring` crate (src-tauri/src/ai/keychain.rs). This
-- migration only ever adds non-secret configuration + usage-log columns.
--
-- NOTE ON MISSING CHECK CONSTRAINTS BELOW: direct testing against SQLite
-- 3.45.1 found that `ALTER TABLE user_settings ADD COLUMN ... CHECK (...)`
-- is unreliable on this table — a column added with a decimal-point
-- DEFAULT (e.g. 0.7) causes the *next* ADD COLUMN statement that carries a
-- CHECK constraint to fail with a spurious "NOT NULL constraint failed"
-- error, regardless of that next column's own type or default. This
-- reproduced consistently and is not a typo in the SQL. Rather than fight
-- statement ordering to dodge it, every new column below is added without
-- a CHECK; all of the same range/enum validation is enforced in Rust
-- (commands/ai.rs) instead — consistent with how this codebase already
-- treats Rust-layer validation as primary and DB CHECKs as a backstop
-- everywhere else. CHECK constraints are kept on the new `ai_requests`
-- CREATE TABLE below, since CREATE TABLE ... CHECK has never shown this
-- bug in any migration in this project (0007/0008 both rely on it safely).

ALTER TABLE user_settings ADD COLUMN ai_routing_mode TEXT NOT NULL DEFAULT 'automatic';

-- Only consulted when ai_routing_mode = 'manual'. gemini_tier only matters
-- when manual_provider = 'gemini' (Gemini is the only provider with a
-- Flash/Pro tier distinction to make explicit).
ALTER TABLE user_settings ADD COLUMN ai_manual_provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE user_settings ADD COLUMN ai_manual_gemini_tier TEXT NOT NULL DEFAULT 'flash';

-- "What model does 'Flash'/'Pro' currently mean" — kept as configurable
-- strings (never hard-coded deep in provider logic) since Gemini model
-- names churn every few months. Same reasoning for the OpenRouter/local
-- model fields below.
ALTER TABLE user_settings ADD COLUMN ai_gemini_flash_model TEXT NOT NULL DEFAULT 'gemini-3.7-flash';
ALTER TABLE user_settings ADD COLUMN ai_gemini_pro_model TEXT NOT NULL DEFAULT 'gemini-3.1-pro-preview';

-- 'openrouter/free' is OpenRouter's own dedicated $0 router (auto-selects
-- among free models) — a deliberately safe default that costs nothing
-- regardless of the spending limit setting below.
ALTER TABLE user_settings ADD COLUMN ai_openrouter_model TEXT NOT NULL DEFAULT 'openrouter/free';

ALTER TABLE user_settings ADD COLUMN ai_local_base_url TEXT NOT NULL DEFAULT 'http://localhost:11434';
ALTER TABLE user_settings ADD COLUMN ai_local_model TEXT NOT NULL DEFAULT 'llama3.1';

ALTER TABLE user_settings ADD COLUMN ai_temperature REAL NOT NULL DEFAULT 0.7;
ALTER TABLE user_settings ADD COLUMN ai_max_output_tokens INTEGER NOT NULL DEFAULT 2048;

-- 0 = never intentionally make a paid request (the spec's explicit "$0"
-- option) — this is the default, so a freshly-installed app never calls a
-- paid provider until the user deliberately raises this.
ALTER TABLE user_settings ADD COLUMN ai_monthly_spending_limit_usd REAL NOT NULL DEFAULT 0;

-- One row per provider call. Deliberately NOT a separate rollup/monthly
-- table — usage stats are computed by aggregating this table at read time
-- (get_ai_usage_stats), same convention Finance/Study already established
-- for month buckets rather than maintaining a second, potentially-stale
-- copy of the same numbers.
CREATE TABLE ai_requests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    provider            TEXT NOT NULL CHECK (provider IN ('gemini', 'openrouter', 'local')),
    model               TEXT NOT NULL,
    feature             TEXT NOT NULL, -- 'test_call' for now; feature-specific values from Phase 7 on
    status              TEXT NOT NULL CHECK (status IN ('success', 'error')),
    error_message       TEXT,
    input_tokens        INTEGER, -- nullable: not every provider/response reports token counts
    output_tokens       INTEGER,
    total_tokens        INTEGER,
    estimated_cost_usd  REAL,    -- nullable: only set when a real per-token price is known — never guessed
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_requests_created ON ai_requests(created_at);
CREATE INDEX idx_ai_requests_provider ON ai_requests(provider);
