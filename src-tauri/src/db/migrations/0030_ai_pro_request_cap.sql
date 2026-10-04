-- Monthly cap on paid-tier Gemini requests (Gemini Pro).
--
-- Why a request count and not dollars: Gemini's API returns no price, and this
-- app deliberately never guesses one from a hard-coded table, so Gemini Pro
-- spend is invisible to the dollar-based monthly spending limit (ai_requests
-- rows for it have a NULL estimated_cost_usd). A count IS measurable, so it is
-- the guard for Pro: ai/router.rs refuses a Pro request once this many paid
-- Gemini requests have been logged this month. It only matters when the
-- spending limit is above $0 — at $0 Pro is blocked outright already.
--
-- Default 20 is deliberately conservative. 0 disables Gemini Pro entirely
-- (whatever the spending limit). Range-checked in Rust (0..=10000).

ALTER TABLE user_settings ADD COLUMN ai_pro_monthly_request_cap INTEGER NOT NULL DEFAULT 20;
