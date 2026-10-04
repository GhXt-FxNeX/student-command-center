-- Phase 14 (Courses tab): a subject's recurring weekly class schedule —
-- e.g. "Anatomy: Saturday 10:00, Sunday 08:00, Monday 12:00, ... Friday
-- (no class)". Stored as a per-day-of-week template, not materialized
-- into individual dated rows: the Calendar's get_calendar_range command
-- computes actual occurrences for whatever date range is being viewed
-- (see commands/calendar.rs), so changing a time here immediately
-- affects every future week without needing to touch or regenerate any
-- stored calendar rows — and it can never go stale the way materialized
-- rows could.
--
-- One row per (subject, day) — a day with no class simply has no row for
-- that subject, rather than a row with a null/placeholder time. Deleting
-- a subject cascades to its schedule (ON DELETE CASCADE), consistent with
-- subjects.course_id's own cascade from courses (migration 0001).
CREATE TABLE subject_weekly_schedule (
    id          INTEGER PRIMARY KEY,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL CHECK (
        day_of_week IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
    ),
    start_time  TEXT NOT NULL, -- "HH:MM", 24-hour — deliberately not a fixed time app-wide (§ this feature's whole point)
    end_time    TEXT,          -- "HH:MM", optional — not every class time is known/fixed in length
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (subject_id, day_of_week)
);

CREATE INDEX idx_subject_weekly_schedule_subject ON subject_weekly_schedule(subject_id);
