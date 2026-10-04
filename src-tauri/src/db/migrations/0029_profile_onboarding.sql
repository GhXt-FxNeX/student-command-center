-- Profile + first-run onboarding (Settings > General > Profile, and the
-- "Welcome" screen shown by App when onboarding_completed = 0).
--
-- profile_icon: id of a preset avatar from the frontend's list
-- (src/features/profile/avatars.ts), e.g. 'owl'. '' = none chosen yet, in which
-- case the UI shows the name's initial. Only the id is stored, so the glyphs
-- and colours can change without a migration.
--
-- onboarding_completed: 0 until the user has picked a name and icon. Defaults
-- to 0, so it is also what a fresh install, and the `INSERT INTO user_settings
-- (id) VALUES (1)` that "Reset saved data" re-runs, both fall back to — i.e.
-- onboarding appears on first launch and after a reset with no extra code.
-- Existing installs are NOT backfilled to 1 on purpose: they see the screen
-- once (name pre-filled) so they can choose an icon.
--
-- No CHECK constraints, per migration 0009's note on ALTER TABLE ADD COLUMN;
-- the shape is validated in Rust (commands/settings.rs).

ALTER TABLE user_settings ADD COLUMN profile_icon TEXT NOT NULL DEFAULT '';
ALTER TABLE user_settings ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
