use crate::commands::analytics;
use crate::companion::events::{CompanionEvent, CompanionEventType};
use crate::companion::engine;
use crate::db::Pool;
use crate::models::{NewStudySession, StudySession};
use rusqlite::{params, Row};
use tauri::{AppHandle, Emitter, State};

fn row_to_session(row: &Row) -> rusqlite::Result<StudySession> {
    Ok(StudySession {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        course_id: row.get("course_id")?,
        subject_id: row.get("subject_id")?,
        start_ts: row.get("start_ts")?,
        end_ts: row.get("end_ts")?,
        duration_seconds: row.get("duration_seconds")?,
        session_type: row.get("type")?,
        completed: row.get::<_, i64>("completed")? != 0,
    })
}

const SELECT_SESSION_COLUMNS: &str =
    "id, task_id, course_id, subject_id, start_ts, end_ts, duration_seconds, type, completed";

/// Manual "I forgot to use the timer" entry (spec §23). Emits the same
/// StudySessionCompleted event a Pomodoro session does — the companion
/// doesn't care how the study time happened, only that it did.
#[tauri::command]
pub fn create_study_session(
    pool: State<Pool>,
    app: AppHandle,
    session: NewStudySession,
) -> Result<StudySession, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO study_sessions (task_id, course_id, subject_id, start_ts, end_ts, duration_seconds, type, completed) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)",
        params![
            session.task_id,
            session.course_id,
            session.subject_id,
            session.start_ts,
            session.end_ts,
            session.duration_seconds,
            session.session_type,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();

    emit_study_session_completed(&conn, &app);
    analytics::evaluate_goals_and_streaks(&conn, &app);

    get_session(&conn, id)
}

/// Called when a Pomodoro work interval finishes. Logs both a study_session
/// row (type='pomodoro') and its pomodoro_sessions detail row, then feeds
/// the companion engine two events: PomodoroCompleted and
/// StudySessionCompleted. Both already have cooldowns seeded in xp_rules
/// (Phase 1B), so this doesn't need any new companion-side code — that
/// headroom was left deliberately.
#[tauri::command]
pub fn complete_pomodoro_session(
    pool: State<Pool>,
    app: AppHandle,
    work_minutes: i64,
    break_minutes: i64,
    task_id: Option<i64>,
    course_id: Option<i64>,
    subject_id: Option<i64>,
) -> Result<StudySession, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let duration_seconds = work_minutes * 60;

    conn.execute(
        "INSERT INTO study_sessions (task_id, course_id, subject_id, start_ts, end_ts, duration_seconds, type, completed) \
         VALUES (?1, ?2, ?3, datetime('now', 'localtime', ?4), datetime('now', 'localtime'), ?5, 'pomodoro', 1)",
        params![
            task_id,
            course_id,
            subject_id,
            format!("-{duration_seconds} seconds"),
            duration_seconds,
        ],
    )
    .map_err(|e| e.to_string())?;
    let session_id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO pomodoro_sessions (study_session_id, work_minutes, break_minutes) VALUES (?1, ?2, ?3)",
        params![session_id, work_minutes, break_minutes],
    )
    .map_err(|e| e.to_string())?;

    emit_event(&conn, &app, CompanionEventType::PomodoroCompleted, session_id);
    emit_study_session_completed(&conn, &app);
    analytics::evaluate_goals_and_streaks(&conn, &app);

    get_session(&conn, session_id)
}

fn emit_study_session_completed(conn: &rusqlite::Connection, app: &AppHandle) {
    emit_event(conn, app, CompanionEventType::StudySessionCompleted, 0);
}

/// Shared "process one companion event and push the result to the frontend"
/// helper — same pattern as tasks.rs's set_task_status, kept small enough
/// that new event sources (exams, flashcards, streaks in later phases) can
/// copy it without needing to touch the companion engine itself.
fn emit_event(conn: &rusqlite::Connection, app: &AppHandle, event_type: CompanionEventType, ref_id: i64) {
    let event = CompanionEvent::new(event_type, serde_json::json!({ "refId": ref_id }));
    match engine::process_event(conn, event) {
        Ok(state) => {
            if let Err(e) = app.emit("companion:updated", state) {
                eprintln!("[companion] failed to emit companion:updated: {e}");
            }
        }
        Err(e) => eprintln!("[companion] failed to process {}: {e}", event_type.as_str()),
    }
}

fn get_session(conn: &rusqlite::Connection, id: i64) -> Result<StudySession, String> {
    conn.query_row(
        &format!("SELECT {SELECT_SESSION_COLUMNS} FROM study_sessions WHERE id = ?1"),
        params![id],
        row_to_session,
    )
    .map_err(|e| e.to_string())
}
