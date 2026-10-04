-- Phase 14 Item 6: Spotify integration. See future_enhancement.md §5.
--
-- Only the Spotify app Client ID lives here — it's the PUBLIC half of the
-- OAuth Authorization Code + PKCE flow (literally visible in the browser's
-- address bar during login), not a secret, so a plain user_settings column
-- is the right place for it, same reasoning as accent_color or timezone.
-- The actual access/refresh tokens are NOT stored here — see
-- spotify/token_store.rs, which reuses the existing OS-keychain pattern
-- ai/keychain.rs already established for the Gemini/OpenRouter API keys.
--
-- No CHECK constraint, per migration 0009's established note: ALTER TABLE
-- ADD COLUMN ... CHECK isn't reliable on this project's SQLite version.

ALTER TABLE user_settings ADD COLUMN spotify_client_id TEXT NOT NULL DEFAULT '';
