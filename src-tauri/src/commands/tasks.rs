use crate::db::Pool;
use crate::models::{NewTask, Task};
use rusqlite::{params, Row};
use tauri::{Emitter, State};

/// Same shape as commands/planner.rs::validate_block_times — kept as a
/// separate small copy rather than a shared helper, since the two structs
/// (Task vs NewScheduleBlock) aren't related and a shared fn would need an
/// awkward generic signature for two call sites. Both scheduled_start and
/// scheduled_end must be set together or not at all: a task's fixed time
/// is a hard constraint the AI Planner treats as authoritative (see
/// commands/planner.rs's FixedTime handling), so malformed data here
/// would silently break that guarantee rather than just look wrong in a
/// form.
fn validate_scheduled_time(scheduled_start: &Option<String>, scheduled_end: &Option<String>) -> Result<(), String> {
    match (scheduled_start, scheduled_end) {
        (None, None) => Ok(()),
        (Some(_), None) => Err("A scheduled end time is required when a start time is set.".to_string()),
        (None, Some(_)) => Err("A scheduled start time is required when an end time is set.".to_string()),
        (Some(start), Some(end)) => {
            let start_date = start.get(0..10).ok_or_else(|| "Invalid scheduled start time format.".to_string())?;
            let end_date = end.get(0..10).ok_or_else(|| "Invalid scheduled end time format.".to_string())?;
            if start_date != end_date {
                return Err(
                    "A task's fixed time can't cross midnight — start and end must be on the same day.".to_string(),
                );
            }
            if start.as_str() >= end.as_str() {
                return Err("Scheduled start time must be before the scheduled end time.".to_string());
            }
            Ok(())
        }
    }
}

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    let tags_json: String = row.get("tags_json")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        course_id: row.get("course_id")?,
        priority: row.get("priority")?,
        difficulty: row.get("difficulty")?,
        estimated_minutes: row.get("estimated_minutes")?,
        deadline: row.get("deadline")?,
        scheduled_start: row.get("scheduled_start")?,
        scheduled_end: row.get("scheduled_end")?,
        status: row.get("status")?,
        tags,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const SELECT_TASK_COLUMNS: &str = "id, title, description, course_id, priority, difficulty, \
    estimated_minutes, deadline, scheduled_start, scheduled_end, status, tags_json, notes, \
    created_at, updated_at";

#[tauri::command]
pub fn list_tasks(pool: State<Pool>) -> Result<Vec<Task>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_TASK_COLUMNS} FROM tasks ORDER BY \
             CASE status WHEN 'completed' THEN 1 ELSE 0 END, \
             CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, \
             deadline IS NULL, deadline ASC"
        ))
        .map_err(|e| e.to_string())?;
    let tasks = stmt
        .query_map([], row_to_task)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(tasks)
}

#[tauri::command]
pub fn create_task(pool: State<Pool>, task: NewTask) -> Result<Task, String> {
    validate_scheduled_time(&task.scheduled_start, &task.scheduled_end)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&task.tags).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO tasks (title, description, course_id, priority, difficulty, \
         estimated_minutes, deadline, scheduled_start, scheduled_end, tags_json, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            task.title,
            task.description,
            task.course_id,
            task.priority,
            task.difficulty,
            task.estimated_minutes,
            task.deadline,
            task.scheduled_start,
            task.scheduled_end,
            tags_json,
            task.notes,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    get_task(&conn, id)
}

#[tauri::command]
pub fn update_task(pool: State<Pool>, id: i64, task: NewTask) -> Result<Task, String> {
    validate_scheduled_time(&task.scheduled_start, &task.scheduled_end)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&task.tags).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tasks SET title = ?1, description = ?2, course_id = ?3, priority = ?4, \
         difficulty = ?5, estimated_minutes = ?6, deadline = ?7, scheduled_start = ?8, \
         scheduled_end = ?9, tags_json = ?10, notes = ?11, updated_at = datetime('now') \
         WHERE id = ?12",
        params![
            task.title,
            task.description,
            task.course_id,
            task.priority,
            task.difficulty,
            task.estimated_minutes,
            task.deadline,
            task.scheduled_start,
            task.scheduled_end,
            tags_json,
            task.notes,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_task(&conn, id)
}

#[tauri::command]
pub fn set_task_status(
    pool: State<Pool>,
    app: tauri::AppHandle,
    id: i64,
    status: String,
) -> Result<Task, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tasks SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![status, id],
    )
    .map_err(|e| e.to_string())?;

    if status == "completed" {
        let task = get_task(&conn, id)?;
        let event_type = if task.priority == "high" || task.difficulty == "hard" {
            crate::companion::events::CompanionEventType::MajorTaskCompleted
        } else {
            crate::companion::events::CompanionEventType::TaskCompleted
        };
        let event = crate::companion::events::CompanionEvent::new(
            event_type,
            serde_json::json!({ "taskId": id }),
        );
        match crate::companion::engine::process_event(&conn, event) {
            Ok(state) => {
                // Frontend listens for this via useCompanion() so the widget
                // updates live without polling. A failure to emit is logged,
                // not fatal — the task itself already saved successfully.
                if let Err(e) = app.emit("companion:updated", state) {
                    eprintln!("[companion] failed to emit companion:updated: {e}");
                }
            }
            Err(e) => eprintln!("[companion] failed to process TaskCompleted event: {e}"),
        }
    }

    get_task(&conn, id)
}

#[tauri::command]
pub fn duplicate_task(pool: State<Pool>, id: i64) -> Result<Task, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let original = get_task(&conn, id)?;
    conn.execute(
        "INSERT INTO tasks (title, description, course_id, priority, difficulty, \
         estimated_minutes, deadline, tags_json, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            format!("{} (copy)", original.title),
            original.description,
            original.course_id,
            original.priority,
            original.difficulty,
            original.estimated_minutes,
            original.deadline,
            serde_json::to_string(&original.tags).map_err(|e| e.to_string())?,
            original.notes,
        ],
    )
    .map_err(|e| e.to_string())?;
    let new_id = conn.last_insert_rowid();
    get_task(&conn, new_id)
}

#[tauri::command]
pub fn delete_task(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_task(conn: &rusqlite::Connection, id: i64) -> Result<Task, String> {
    conn.query_row(
        &format!("SELECT {SELECT_TASK_COLUMNS} FROM tasks WHERE id = ?1"),
        params![id],
        row_to_task,
    )
    .map_err(|e| e.to_string())
}
