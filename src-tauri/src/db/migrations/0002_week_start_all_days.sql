-- Phase 1 fix: week_start was wrongly limited to just Monday/Sunday.
-- SQLite can't alter a CHECK constraint in place, so we recreate the table
-- with the corrected constraint and copy the existing row across (there is
-- always exactly one row, id = 1).

PRAGMA foreign_keys = OFF;

CREATE TABLE user_settings_new (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    name                TEXT NOT NULL DEFAULT '',
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    week_start          TEXT NOT NULL DEFAULT 'monday'
                         CHECK (week_start IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
    theme               TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
    accent_color        TEXT NOT NULL DEFAULT '#4f7cff',
    dashboard_layout_json TEXT NOT NULL DEFAULT '["tasks"]',
    currency            TEXT NOT NULL DEFAULT 'USD',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO user_settings_new
SELECT id, name, timezone, week_start, theme, accent_color, dashboard_layout_json, currency, created_at, updated_at
FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;

PRAGMA foreign_keys = ON;
