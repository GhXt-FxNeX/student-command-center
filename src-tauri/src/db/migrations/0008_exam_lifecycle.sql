-- Exam lifecycle fix (post-Phase-5 design correction).
--
-- Root cause: 0007_phase5_exams.sql made score/max_score NOT NULL, which
-- structurally assumed every exam row already has a graded result. That
-- made it impossible to record a future/upcoming exam, or one that's been
-- taken but whose result hasn't been released yet. This migration fixes
-- the data model itself, not just the form on top of it.
--
-- SQLite has no ALTER COLUMN to drop NOT NULL or change CHECK constraints,
-- so this rebuilds the table (SQLite's documented 12-step procedure).
-- Nothing else in the schema has a foreign key pointing AT exams.id, so
-- this rebuild is safe without touching PRAGMA foreign_keys.
--
-- Lifecycle: status is a first-class column, not derived from score being
-- present — "upcoming" and "awaiting_result" both have a NULL score, and
-- only an explicit flag (set via the Rust command layer) can tell them
-- apart. "completed" is reserved for rows that actually have a result;
-- the CHECK below makes that invariant impossible to violate directly in
-- the database, on top of the Rust-side validation in commands/exams.rs.
--
-- Behavior change: previously a score above max_score was deliberately
-- allowed (extra credit) and had no CHECK constraint. The updated exam
-- validation spec explicitly requires rejecting score > max_score, so
-- that's now enforced here too — a deliberate, requested change, not an
-- oversight.

CREATE TABLE exams_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    subject_id  INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    date        TEXT NOT NULL, -- "YYYY-MM-DD" calendar date, never a timestamp
    status      TEXT NOT NULL DEFAULT 'upcoming'
                  CHECK (status IN ('upcoming', 'awaiting_result', 'completed')),
    score       REAL CHECK (score >= 0),       -- NULL passes CHECK automatically (SQL NULL semantics)
    max_score   REAL CHECK (max_score > 0),    -- NULL passes CHECK automatically
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    -- Both-or-neither: a result is score+max_score together or not at all.
    CHECK ( (score IS NULL) = (max_score IS NULL) ),
    -- Score can't exceed total (see "Behavior change" note above).
    CHECK ( score IS NULL OR score <= max_score ),
    -- status is 'completed' exactly when a result is present — never both,
    -- never neither. Keeps status from ever silently drifting out of sync
    -- with the data it's supposed to describe.
    CHECK ( (status = 'completed') = (score IS NOT NULL) )
);

-- Every pre-existing row was created under the old NOT NULL schema, so it
-- already has a valid score/max_score — all of them become 'completed'.
-- No existing data (scores, percentages, notes, timestamps) is altered.
INSERT INTO exams_new (id, name, course_id, subject_id, date, status, score, max_score, notes, created_at, updated_at)
SELECT id, name, course_id, subject_id, date, 'completed', score, max_score, notes, created_at, updated_at
FROM exams;

DROP TABLE exams;
ALTER TABLE exams_new RENAME TO exams;

CREATE INDEX idx_exams_date ON exams(date);
CREATE INDEX idx_exams_course ON exams(course_id);
CREATE INDEX idx_exams_subject ON exams(subject_id);
CREATE INDEX idx_exams_status ON exams(status);
