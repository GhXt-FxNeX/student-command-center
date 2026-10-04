use crate::db::Pool;
use crate::models::CalendarItem;
use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::params;
use tauri::State;

fn weekday_name(w: Weekday) -> &'static str {
    match w {
        Weekday::Mon => "monday",
        Weekday::Tue => "tuesday",
        Weekday::Wed => "wednesday",
        Weekday::Thu => "thursday",
        Weekday::Fri => "friday",
        Weekday::Sat => "saturday",
        Weekday::Sun => "sunday",
    }
}

/// Calendar items are derived from existing tables (tasks by deadline,
/// study_sessions by start_ts, exams by date, schedule_blocks by
/// start_ts) rather than a separate calendar_events table. Simpler and
/// avoids duplicated/desyncable data; other event sources get added here
/// the same way as those phases land, rather than needing their own
/// generic-pointer table.
#[tauri::command]
pub fn get_calendar_range(
    pool: State<Pool>,
    start_date: String,
    end_date: String,
) -> Result<Vec<CalendarItem>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    let mut task_stmt = conn
        .prepare(
            "SELECT id, title, deadline, course_id, status FROM tasks \
             WHERE deadline IS NOT NULL AND date(deadline) BETWEEN date(?1) AND date(?2)",
        )
        .map_err(|e| e.to_string())?;
    let tasks = task_stmt
        .query_map(params![start_date, end_date], |row| {
            let status: String = row.get(4)?;
            Ok(CalendarItem {
                id: format!("task:{}", row.get::<_, i64>(0)?),
                title: row.get(1)?,
                item_type: "task".to_string(),
                start: row.get(2)?,
                end: None,
                course_id: row.get(3)?,
                completed: status == "completed",
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok);
    items.extend(tasks);

    let mut session_stmt = conn
        .prepare(
            "SELECT id, type, start_ts, end_ts, course_id FROM study_sessions \
             WHERE date(start_ts) BETWEEN date(?1) AND date(?2)",
        )
        .map_err(|e| e.to_string())?;
    let sessions = session_stmt
        .query_map(params![start_date, end_date], |row| {
            let session_type: String = row.get(1)?;
            Ok(CalendarItem {
                id: format!("session:{}", row.get::<_, i64>(0)?),
                title: if session_type == "pomodoro" {
                    "Pomodoro session".to_string()
                } else {
                    "Study session".to_string()
                },
                item_type: "study_session".to_string(),
                start: row.get(2)?,
                end: row.get(3)?,
                course_id: row.get(4)?,
                completed: true,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok);
    items.extend(sessions);

    let mut exam_stmt = conn
        .prepare(
            "SELECT id, name, date, course_id FROM exams \
             WHERE date(date) BETWEEN date(?1) AND date(?2)",
        )
        .map_err(|e| e.to_string())?;
    let exams = exam_stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(CalendarItem {
                id: format!("exam:{}", row.get::<_, i64>(0)?),
                title: row.get(1)?,
                item_type: "exam".to_string(),
                start: row.get(2)?,
                end: None,
                course_id: row.get(3)?,
                // An exam on the calendar is a scheduled/recorded fact, not
                // a completable checkbox item — always true so it never
                // picks up a task's "incomplete" styling on the frontend.
                completed: true,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok);
    items.extend(exams);

    let mut block_stmt = conn
        .prepare(
            "SELECT id, title, start_ts, end_ts, course_id, completed FROM schedule_blocks \
             WHERE date(start_ts) BETWEEN date(?1) AND date(?2)",
        )
        .map_err(|e| e.to_string())?;
    let blocks = block_stmt
        .query_map(params![start_date, end_date], |row| {
            let completed: i64 = row.get(5)?;
            Ok(CalendarItem {
                id: format!("block:{}", row.get::<_, i64>(0)?),
                title: row.get(1)?,
                item_type: "schedule_block".to_string(),
                start: row.get(2)?,
                end: row.get(3)?,
                course_id: row.get(4)?,
                completed: completed != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok);
    items.extend(blocks);

    // Phase 14 (Courses tab): recurring weekly class times. Not stored as
    // dated rows — this expands each subject's per-day-of-week template
    // (subject_weekly_schedule, migration 0019) into actual occurrences
    // for the requested [start_date, end_date] range, computed fresh on
    // every call. Editing a subject's weekly time immediately affects
    // every future week without touching a single stored calendar row.
    let mut weekly_stmt = conn
        .prepare(
            "SELECT sws.id, s.name, sws.day_of_week, sws.start_time, sws.end_time, s.course_id \
             FROM subject_weekly_schedule sws JOIN subjects s ON s.id = sws.subject_id",
        )
        .map_err(|e| e.to_string())?;
    struct WeeklyRow {
        id: i64,
        subject_name: String,
        day_of_week: String,
        start_time: String,
        end_time: Option<String>,
        course_id: i64,
    }
    let weekly_rows: Vec<WeeklyRow> = weekly_stmt
        .query_map([], |row| {
            Ok(WeeklyRow {
                id: row.get(0)?,
                subject_name: row.get(1)?,
                day_of_week: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                course_id: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    if !weekly_rows.is_empty() {
        // Malformed date strings here would mean the frontend sent
        // something other than "YYYY-MM-DD" — fail loudly rather than
        // silently skipping recurring classes for the whole range.
        let range_start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
            .map_err(|e| format!("Invalid start_date: {e}"))?;
        let range_end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
            .map_err(|e| format!("Invalid end_date: {e}"))?;

        let mut cursor = range_start;
        while cursor <= range_end {
            let day_name = weekday_name(cursor.weekday());
            let date_str = cursor.format("%Y-%m-%d").to_string();
            for w in &weekly_rows {
                if w.day_of_week == day_name {
                    items.push(CalendarItem {
                        id: format!("class:{}:{date_str}", w.id),
                        title: w.subject_name.clone(),
                        item_type: "class".to_string(),
                        start: format!("{date_str}T{}:00", w.start_time),
                        end: w
                            .end_time
                            .as_ref()
                            .map(|t| format!("{date_str}T{t}:00")),
                        course_id: Some(w.course_id),
                        completed: true,
                    });
                }
            }
            match cursor.succ_opt() {
                Some(next) => cursor = next,
                None => break,
            }
        }
    }

    items.sort_by(|a, b| a.start.cmp(&b.start));
    Ok(items)
}
