use crate::db::Pool;
use crate::models::{Course, NewSubject, Subject, SubjectScheduleEntry};
use rusqlite::{params, Row};
use tauri::State;

#[tauri::command]
pub fn list_courses(pool: State<Pool>) -> Result<Vec<Course>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, color, archived FROM courses ORDER BY name")
        .map_err(|e| e.to_string())?;
    let courses = stmt
        .query_map([], |row| {
            Ok(Course {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                archived: row.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(courses)
}

fn row_to_course(row: &Row) -> rusqlite::Result<Course> {
    Ok(Course {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        archived: row.get::<_, i64>(3)? != 0,
    })
}

#[tauri::command]
pub fn create_course(pool: State<Pool>, name: String, color: String) -> Result<Course, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO courses (name, color) VALUES (?1, ?2)",
        params![name, color],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, name, color, archived FROM courses WHERE id = ?1",
        params![id],
        row_to_course,
    )
    .map_err(|e| e.to_string())
}

/// Phase 14 (Courses tab). Renaming/recoloring/archiving a course — not
/// exposed until now because nothing in the app needed to edit a course
/// after creating it; the exam/task pickers only ever read the list.
#[tauri::command]
pub fn update_course(
    pool: State<Pool>,
    id: i64,
    name: String,
    color: String,
    archived: bool,
) -> Result<Course, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE courses SET name = ?2, color = ?3, archived = ?4, updated_at = datetime('now') WHERE id = ?1",
        params![id, name, color, archived as i64],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, color, archived FROM courses WHERE id = ?1",
        params![id],
        row_to_course,
    )
    .map_err(|e| e.to_string())
}

/// Deletes a course and, via `ON DELETE CASCADE` (migration 0001), every
/// subject under it (and, via subjects' own cascade to
/// subject_weekly_schedule, their weekly schedules too). Tasks/exams/
/// schedule_blocks that referenced this course have their `course_id`
/// set to NULL rather than being deleted (`ON DELETE SET NULL`,
/// migrations 0001/0007/0010) — a course being removed doesn't erase the
/// tasks/exams that happened to be tagged with it.
#[tauri::command]
pub fn delete_course(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM courses WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Subjects (Phase 5) ----
// The `subjects` table has existed since 0001_init.sql, but nothing in the
// app called into it until the exam tracker needed a real subject picker.
// Kept in this file rather than a new module — subjects are a thin child
// of courses, not their own domain.

fn row_to_subject(row: &Row) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: row.get(0)?,
        course_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
    })
}

/// `course_id = None` lists subjects across all courses (used by the exam
/// analytics view); `Some(id)` scopes to one course (used by the exam
/// form's cascading course → subject picker).
#[tauri::command]
pub fn list_subjects(pool: State<Pool>, course_id: Option<i64>) -> Result<Vec<Subject>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, course_id, name, color FROM subjects \
             WHERE ?1 IS NULL OR course_id = ?1 ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![course_id], row_to_subject)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[tauri::command]
pub fn create_subject(pool: State<Pool>, subject: NewSubject) -> Result<Subject, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO subjects (course_id, name, color) VALUES (?1, ?2, ?3)",
        params![subject.course_id, subject.name, subject.color],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, course_id, name, color FROM subjects WHERE id = ?1",
        params![id],
        row_to_subject,
    )
    .map_err(|e| e.to_string())
}

/// Phase 14 (Courses tab). Deliberately doesn't allow moving a subject to
/// a different course — a real "wrong course" mistake is rare enough,
/// and simple enough to fix by delete + recreate, that a course_id-move
/// path (with its own edge cases around the subject's existing weekly
/// schedule / tasks / exams still pointing at it) isn't worth the
/// complexity yet.
#[tauri::command]
pub fn update_subject(pool: State<Pool>, id: i64, name: String, color: Option<String>) -> Result<Subject, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE subjects SET name = ?2, color = ?3, updated_at = datetime('now') WHERE id = ?1",
        params![id, name, color],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, course_id, name, color FROM subjects WHERE id = ?1",
        params![id],
        row_to_subject,
    )
    .map_err(|e| e.to_string())
}

/// Cascades to this subject's weekly schedule (`ON DELETE CASCADE`,
/// migration 0019). Tasks/exams tagged with this subject have their
/// `subject_id` set to NULL rather than being deleted, same reasoning as
/// `delete_course`.
#[tauri::command]
pub fn delete_subject(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM subjects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Recurring weekly class schedule (Phase 14, migration 0019) ----
// A per-(subject, day) template consumed by commands/calendar.rs to
// compute actual occurrences for whatever date range is being viewed —
// nothing here stores individual dated calendar rows. See migration
// 0019's header comment for why.

const VALID_DAYS: &[&str] = &[
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

fn validate_day(day: &str) -> Result<(), String> {
    if VALID_DAYS.contains(&day) {
        Ok(())
    } else {
        Err(format!(
            "\"{day}\" isn't a day of the week. Expected one of: {}.",
            VALID_DAYS.join(", ")
        ))
    }
}

fn row_to_schedule_entry(row: &Row) -> rusqlite::Result<SubjectScheduleEntry> {
    Ok(SubjectScheduleEntry {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        day_of_week: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
    })
}

#[tauri::command]
pub fn list_weekly_schedule(pool: State<Pool>, subject_id: i64) -> Result<Vec<SubjectScheduleEntry>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, subject_id, day_of_week, start_time, end_time \
             FROM subject_weekly_schedule WHERE subject_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![subject_id], row_to_schedule_entry)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Sets (creating or replacing) this subject's class time for one day of
/// the week — the "flexible" part of the feature: every day is set
/// independently, so a subject can have a different time on each day it
/// meets, and no time at all on days it doesn't.
#[tauri::command]
pub fn set_weekly_schedule_day(
    pool: State<Pool>,
    subject_id: i64,
    day_of_week: String,
    start_time: String,
    end_time: Option<String>,
) -> Result<SubjectScheduleEntry, String> {
    validate_day(&day_of_week)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO subject_weekly_schedule (subject_id, day_of_week, start_time, end_time) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(subject_id, day_of_week) DO UPDATE SET \
         start_time = excluded.start_time, end_time = excluded.end_time, updated_at = datetime('now')",
        params![subject_id, day_of_week, start_time, end_time],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, subject_id, day_of_week, start_time, end_time FROM subject_weekly_schedule \
         WHERE subject_id = ?1 AND day_of_week = ?2",
        params![subject_id, day_of_week],
        row_to_schedule_entry,
    )
    .map_err(|e| e.to_string())
}

/// Clears a subject's class time for one day — "no class this day".
#[tauri::command]
pub fn remove_weekly_schedule_day(pool: State<Pool>, subject_id: i64, day_of_week: String) -> Result<(), String> {
    validate_day(&day_of_week)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM subject_weekly_schedule WHERE subject_id = ?1 AND day_of_week = ?2",
        params![subject_id, day_of_week],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

