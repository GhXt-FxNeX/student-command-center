-- Phase 14 Item 8: Secret Private Video Journal. See future_enhancement.md §8.
--
-- Deliberately not tied into any table another feature already reads from
-- generically — this is meant to stay invisible until the secret
-- triple-click-Settings + password gate opens it (see commands/journal.rs
-- for the actual security enforcement; the triple-click itself is pure
-- discovery-obscurity, never the security boundary, per §8's own note).
--
-- journal_security is a singleton (CHECK id = 1), same pattern as the
-- original companion/user_settings tables: exactly one password governs
-- the one private journal this app supports per install.
--
-- What's stored vs what's never stored, spelled out because it's the
-- entire point of this table:
--   - password_hash: an Argon2id PHC string. Verifies a password attempt
--     without ever needing the raw password again. This is the ONLY
--     password-derived thing that touches disk.
--   - key_salt: a random salt (hex), used to re-derive the AES-256 key
--     from the password each time the journal unlocks. The derived key
--     itself is NEVER stored anywhere — not here, not in the OS keychain,
--     not anywhere — it lives in memory only for the unlocked session
--     (see spotify/token_store.rs for how keychain storage works when it
--     IS appropriate; this is deliberately not that, because a keychain
--     entry would mean the app's OS-level access is the real security
--     boundary instead of the person's own password).
--   - failed_attempts / locked_until: brute-force backoff bookkeeping.
--     Not sensitive on their own.
CREATE TABLE journal_security (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash      TEXT NOT NULL,
    key_salt           TEXT NOT NULL,
    auto_lock_minutes  INTEGER NOT NULL DEFAULT 15, -- 0 = "Never" per §8's Auto-lock options
    failed_attempts    INTEGER NOT NULL DEFAULT 0,
    locked_until       TEXT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
-- No seed row — absence of a row IS "password not set up yet" (first-run
-- state), checked by commands/journal.rs before anything else.

-- title/note are encrypted (base64 ciphertext, AES-256-GCM, nonce
-- prepended) with the SAME derived key as the videos — search/"browse by
-- date" work by decrypting in memory once unlocked (commands/journal.rs),
-- not via SQL LIKE against plaintext, because storing a private journal's
-- titles/notes in plaintext would defeat much of the point of any of this.
-- entry_date itself stays plaintext (needed for the calendar view / date
-- sort to work as an indexed SQL query, and a date alone is far less
-- revealing than a title or note).
CREATE TABLE journal_entries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date         TEXT NOT NULL, -- YYYY-MM-DD
    title_encrypted    TEXT NULL,
    note_encrypted     TEXT NULL,
    -- Filename only (not a full path) under {app_data_dir}/private_journal/
    -- videos/ — see journal/storage.rs. Never a SQLite BLOB, per §8's
    -- explicit "do not store large videos directly as SQLite BLOBs".
    video_file         TEXT NOT NULL,
    duration_seconds   INTEGER NOT NULL,
    file_size_bytes    INTEGER NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
