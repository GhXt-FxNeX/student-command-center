-- Phase 1: courses/subjects/topics, tasks, schedule blocks, single-row user settings.
-- Later phases add their own numbered migration files (0002_..., 0003_...) — never
-- edit this file after it has shipped; add a new migration instead.

CREATE TABLE courses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#4f7cff',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subjects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subjects_course ON subjects(course_id);

CREATE TABLE topics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id      INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    parent_topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_topics_subject ON topics(subject_id);
CREATE INDEX idx_topics_parent ON topics(parent_topic_id);

CREATE TABLE tasks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    description         TEXT,
    course_id           INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    subject_id          INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id            INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    difficulty          TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
    estimated_minutes   INTEGER,
    deadline            TEXT,
    scheduled_start     TEXT,
    scheduled_end       TEXT,
    status              TEXT NOT NULL DEFAULT 'not_started'
                         CHECK (status IN ('not_started','in_progress','completed','skipped')),
    tags_json           TEXT NOT NULL DEFAULT '[]',
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_deadline_status ON tasks(deadline, status);
CREATE INDEX idx_tasks_course ON tasks(course_id);

CREATE TABLE schedule_blocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    start_ts    TEXT NOT NULL,
    end_ts      TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('ai','manual')),
    locked      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_schedule_blocks_time ON schedule_blocks(start_ts, end_ts);

-- Single-row settings table (id is always 1). Kept relational rather than
-- one giant JSON blob per architecture principle, but a couple of clearly
-- structural fields (dashboard layout) are small JSON arrays for flexibility.
CREATE TABLE user_settings (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    name                TEXT NOT NULL DEFAULT '',
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    week_start          TEXT NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday','sunday')),
    theme               TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
    accent_color        TEXT NOT NULL DEFAULT '#4f7cff',
    dashboard_layout_json TEXT NOT NULL DEFAULT '["tasks"]',
    currency            TEXT NOT NULL DEFAULT 'USD',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO user_settings (id) VALUES (1);
