-- Phase 14 (future enhancements & polish): Data Management — Reset Saved
-- Data & Reset Demo Data (future_enhancement.md §1).
--
-- "Reset Demo Data" must never guess which records are demo data
-- (explicit requirement) — the only honest way to satisfy that is an
-- explicit tag written at creation time, not a heuristic (e.g. "titles
-- starting with [Demo]" would be a guess; a column is not). Scoped to
-- the tables a demo dataset actually populates (see
-- commands/data_management.rs's generate_demo_data) — schedule_blocks,
-- study_sessions, and pomodoro_sessions aren't tagged separately because
-- any demo ones would always cascade-delete via their (tagged) parent
-- task/course rather than needing their own flag.

ALTER TABLE courses ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subjects ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exams ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finance_categories ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_courses_is_demo ON courses(is_demo);
CREATE INDEX idx_subjects_is_demo ON subjects(is_demo);
CREATE INDEX idx_tasks_is_demo ON tasks(is_demo);
CREATE INDEX idx_exams_is_demo ON exams(is_demo);
CREATE INDEX idx_finance_categories_is_demo ON finance_categories(is_demo);
CREATE INDEX idx_transactions_is_demo ON transactions(is_demo);
