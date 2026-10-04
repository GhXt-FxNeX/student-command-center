-- Phase 2: study session tracking, Pomodoro, and the settings fields both depend on.
-- Companion event wiring for PomodoroCompleted/StudySessionCompleted uses the
-- xp_rules already seeded in 0003_companion.sql — no companion schema changes needed
-- here, which is exactly the "room for updates" that migration left open.

ALTER TABLE user_settings ADD COLUMN pomodoro_work_minutes INTEGER NOT NULL DEFAULT 25;
ALTER TABLE user_settings ADD COLUMN pomodoro_short_break_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE user_settings ADD COLUMN pomodoro_long_break_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE user_settings ADD COLUMN pomodoro_sessions_before_long_break INTEGER NOT NULL DEFAULT 4;
ALTER TABLE user_settings ADD COLUMN pomodoro_auto_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN daily_study_goal_minutes INTEGER NOT NULL DEFAULT 120;
ALTER TABLE user_settings ADD COLUMN weekly_study_goal_minutes INTEGER NOT NULL DEFAULT 600;

CREATE TABLE study_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    course_id        INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    subject_id       INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id         INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    start_ts         TEXT NOT NULL,
    end_ts           TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    type             TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('pomodoro','manual','free')),
    completed        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_study_sessions_start ON study_sessions(start_ts);
CREATE INDEX idx_study_sessions_course ON study_sessions(course_id);

CREATE TABLE pomodoro_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    study_session_id INTEGER REFERENCES study_sessions(id) ON DELETE CASCADE,
    work_minutes     INTEGER NOT NULL,
    break_minutes    INTEGER NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Goal *values* only in Phase 2 (daily_study_goal_minutes/weekly_... above cover the
-- "current" target). This table keeps history of target changes over time so Phase 3's
-- Study Analytics can show "planned vs actual" against whatever the goal was on a given
-- day, not just today's setting.
CREATE TABLE study_goals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    scope         TEXT NOT NULL CHECK (scope IN ('daily','weekly')),
    target_minutes INTEGER NOT NULL,
    active_from   TEXT NOT NULL DEFAULT (datetime('now'))
);
