use crate::companion::engine;
use crate::companion::events::{CompanionEvent, CompanionEventType};
use crate::db::Pool;
use crate::models::{CourseMinutes, StudyStats, StudyStatsBucket, SubjectMinutes};
use rusqlite::{params, Connection};
use tauri::{AppHandle, Emitter, State};

/// Streak lengths (in consecutive study days) that trigger a companion
/// celebration. Deliberately a fixed list rather than "every day" — the
/// companion should notice milestones, not spam an event daily.
const STREAK_MILESTONES: [i64; 6] = [3, 7, 14, 30, 60, 100];

#[tauri::command]
pub fn get_study_stats(pool: State<Pool>, range: String) -> Result<StudyStats, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    build_stats(&conn, &range)
}

/// Evaluates goals/streaks and fires any newly-earned companion events.
/// Called both right after a study session is logged (study.rs) and once
/// on app/dashboard load (to catch "missed yesterday" / "streak broke"
/// cases that depend on the *absence* of activity, not a new session).
#[tauri::command]
pub fn check_study_goals(pool: State<Pool>, app: AppHandle) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    evaluate_goals_and_streaks(&conn, &app);
    Ok(())
}

fn build_stats(conn: &Connection, range: &str) -> Result<StudyStats, String> {
    let days = match range {
        "day" => 1,
        "week" => 7,
        "year" => 365,
        _ => 30, // "month" and anything unrecognized
    };

    let buckets = if range == "day" {
        hourly_buckets(conn)?
    } else if range == "year" {
        monthly_buckets(conn)?
    } else {
        daily_buckets(conn, days)?
    };

    let total_minutes: i64 = buckets.iter().map(|b| b.minutes).sum();
    let active_days = buckets.iter().filter(|b| b.minutes > 0).count().max(1) as f64;
    let average_minutes_per_active_day = total_minutes as f64 / active_days;

    let (current_streak, longest_streak) = compute_streaks(conn)?;
    let by_course = course_breakdown(conn, days)?;
    let by_subject = subject_breakdown(conn, days)?;
    let today_minutes = day_minutes_offset(conn, 0)?;
    let this_week_minutes = week_minutes(conn)?;
    let (daily_goal_minutes, weekly_goal_minutes) = goal_settings(conn)?;

    Ok(StudyStats {
        buckets,
        total_minutes,
        average_minutes_per_active_day,
        current_streak,
        longest_streak,
        by_course,
        by_subject,
        today_minutes,
        this_week_minutes,
        daily_goal_minutes,
        weekly_goal_minutes,
    })
}

/// "Day" range (spec §24's four interactive graph options: Day/Week/Month/
/// Year) — today broken into its 24 hours, mirroring daily_buckets' own
/// zero-filled recursive-CTE approach so hours with no study time still
/// show up as a 0 rather than being missing from the series entirely.
fn hourly_buckets(conn: &Connection) -> Result<Vec<StudyStatsBucket>, String> {
    // Joins on a RANGE over the raw column (`start_ts >= d AND start_ts < d + 1 day`)
    // rather than `date(start_ts) = d`: a function on the column can't use
    // idx_study_sessions_start, so SQLite rescanned the whole table once per bucket
    // (the Year view took ~15 s at 200k sessions). Timestamps are
    // 'YYYY-MM-DD…' in both stored formats, so the comparison is equivalent.
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE hour_series(h) AS ( \
                SELECT 0 \
                UNION ALL \
                SELECT h + 1 FROM hour_series WHERE h < 23 \
             ) \
             SELECT printf('%02d', hour_series.h), \
                    COALESCE(SUM(study_sessions.duration_seconds), 0) / 60 \
             FROM hour_series \
             LEFT JOIN study_sessions \
               ON study_sessions.start_ts >= date('now', 'localtime') \
              AND study_sessions.start_ts < date('now', 'localtime', '+1 day') \
              AND CAST(strftime('%H', study_sessions.start_ts) AS INTEGER) = hour_series.h \
             GROUP BY hour_series.h ORDER BY hour_series.h ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StudyStatsBucket {
                label: row.get(0)?,
                minutes: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn daily_buckets(conn: &Connection, days: i64) -> Result<Vec<StudyStatsBucket>, String> {
    let offset = format!("-{} days", (days - 1).max(0));
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE day_series(d) AS ( \
                SELECT date('now', 'localtime', ?1) \
                UNION ALL \
                SELECT date(d, '+1 day') FROM day_series WHERE d < date('now', 'localtime') \
             ) \
             SELECT day_series.d, COALESCE(SUM(study_sessions.duration_seconds), 0) / 60 \
             FROM day_series LEFT JOIN study_sessions \
               ON study_sessions.start_ts >= day_series.d \
              AND study_sessions.start_ts < date(day_series.d, '+1 day') \
             GROUP BY day_series.d ORDER BY day_series.d ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![offset], |row| {
            Ok(StudyStatsBucket {
                label: row.get(0)?,
                minutes: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn monthly_buckets(conn: &Connection) -> Result<Vec<StudyStatsBucket>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE month_series(m) AS ( \
                SELECT strftime('%Y-%m-01', 'now', 'localtime', '-11 months') \
                UNION ALL \
                SELECT date(m, '+1 month') FROM month_series WHERE m < strftime('%Y-%m-01', 'now', 'localtime') \
             ) \
             SELECT strftime('%Y-%m', month_series.m), \
                    COALESCE(SUM(study_sessions.duration_seconds), 0) / 60 \
             FROM month_series \
             LEFT JOIN study_sessions \
               ON study_sessions.start_ts >= month_series.m \
              AND study_sessions.start_ts < date(month_series.m, '+1 month') \
             GROUP BY month_series.m ORDER BY month_series.m ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StudyStatsBucket {
                label: row.get(0)?,
                minutes: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn course_breakdown(conn: &Connection, days: i64) -> Result<Vec<CourseMinutes>, String> {
    let offset = format!("-{} days", (days - 1).max(0));
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(courses.name, 'No course'), COALESCE(SUM(study_sessions.duration_seconds), 0) / 60 \
             FROM study_sessions LEFT JOIN courses ON courses.id = study_sessions.course_id \
             WHERE date(study_sessions.start_ts) >= date('now', 'localtime', ?1) \
             GROUP BY courses.id HAVING SUM(study_sessions.duration_seconds) > 0 \
             ORDER BY 2 DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![offset], |row| {
            Ok(CourseMinutes {
                course_name: row.get(0)?,
                minutes: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Mirrors course_breakdown exactly, joined against `subjects` instead.
/// Sessions with a course but no subject picked simply don't add to any
/// row here (same "only rows with actual minutes" behavior as courses) —
/// there's no "No subject" catch-all row, since unlike "no course" that
/// case isn't a meaningful grouping to chart on its own.
fn subject_breakdown(conn: &Connection, days: i64) -> Result<Vec<SubjectMinutes>, String> {
    let offset = format!("-{} days", (days - 1).max(0));
    let mut stmt = conn
        .prepare(
            "SELECT subjects.name, COALESCE(SUM(study_sessions.duration_seconds), 0) / 60 \
             FROM study_sessions JOIN subjects ON subjects.id = study_sessions.subject_id \
             WHERE date(study_sessions.start_ts) >= date('now', 'localtime', ?1) \
             GROUP BY subjects.id HAVING SUM(study_sessions.duration_seconds) > 0 \
             ORDER BY 2 DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![offset], |row| {
            Ok(SubjectMinutes {
                subject_name: row.get(0)?,
                minutes: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn day_minutes_offset(conn: &Connection, offset_days: i64) -> Result<i64, String> {
    let modifier = format!("{} days", offset_days);
    conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) / 60 FROM study_sessions WHERE date(start_ts) = date('now', 'localtime', ?1)",
        params![modifier],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn week_start_setting(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT week_start FROM user_settings WHERE id = 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

/// Mirrors the frontend's startOfWeek() in src/pages/Calendar.tsx — same
/// (dayIndex - startIndex + 7) % 7 logic, so "this week" means the same
/// thing on both sides regardless of the user's week_start setting.
fn week_start_date(conn: &Connection, week_start: &str) -> Result<String, String> {
    let target = match week_start {
        "sunday" => 0,
        "monday" => 1,
        "tuesday" => 2,
        "wednesday" => 3,
        "thursday" => 4,
        "friday" => 5,
        "saturday" => 6,
        _ => 1,
    };
    conn.query_row(
        "SELECT date('now', 'localtime', '-' || ((CAST(strftime('%w','now', 'localtime') AS INTEGER) - ?1 + 7) % 7) || ' days')",
        params![target],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn week_minutes(conn: &Connection) -> Result<i64, String> {
    let week_start = week_start_setting(conn)?;
    let start_date = week_start_date(conn, &week_start)?;
    conn.query_row(
        "SELECT COALESCE(SUM(duration_seconds), 0) / 60 FROM study_sessions WHERE date(start_ts) >= ?1",
        params![start_date],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn goal_settings(conn: &Connection) -> Result<(i64, i64), String> {
    conn.query_row(
        "SELECT daily_study_goal_minutes, weekly_study_goal_minutes FROM user_settings WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|e| e.to_string())
}

/// Every distinct calendar date with at least one study session, ascending,
/// paired with its Julian day number so consecutive-day runs are a simple
/// integer comparison rather than string date arithmetic.
fn distinct_study_days(conn: &Connection) -> Result<Vec<(String, i64)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT date(start_ts) as d, CAST(julianday(date(start_ts)) AS INTEGER) as jd \
             FROM study_sessions ORDER BY jd ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Returns (current_streak, longest_streak). Current streak is 0 ("broken")
/// unless the most recently studied day is today or yesterday — matches
/// familiar streak semantics (you haven't lost it yet today, but a 2+ day
/// gap ends it).
fn compute_streaks(conn: &Connection) -> Result<(i64, i64), String> {
    let days = distinct_study_days(conn)?;
    if days.is_empty() {
        return Ok((0, 0));
    }

    let mut longest = 1i64;
    let mut run = 1i64;
    for i in 1..days.len() {
        run = if days[i].1 == days[i - 1].1 + 1 { run + 1 } else { 1 };
        longest = longest.max(run);
    }

    let today_jd: i64 = conn
        .query_row("SELECT CAST(julianday(date('now', 'localtime')) AS INTEGER)", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let last_jd = days.last().unwrap().1;

    let current = if last_jd == today_jd || last_jd == today_jd - 1 {
        let mut c = 1i64;
        for i in (1..days.len()).rev() {
            if days[i].1 == days[i - 1].1 + 1 {
                c += 1;
            } else {
                break;
            }
        }
        c
    } else {
        0
    };

    Ok((current, longest))
}

/// If the streak just ended, returns the date it ended on and how long it
/// ran — used to fire StreakBroken once. Kept as a small separate walk
/// rather than folded into compute_streaks() to keep that function's
/// "what's the streak right now" contract simple.
fn last_completed_streak(conn: &Connection) -> Result<Option<(String, i64)>, String> {
    let days = distinct_study_days(conn)?;
    if days.is_empty() {
        return Ok(None);
    }
    let mut streak = 1i64;
    for i in (1..days.len()).rev() {
        if days[i].1 == days[i - 1].1 + 1 {
            streak += 1;
        } else {
            break;
        }
    }
    Ok(Some((days.last().unwrap().0.clone(), streak)))
}

fn event_already_logged(conn: &Connection, event_type: &str, payload_needle: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM companion_event_log WHERE event_type = ?1 AND payload_json LIKE ?2 LIMIT 1",
        params![event_type, format!("%{payload_needle}%")],
        |_| Ok(()),
    )
    .is_ok()
}

fn fire(conn: &Connection, app: &AppHandle, event_type: CompanionEventType, payload: serde_json::Value) {
    let event = CompanionEvent::new(event_type, payload);
    match engine::process_event(conn, event) {
        Ok(state) => {
            if let Err(e) = app.emit("companion:updated", state) {
                eprintln!("[companion] failed to emit companion:updated: {e}");
            }
        }
        Err(e) => eprintln!("[companion] failed to process {}: {e}", event_type.as_str()),
    }
}

/// Deterministic goal/streak evaluation — no AI. Every event here is
/// idempotent: it checks companion_event_log before firing, using the
/// event's own payload as the "have I already told the companion about
/// this specific milestone/date?" key, so calling this repeatedly (once
/// per session AND once per app load) never double-counts.
pub fn evaluate_goals_and_streaks(conn: &Connection, app: &AppHandle) {
    if let Ok((current_streak, _)) = compute_streaks(conn) {
        for milestone in STREAK_MILESTONES {
            if current_streak == milestone {
                let needle = format!("\"streak\":{milestone}");
                if !event_already_logged(conn, "StudyStreakReached", &needle) {
                    fire(
                        conn,
                        app,
                        CompanionEventType::StudyStreakReached,
                        serde_json::json!({ "streak": milestone }),
                    );
                }
            }
        }

        if current_streak == 0 {
            if let Ok(Some((last_date, prior_streak))) = last_completed_streak(conn) {
                if prior_streak >= 3 {
                    let needle = format!("\"brokenAfter\":\"{last_date}\"");
                    if !event_already_logged(conn, "StreakBroken", &needle) {
                        fire(
                            conn,
                            app,
                            CompanionEventType::StreakBroken,
                            serde_json::json!({ "brokenAfter": last_date }),
                        );
                    }
                }
            }
        }
    }

    if let (Ok(week_start), Ok((_, weekly_goal))) = (week_start_setting(conn), goal_settings(conn)) {
        if weekly_goal > 0 {
            if let Ok(start_date) = week_start_date(conn, &week_start) {
                if let Ok(week_min) = week_minutes(conn) {
                    if week_min >= weekly_goal {
                        let needle = format!("\"weekStart\":\"{start_date}\"");
                        if !event_already_logged(conn, "WeeklyGoalCompleted", &needle) {
                            fire(
                                conn,
                                app,
                                CompanionEventType::WeeklyGoalCompleted,
                                serde_json::json!({ "weekStart": start_date }),
                            );
                        }
                    }
                }
            }
        }
    }

    if let Ok((daily_goal, _)) = goal_settings(conn) {
        if daily_goal > 0 {
            if let Ok(yesterday_minutes) = day_minutes_offset(conn, -1) {
                if yesterday_minutes < daily_goal {
                    if let Ok(yesterday_date) =
                        conn.query_row("SELECT date('now','localtime','-1 days')", [], |row| row.get::<_, String>(0))
                    {
                        let needle = format!("\"date\":\"{yesterday_date}\"");
                        if !event_already_logged(conn, "GoalMissed", &needle) {
                            fire(
                                conn,
                                app,
                                CompanionEventType::GoalMissed,
                                serde_json::json!({ "date": yesterday_date }),
                            );
                        }
                    }
                }
            }
        }
    }
}
