-- Bug fix: task deadlines were being stored as "YYYY-MM-DDT23:59:00" (a
-- synthetic timestamp) even though a deadline is a calendar date, not a
-- point in time. Combined with timezone-unsafe Date handling on the
-- frontend, this contributed to the calendar off-by-one-day bug. The
-- frontend now stores/reads deadline as a plain "YYYY-MM-DD" string; this
-- migration normalizes any rows written before that fix, preserving the
-- actual date — only the synthetic time suffix is dropped, no data is lost.

UPDATE tasks
SET deadline = substr(deadline, 1, 10)
WHERE deadline IS NOT NULL AND length(deadline) > 10;
