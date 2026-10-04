-- Fixes a UTC-vs-local mismatch in study_sessions timestamps.
--
-- Until now `complete_pomodoro_session` wrote start_ts/end_ts with SQLite's
-- datetime('now', ...), which is UTC. Everything that reads those columns —
-- the Calendar's clock-position layout, the Day-view hourly buckets, "today"
-- / "this week" / streak queries — treats them as the user's LOCAL wall-clock
-- time, matching how every other timestamp in the app is stored (the planner's
-- schedule blocks and manually-added sessions are written as local
-- "YYYY-MM-DDTHH:MM:SS" by the frontend). So a Pomodoro finished at 21:35 in
-- Cairo (UTC+3) was saved as 18:35 and showed up three hours early, and
-- sessions between local midnight and 03:00 landed on the previous day.
--
-- The code now writes datetime('now', 'localtime'). This converts the rows the
-- OLD code already wrote, once, in place.
--
-- Which rows: type = 'pomodoro' only, and only those in SQLite's native
-- "YYYY-MM-DD HH:MM:SS" form (space separator) — the exact shape
-- datetime('now', ...) produced. Local timestamps written by the frontend use
-- a 'T' separator, so they are never touched. Manual/free sessions are never
-- touched either.
--
-- 'localtime' converts using the operating system's timezone rules for each
-- row's own date, so sessions from before a daylight-saving change get the
-- offset that applied THEN (e.g. UTC+2 in winter), not today's.
--
-- Runs exactly once (schema_migrations records it). It is not idempotent by
-- design: running it twice would shift the same rows twice.

UPDATE study_sessions
SET start_ts = datetime(start_ts, 'localtime'),
    end_ts   = datetime(end_ts,   'localtime')
WHERE type = 'pomodoro'
  AND start_ts NOT LIKE '%T%'
  AND end_ts   NOT LIKE '%T%';
