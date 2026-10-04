-- Phase 7: AI Daily Planner.
--
-- `schedule_blocks` has existed since 0001_init.sql (task_id, title,
-- start_ts/end_ts, source 'ai'|'manual', locked) but had no commands/UI
-- until now. This migration only adds what's missing: a completion flag
-- independent of any linked task (not every block is tied to a task), a
-- course/subject tag for display, and a short AI rationale string
-- (architecture.md §64 "AI transparency" — concise decision factors, not
-- hidden reasoning).
--
-- NOTE: no CHECK constraints on any ALTER TABLE ADD COLUMN below. Phase 6
-- found (via direct SQLite execution, not speculation) that a decimal-
-- point DEFAULT on one ADD COLUMN can poison the *next* ADD COLUMN ...
-- CHECK statement in the same migration with a spurious "NOT NULL
-- constraint failed". None of these particular defaults are decimals, but
-- the safe, now-established pattern in this codebase is to keep ALTER
-- TABLE ADD COLUMN free of CHECK entirely and validate ranges/enums in
-- Rust instead (see commands/planner.rs).

ALTER TABLE schedule_blocks ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedule_blocks ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE schedule_blocks ADD COLUMN subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL;
-- Concise "why this block is here" for AI-generated blocks only — NULL for
-- manually-added blocks, never a fabricated explanation.
ALTER TABLE schedule_blocks ADD COLUMN ai_reason TEXT;

CREATE INDEX idx_schedule_blocks_task ON schedule_blocks(task_id);

-- Reusable planner preferences — things a user sets rarely (wake/sleep
-- time, how long they can focus before needing a break) rather than
-- re-entering on every "generate my day" request. Day-specific input
-- (today's one-off commitments, any extra notes) stays ephemeral, passed
-- directly to generate_plan rather than persisted here — it wouldn't be
-- reusable tomorrow anyway.
ALTER TABLE user_settings ADD COLUMN planner_wake_time TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE user_settings ADD COLUMN planner_sleep_time TEXT NOT NULL DEFAULT '23:00';
ALTER TABLE user_settings ADD COLUMN planner_max_continuous_minutes INTEGER NOT NULL DEFAULT 90;
ALTER TABLE user_settings ADD COLUMN planner_break_minutes INTEGER NOT NULL DEFAULT 15;
