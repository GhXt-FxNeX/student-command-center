-- Adjustable companion bubble size (Settings > Companion), independent of
-- the companion's actual art — a display preference, not a companion
-- property, so it lives in user_settings alongside theme/accent rather
-- than on companion_collection.
--
-- No CHECK constraint, per migration 0009's established note: ALTER TABLE
-- ADD COLUMN ... CHECK isn't reliable on this project's SQLite version.
-- Range (48-160px) is validated in Rust (commands/settings.rs) instead,
-- same pattern already used for the AI/Planner columns that migration
-- introduced.

ALTER TABLE user_settings ADD COLUMN companion_bubble_size_px INTEGER NOT NULL DEFAULT 80;
