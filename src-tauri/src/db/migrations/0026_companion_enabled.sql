-- "Show companion" toggle (Settings > Companion). A display preference like
-- companion_bubble_size_px (migration 0022) — it only hides the companion's
-- UI (Dashboard card + floating bubble); the engine keeps processing
-- events, so XP/levels/happiness aren't lost while it's switched off.
--
-- Defaults to on (1) so nobody's existing companion disappears on upgrade.
-- No CHECK constraint, per migration 0009's established note on
-- ALTER TABLE ADD COLUMN; the value is only ever written as 0/1 from Rust.

ALTER TABLE user_settings ADD COLUMN companion_enabled INTEGER NOT NULL DEFAULT 1;
