-- Phase 14 Item 5: Companion Collection / Multiple Companions.
-- See future_enhancement.md §4 for the feature spec.
--
-- The `companion` table was a hard singleton (`CHECK (id = 1)`) — fine for
-- "the app has exactly one companion," structurally wrong for "the user
-- owns a collection of companions, most of them locked." This replaces it
-- with `companion_collection`: one row per owned-or-lockable companion,
-- with `is_unlocked`/`is_active` flags instead of always assuming id = 1.
--
-- Exactly one active companion is enforced at the database level, not just
-- by application discipline: a partial UNIQUE index on (is_active) WHERE
-- is_active = 1 makes a second simultaneously-active row impossible to
-- insert, not just unintended.
--
-- `companion_evolution_history.companion_id` pointed at `companion(id)`,
-- so it needs the same SQLite documented 12-step rebuild procedure
-- migration 0008 used (no ALTER TABLE for changing a foreign key target).
-- Nothing else references `companion.id` or `companion_evolution_history`,
-- so this is the full set of tables this migration needs to touch.

CREATE TABLE companion_collection (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id           INTEGER NOT NULL REFERENCES companion_species(id),
    name                 TEXT NOT NULL DEFAULT 'Companion',
    branch_id            TEXT NOT NULL DEFAULT 'main',
    current_stage        TEXT NOT NULL DEFAULT 'egg'
                         CHECK (current_stage IN ('egg','baby','in_training','rookie','champion','ultimate','mega')),
    xp                   INTEGER NOT NULL DEFAULT 0,
    level                INTEGER NOT NULL DEFAULT 1,
    happiness            INTEGER NOT NULL DEFAULT 60 CHECK (happiness BETWEEN 0 AND 100),
    mood                 TEXT NOT NULL DEFAULT 'neutral',
    state                TEXT NOT NULL DEFAULT 'idle',
    celebration_trigger  TEXT NULL,
    -- 0/1 rather than a boolean type — SQLite has no native boolean, and
    -- every other flag-like column in this schema (e.g. condition_type
    -- elsewhere) already follows the CHECK-constrained-INTEGER convention.
    is_unlocked          INTEGER NOT NULL DEFAULT 0 CHECK (is_unlocked IN (0,1)),
    is_active            INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
    unlock_order         INTEGER NOT NULL, -- display/unlock sequence; lower unlocks first
    unlocked_at          TEXT NULL,
    last_interaction_at  TEXT NOT NULL DEFAULT (datetime('now')),
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_companion_collection_species ON companion_collection(species_id);
-- Enforces "exactly one active companion" in the database itself, not just
-- in application code — see header note.
CREATE UNIQUE INDEX idx_companion_collection_one_active ON companion_collection(is_active) WHERE is_active = 1;

-- Migrate the existing singleton companion into slot id 1 — deliberately
-- keeping id = 1 so companion_evolution_history's existing companion_id
-- values (all 1, from the old hardcoded `VALUES (1, ...)` in
-- record_evolution) stay correct with no row-by-row remapping below.
INSERT INTO companion_collection
    (id, species_id, name, branch_id, current_stage, xp, level, happiness, mood, state,
     celebration_trigger, is_unlocked, is_active, unlock_order, unlocked_at,
     last_interaction_at, created_at, updated_at)
SELECT
    1, species_id, name, branch_id, current_stage, xp, level, happiness, mood, state,
    celebration_trigger, 1, 1, 1, created_at,
    last_interaction_at, created_at, updated_at
FROM companion;

-- ---- Seed two more locked collection slots (placeholder species/art,
-- ---- exactly like Sparkling started — see assets/companions/README.md) ----

INSERT INTO companion_species (slug, display_name, description) VALUES
    ('emberpup', 'Emberpup', 'Second collection companion. Original design — placeholder art during development.'),
    ('tidewhelp', 'Tidewhelp', 'Third collection companion. Original design — placeholder art during development.');

INSERT INTO companion_evolution_stages (species_id, branch_id, stage, min_level, condition_type, condition_json)
SELECT id, 'main', stage, min_level, 'xp_threshold', '{}'
FROM companion_species, (
    SELECT 'egg' AS stage, 1 AS min_level
    UNION ALL SELECT 'baby', 2
    UNION ALL SELECT 'in_training', 5
    UNION ALL SELECT 'rookie', 10
    UNION ALL SELECT 'champion', 18
    UNION ALL SELECT 'ultimate', 28
    UNION ALL SELECT 'mega', 40
)
WHERE companion_species.slug IN ('emberpup', 'tidewhelp');

INSERT INTO companion_collection (species_id, name, current_stage, xp, level, happiness, mood, state, is_unlocked, is_active, unlock_order)
SELECT id, display_name, 'egg', 0, 1, 60, 'neutral', 'idle', 0, 0, 2 FROM companion_species WHERE slug = 'emberpup';
INSERT INTO companion_collection (species_id, name, current_stage, xp, level, happiness, mood, state, is_unlocked, is_active, unlock_order)
SELECT id, display_name, 'egg', 0, 1, 60, 'neutral', 'idle', 0, 0, 3 FROM companion_species WHERE slug = 'tidewhelp';

DROP TABLE companion;

-- ---- Rebuild companion_evolution_history with the FK repointed ----

CREATE TABLE companion_evolution_history_new (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    companion_id     INTEGER NOT NULL REFERENCES companion_collection(id) ON DELETE CASCADE,
    from_stage       TEXT NOT NULL,
    to_stage         TEXT NOT NULL,
    evolved_at       TEXT NOT NULL DEFAULT (datetime('now')),
    trigger_event_id INTEGER REFERENCES companion_event_log(id) ON DELETE SET NULL
);
INSERT INTO companion_evolution_history_new (id, companion_id, from_stage, to_stage, evolved_at, trigger_event_id)
SELECT id, companion_id, from_stage, to_stage, evolved_at, trigger_event_id FROM companion_evolution_history;
DROP TABLE companion_evolution_history;
ALTER TABLE companion_evolution_history_new RENAME TO companion_evolution_history;
