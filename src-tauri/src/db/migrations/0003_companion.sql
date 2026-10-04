-- Phase 1B: companion / creature progression subsystem.
-- See architecture.md, AMENDMENT section, for the full design rationale.

CREATE TABLE companion_species (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE companion_evolution_stages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id      INTEGER NOT NULL REFERENCES companion_species(id) ON DELETE CASCADE,
    branch_id       TEXT NOT NULL DEFAULT 'main',
    stage           TEXT NOT NULL CHECK (stage IN
                     ('egg','baby','in_training','rookie','champion','ultimate','mega')),
    min_level       INTEGER NOT NULL,
    condition_type  TEXT NOT NULL DEFAULT 'xp_threshold' CHECK (condition_type IN ('xp_threshold','stat_based')),
    condition_json  TEXT NOT NULL DEFAULT '{}',
    UNIQUE (species_id, branch_id, stage)
);
CREATE INDEX idx_evolution_stages_species ON companion_evolution_stages(species_id);

CREATE TABLE companion (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    species_id         INTEGER NOT NULL REFERENCES companion_species(id),
    name               TEXT NOT NULL DEFAULT 'Companion',
    branch_id          TEXT NOT NULL DEFAULT 'main',
    current_stage      TEXT NOT NULL DEFAULT 'egg'
                       CHECK (current_stage IN ('egg','baby','in_training','rookie','champion','ultimate','mega')),
    xp                 INTEGER NOT NULL DEFAULT 0,
    level              INTEGER NOT NULL DEFAULT 1,
    happiness          INTEGER NOT NULL DEFAULT 60 CHECK (happiness BETWEEN 0 AND 100),
    mood               TEXT NOT NULL DEFAULT 'neutral',
    state              TEXT NOT NULL DEFAULT 'idle',
    last_interaction_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE companion_event_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type       TEXT NOT NULL,
    payload_json     TEXT NOT NULL DEFAULT '{}',
    xp_delta         INTEGER NOT NULL DEFAULT 0,
    happiness_delta  INTEGER NOT NULL DEFAULT 0,
    occurred_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_companion_event_log_time ON companion_event_log(occurred_at);
CREATE INDEX idx_companion_event_log_type ON companion_event_log(event_type);

CREATE TABLE companion_evolution_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    companion_id     INTEGER NOT NULL DEFAULT 1 REFERENCES companion(id) ON DELETE CASCADE,
    from_stage       TEXT NOT NULL,
    to_stage         TEXT NOT NULL,
    evolved_at       TEXT NOT NULL DEFAULT (datetime('now')),
    trigger_event_id INTEGER REFERENCES companion_event_log(id) ON DELETE SET NULL
);

CREATE TABLE companion_achievements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT,
    unlocked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE xp_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT NOT NULL UNIQUE,
    xp_amount       INTEGER NOT NULL DEFAULT 0,
    happiness_delta INTEGER NOT NULL DEFAULT 0,
    cooldown_seconds INTEGER
);

CREATE TABLE level_thresholds (
    level      INTEGER PRIMARY KEY,
    xp_required INTEGER NOT NULL
);

-- ---- Seed data: one original, first-party placeholder species through all 7 stages ----

INSERT INTO companion_species (slug, display_name, description)
VALUES ('sparkling', 'Sparkling', 'The default Student Command Center companion. Original design — placeholder art during development.');

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
WHERE companion_species.slug = 'sparkling';

INSERT INTO companion (id, species_id, name, current_stage, xp, level, happiness, mood, state)
SELECT 1, id, 'Sparkling', 'egg', 0, 1, 60, 'neutral', 'idle'
FROM companion_species WHERE slug = 'sparkling';

-- Default, tunable XP/happiness rules per event type (spec §A3 — data-driven, not hardcoded logic)
INSERT INTO xp_rules (event_type, xp_amount, happiness_delta, cooldown_seconds) VALUES
    ('TaskCompleted',           8,  2, NULL),
    ('MajorTaskCompleted',      20, 5, NULL),
    ('ExamCompleted',           10, 2, NULL),
    ('HighExamScore',           25, 8, NULL),
    ('PerfectExamScore',        40, 12, NULL),
    ('WeeklyGoalCompleted',     30, 10, NULL),
    ('StudySessionCompleted',   5,  1, 300),
    ('PomodoroCompleted',       6,  1, 300),
    ('StudyStreakReached',      20, 8, NULL),
    ('FlashcardMilestoneReached', 15, 5, NULL),
    ('GoalMissed',              0, -6, NULL),
    ('StreakBroken',            0, -8, NULL);

-- Level curve: simple, gently increasing cost per level (levels 1-40 cover all 7 stages)
INSERT INTO level_thresholds (level, xp_required)
WITH RECURSIVE lv(level, xp_required) AS (
    SELECT 1, 0
    UNION ALL
    SELECT level + 1, xp_required + 20 + (level * 4)
    FROM lv WHERE level < 40
)
SELECT level, xp_required FROM lv;
