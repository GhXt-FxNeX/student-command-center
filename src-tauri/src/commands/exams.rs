use crate::companion::engine;
use crate::companion::events::{CompanionEvent, CompanionEventType};
use crate::db::Pool;
use crate::models::{Exam, ExamStats, NewExam, SubjectAverage};
use rusqlite::{params, Connection, Row};
use tauri::{AppHandle, Emitter, State};

/// `percentage` is never a stored column (migration 0007/0008 header
/// comments) — always score / max_score * 100 when both are present,
/// computed here at read time so it can never drift out of sync.
/// course_name/subject_name come from the LEFT JOINs below so the frontend
/// gets display-ready rows in one round trip.
const SELECT_EXAM_SQL: &str = "SELECT e.id, e.name, e.course_id, c.name AS course_name, \
    e.subject_id, s.name AS subject_name, e.date, e.status, e.score, e.max_score, e.notes, \
    e.created_at, e.updated_at \
    FROM exams e \
    LEFT JOIN courses c ON c.id = e.course_id \
    LEFT JOIN subjects s ON s.id = e.subject_id";

fn row_to_exam(row: &Row) -> rusqlite::Result<Exam> {
    let score: Option<f64> = row.get("score")?;
    let max_score: Option<f64> = row.get("max_score")?;
    // A missing result is never interpreted as zero — percentage only
    // exists when both score and max_score are genuinely present.
    let percentage = match (score, max_score) {
        (Some(s), Some(m)) if m > 0.0 => Some((s / m) * 100.0),
        _ => None,
    };
    Ok(Exam {
        id: row.get("id")?,
        name: row.get("name")?,
        course_id: row.get("course_id")?,
        course_name: row.get("course_name")?,
        subject_id: row.get("subject_id")?,
        subject_name: row.get("subject_name")?,
        date: row.get("date")?,
        status: row.get("status")?,
        score,
        max_score,
        percentage,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[tauri::command]
pub fn list_exams(pool: State<Pool>) -> Result<Vec<Exam>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_EXAM_SQL} ORDER BY e.date DESC, e.id DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_exam)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Validates a (score, max_score) pair against the exam-result rules and
/// returns them unchanged if valid. Both-or-neither, score >= 0, max_score
/// > 0, score <= max_score. `(None, None)` — no result yet — is always
/// valid and passes straight through.
fn validate_result(score: Option<f64>, max_score: Option<f64>) -> Result<(Option<f64>, Option<f64>), String> {
    match (score, max_score) {
        (None, None) => Ok((None, None)),
        (Some(_), None) => Err("Total score is required when a score is entered.".to_string()),
        (None, Some(_)) => Err("Score is required when a total score is entered.".to_string()),
        (Some(s), Some(m)) => {
            if m <= 0.0 {
                return Err("Total score must be greater than 0.".to_string());
            }
            if s < 0.0 {
                return Err("Score cannot be negative.".to_string());
            }
            if s > m {
                return Err("Score cannot exceed the total score.".to_string());
            }
            Ok((Some(s), Some(m)))
        }
    }
}

/// The single source of truth for an exam's stored status. A valid result
/// always promotes the exam to "completed" — the caller's requested status
/// only decides between "upcoming" and "awaiting_result" when there's no
/// result, matching the spec's "entering a score automatically completes
/// the exam" behavior rather than requiring a separate manual step.
fn resolve_status(requested: &str, has_result: bool) -> &'static str {
    if has_result {
        "completed"
    } else if requested == "awaiting_result" {
        "awaiting_result"
    } else {
        "upcoming"
    }
}

/// Recording a *result* fires `ExamCompleted`; a strong result additionally
/// fires `HighExamScore` (>=95%) and/or `PerfectExamScore` (100%). These
/// stack — a perfect exam fires all three, same multi-event pattern as
/// `complete_pomodoro_session` in study.rs. Creating an upcoming or
/// awaiting-result exam (no score yet) does NOT fire anything — there's
/// nothing to reward until a real result exists.
#[tauri::command]
pub fn create_exam(pool: State<Pool>, app: AppHandle, exam: NewExam) -> Result<Exam, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let (score, max_score) = validate_result(exam.score, exam.max_score)?;
    let status = resolve_status(&exam.status, score.is_some());

    conn.execute(
        "INSERT INTO exams (name, course_id, subject_id, date, status, score, max_score, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            exam.name,
            exam.course_id,
            exam.subject_id,
            exam.date,
            status,
            score,
            max_score,
            exam.notes,
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let created = get_exam(&conn, id)?;

    if created.status == "completed" {
        emit_result_events(&conn, &app, &created);
    }

    Ok(created)
}

/// Editing an exam can legitimately move it through the lifecycle
/// (upcoming → awaiting_result → completed), so unlike `create_exam` this
/// has to compare status *before* and *after* the write: companion events
/// only fire on the transition INTO "completed" for the first time. Editing
/// an already-completed exam (e.g. fixing a typo in the score) never
/// re-fires — same anti-farming guarantee as before, just keyed off the
/// correct transition now that completion can happen via update too.
#[tauri::command]
pub fn update_exam(pool: State<Pool>, app: AppHandle, id: i64, exam: NewExam) -> Result<Exam, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let previous = get_exam(&conn, id)?;
    let (score, max_score) = validate_result(exam.score, exam.max_score)?;
    let status = resolve_status(&exam.status, score.is_some());

    conn.execute(
        "UPDATE exams SET name = ?1, course_id = ?2, subject_id = ?3, date = ?4, status = ?5, \
         score = ?6, max_score = ?7, notes = ?8, updated_at = datetime('now') WHERE id = ?9",
        params![
            exam.name,
            exam.course_id,
            exam.subject_id,
            exam.date,
            status,
            score,
            max_score,
            exam.notes,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    let updated = get_exam(&conn, id)?;

    if updated.status == "completed" && previous.status != "completed" {
        emit_result_events(&conn, &app, &updated);
    }

    Ok(updated)
}

#[tauri::command]
pub fn delete_exam(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM exams WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_exam(conn: &Connection, id: i64) -> Result<Exam, String> {
    conn.query_row(
        &format!("{SELECT_EXAM_SQL} WHERE e.id = ?1"),
        params![id],
        row_to_exam,
    )
    .map_err(|e| e.to_string())
}

fn emit_result_events(conn: &Connection, app: &AppHandle, exam: &Exam) {
    emit_exam_event(conn, app, CompanionEventType::ExamCompleted, exam.id);
    if let Some(pct) = exam.percentage {
        if pct >= 95.0 {
            emit_exam_event(conn, app, CompanionEventType::HighExamScore, exam.id);
        }
        if pct >= 100.0 {
            emit_exam_event(conn, app, CompanionEventType::PerfectExamScore, exam.id);
        }
    }
}

/// Same "process one companion event and push the result to the frontend"
/// helper pattern as tasks.rs/study.rs — kept local rather than shared
/// since each copy is tiny and the domain modules don't otherwise depend
/// on each other.
fn emit_exam_event(conn: &Connection, app: &AppHandle, event_type: CompanionEventType, exam_id: i64) {
    let event = CompanionEvent::new(event_type, serde_json::json!({ "examId": exam_id }));
    match engine::process_event(conn, event) {
        Ok(state) => {
            if let Err(e) = app.emit("companion:updated", state) {
                eprintln!("[companion] failed to emit companion:updated: {e}");
            }
        }
        Err(e) => eprintln!("[companion] failed to process {}: {e}", event_type.as_str()),
    }
}

// ---- Analytics (deterministic — no AI, per architecture.md §9/§62) ----
// Every query here is scoped to status = 'completed' — upcoming and
// awaiting-result exams must never influence these numbers (they have no
// score to average in the first place, but the explicit filter also makes
// the intent unambiguous rather than relying on incidental NULL behavior).

#[tauri::command]
pub fn get_exam_stats(pool: State<Pool>) -> Result<ExamStats, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;

    let completed_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM exams WHERE status = 'completed'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let overall_average: Option<f64> = conn
        .query_row(
            "SELECT AVG(score * 100.0 / max_score) FROM exams WHERE status = 'completed'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut all_stmt = conn
        .prepare(&format!("{SELECT_EXAM_SQL} WHERE e.status = 'completed'"))
        .map_err(|e| e.to_string())?;
    let completed_exams: Vec<Exam> = all_stmt
        .query_map([], row_to_exam)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let highest = completed_exams.iter().cloned().max_by(|a, b| {
        a.percentage
            .partial_cmp(&b.percentage)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let lowest = completed_exams.iter().cloned().min_by(|a, b| {
        a.percentage
            .partial_cmp(&b.percentage)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut subject_stmt = conn
        .prepare(
            "SELECT s.id, s.name, AVG(e.score * 100.0 / e.max_score), COUNT(*) \
             FROM exams e JOIN subjects s ON s.id = e.subject_id \
             WHERE e.status = 'completed' \
             GROUP BY s.id, s.name ORDER BY s.name",
        )
        .map_err(|e| e.to_string())?;
    let by_subject: Vec<SubjectAverage> = subject_stmt
        .query_map([], |row| {
            Ok(SubjectAverage {
                subject_id: row.get(0)?,
                subject_name: row.get(1)?,
                average_percentage: row.get(2)?,
                exam_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(ExamStats {
        completed_count,
        overall_average,
        highest,
        lowest,
        by_subject,
    })
}
