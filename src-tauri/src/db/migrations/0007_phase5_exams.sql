-- Phase 5: Exams — exam tracker + performance analytics.
--
-- `subjects` already existed since 0001_init.sql (course_id FK, self-
-- contained) but had no commands or UI wired to it until now — this phase
-- adds real subject CRUD alongside exams, since the exam tracker needs a
-- working subject picker. No schema change needed for subjects themselves.
--
-- `percentage` is deliberately NOT a column here — same rule as the base
-- architecture doc's note on the exams table: it's computed at read time
-- (score / max_score * 100) in Rust, never stored redundantly, so it can
-- never drift out of sync with score/max_score.
--
-- No CHECK(score <= max_score): extra-credit exams can legitimately score
-- above max_score, so that's left as a UI-level sanity nudge, not a hard
-- DB constraint.

CREATE TABLE exams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    subject_id  INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    date        TEXT NOT NULL, -- "YYYY-MM-DD" calendar date, never a timestamp
    score       REAL NOT NULL CHECK (score >= 0),
    max_score   REAL NOT NULL CHECK (max_score > 0),
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_exams_date ON exams(date);
CREATE INDEX idx_exams_course ON exams(course_id);
CREATE INDEX idx_exams_subject ON exams(subject_id);
