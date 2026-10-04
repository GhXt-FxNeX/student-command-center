//! Schedule block CRUD + AI plan generation (architecture.md roadmap
//! phase 7).
//!
//! Timestamp handling: `start_ts`/`end_ts` are always plain
//! "YYYY-MM-DDTHH:MM:SS" strings built by string concatenation of a
//! "YYYY-MM-DD" date and an "HH:MM" time — never a `Date`/timestamp
//! object, never a UTC conversion, anywhere in this file. Every other
//! timestamp-bearing table in this app (study_sessions, and Pomodoro's
//! writes to it) only ever gets read back via its date *prefix*
//! (`date(start_ts)` in SQL, `.substring(0,10)` in TS) — this is the
//! first feature that needs an exact clock time round-tripped correctly,
//! so it's the first place that distinction actually matters. Keeping the
//! whole pipeline as plain local strings, with no Date object constructed
//! on either end, sidesteps the exact class of bug documented in
//! lib/date.ts's header comment.
//!
//! generate_plan/reoptimize_plan are async fn + spawn_blocking, same
//! reasoning as commands/ai.rs: they call into AiProvider::generate(),
//! which uses reqwest::blocking and must not run on Tauri's main thread.
//!
//! Task-time semantics (derived from existing `tasks` columns — no new
//! schema, no stored classification, since it's fully computable from
//! what's already there):
//!   - FixedTime: `scheduled_start`/`scheduled_end` both set for the plan
//!     date — a hard constraint. Never shown to the AI as schedulable
//!     (see `gather_tasks`); materialized directly into a locked
//!     schedule_block from the task's own data (see
//!     `materialize_fixed_task_blocks`), so the AI has no opportunity to
//!     move, resize, or reinterpret it, and no need to.
//!   - Flexible: `estimated_minutes` set, no fixed time — the AI proposes
//!     a placement, deterministically validated afterward.
//!   - Deadline: `deadline` set, used as prompt context (`days_until_deadline`)
//!     to prioritize; not otherwise time-constrained.
//!   - Unscheduled: none of the above — still eligible for the AI to
//!     place if it has an estimate, otherwise just informational.

use crate::ai::prompts::planner::{
    generate_plan_blocks, parse_hhmm_to_minutes, PlannerContext, PlannerExamInfo, PlannerTaskInfo,
};
use crate::ai::{router, GenOpts};
use crate::commands::settings::get_settings_from_pool;
use crate::db::Pool;
use crate::models::{NewScheduleBlock, PlanRequest, PlanResult, ScheduleBlock, UserSettings};
use rusqlite::{params, Connection, OptionalExtension, Row};
use tauri::{AppHandle, State};

const SELECT_BLOCK_SQL: &str = "SELECT sb.id, sb.task_id, t.title AS task_title, sb.course_id, \
    c.name AS course_name, sb.subject_id, sb.title, sb.start_ts, sb.end_ts, sb.source, sb.locked, \
    sb.completed, sb.ai_reason, sb.created_at, sb.updated_at \
    FROM schedule_blocks sb \
    LEFT JOIN tasks t ON t.id = sb.task_id \
    LEFT JOIN courses c ON c.id = sb.course_id";

fn row_to_block(row: &Row) -> rusqlite::Result<ScheduleBlock> {
    Ok(ScheduleBlock {
        id: row.get("id")?,
        task_id: row.get("task_id")?,
        task_title: row.get("task_title")?,
        course_id: row.get("course_id")?,
        course_name: row.get("course_name")?,
        subject_id: row.get("subject_id")?,
        title: row.get("title")?,
        start_ts: row.get("start_ts")?,
        end_ts: row.get("end_ts")?,
        source: row.get("source")?,
        locked: row.get::<_, i64>("locked")? != 0,
        completed: row.get::<_, i64>("completed")? != 0,
        ai_reason: row.get("ai_reason")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn get_block(conn: &Connection, id: i64) -> Result<ScheduleBlock, String> {
    conn.query_row(&format!("{SELECT_BLOCK_SQL} WHERE sb.id = ?1"), params![id], row_to_block)
        .map_err(|e| e.to_string())
}

// ---- CRUD ----

#[tauri::command]
pub fn list_schedule_blocks(pool: State<Pool>, date: String) -> Result<Vec<ScheduleBlock>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{SELECT_BLOCK_SQL} WHERE date(sb.start_ts) = date(?1) ORDER BY sb.start_ts"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], row_to_block)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn validate_block_times(start_ts: &str, end_ts: &str) -> Result<(), String> {
    let start_date = start_ts.get(0..10).ok_or_else(|| "Invalid start time format.".to_string())?;
    let end_date = end_ts.get(0..10).ok_or_else(|| "Invalid end time format.".to_string())?;
    if start_date != end_date {
        return Err("A schedule block can't cross midnight — start and end must be on the same day.".to_string());
    }
    if start_ts >= end_ts {
        return Err("Start time must be before end time.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn create_schedule_block(pool: State<Pool>, block: NewScheduleBlock) -> Result<ScheduleBlock, String> {
    if block.title.trim().is_empty() {
        return Err("Title can't be empty.".to_string());
    }
    validate_block_times(&block.start_ts, &block.end_ts)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO schedule_blocks (task_id, course_id, subject_id, title, start_ts, end_ts, source, locked) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual', ?7)",
        params![
            block.task_id,
            block.course_id,
            block.subject_id,
            block.title.trim(),
            block.start_ts,
            block.end_ts,
            block.locked as i64,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_block(&conn, conn.last_insert_rowid())
}

#[tauri::command]
pub fn update_schedule_block(pool: State<Pool>, id: i64, block: NewScheduleBlock) -> Result<ScheduleBlock, String> {
    if block.title.trim().is_empty() {
        return Err("Title can't be empty.".to_string());
    }
    validate_block_times(&block.start_ts, &block.end_ts)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE schedule_blocks SET task_id = ?1, course_id = ?2, subject_id = ?3, title = ?4, \
         start_ts = ?5, end_ts = ?6, locked = ?7, updated_at = datetime('now') WHERE id = ?8",
        params![
            block.task_id,
            block.course_id,
            block.subject_id,
            block.title.trim(),
            block.start_ts,
            block.end_ts,
            block.locked as i64,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_block(&conn, id)
}

/// Only ever cascades to the linked task on *completing* (true), never on
/// un-completing — unchecking a block here shouldn't silently revert
/// progress the user tracked from the Tasks page. Reuses
/// `tasks::set_task_status` directly rather than duplicating its
/// companion-event logic (TaskCompleted/MajorTaskCompleted fire exactly
/// as they would from the Tasks page).
#[tauri::command]
pub fn set_schedule_block_completed(
    pool: State<Pool>,
    app: AppHandle,
    id: i64,
    completed: bool,
) -> Result<ScheduleBlock, String> {
    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE schedule_blocks SET completed = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![completed as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let task_id = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        get_block(&conn, id)?.task_id
    };

    if completed {
        if let Some(task_id) = task_id {
            crate::commands::tasks::set_task_status(pool.clone(), app, task_id, "completed".to_string())?;
        }
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    get_block(&conn, id)
}

#[tauri::command]
pub fn delete_schedule_block(pool: State<Pool>, id: i64) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM schedule_blocks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Deterministic gathering + capacity check (architecture.md §62: no
// AI call for anything computable directly) ----

/// Everything the AI is allowed to place: incomplete tasks that do NOT
/// already have a fixed time on `date`. Excluding fixed-for-this-date
/// tasks here (rather than just hoping the AI leaves them alone) is what
/// makes it structurally impossible for the AI to "schedule" one — the
/// existing taskId validation in ai/prompts/planner.rs already rejects
/// any block referencing an id outside this list, so a fixed task simply
/// isn't a valid thing for the AI to reference, by construction.
fn gather_tasks(conn: &Connection, date: &str) -> Result<Vec<PlannerTaskInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.title, c.name, t.priority, t.difficulty, t.estimated_minutes, \
             CASE WHEN t.deadline IS NULL THEN NULL \
                  ELSE CAST(julianday(t.deadline) - julianday(date('now', 'localtime')) AS INTEGER) END \
             FROM tasks t LEFT JOIN courses c ON c.id = t.course_id \
             WHERE t.status IN ('not_started', 'in_progress') \
               AND NOT ( \
                 t.scheduled_start IS NOT NULL AND t.scheduled_end IS NOT NULL \
                 AND date(t.scheduled_start) = date(?1) \
               ) \
             ORDER BY (t.deadline IS NULL), t.deadline ASC, \
                       CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END \
             LIMIT 20",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], |row| {
            Ok(PlannerTaskInfo {
                id: row.get(0)?,
                title: row.get(1)?,
                course_name: row.get(2)?,
                priority: row.get(3)?,
                difficulty: row.get(4)?,
                estimated_minutes: row.get(5)?,
                days_until_deadline: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// A task with a user-set scheduled_start/scheduled_end on `date` — a
/// FixedTime task (see this file's module doc comment for the four task-
/// time concepts: FixedTime / Flexible / Deadline / Unscheduled). This is
/// a hard constraint: the AI is never shown these as schedulable (see
/// gather_tasks above) and never gets the chance to move, resize, or
/// reinterpret them — they're materialized as locked schedule_blocks
/// directly from the task's own data, deterministically, before the AI is
/// ever called (see materialize_fixed_task_blocks / run_plan_generation).
struct FixedTaskInfo {
    task_id: i64,
    title: String,
    course_id: Option<i64>,
    start_time: String, // "HH:MM"
    end_time: String,   // "HH:MM"
}

fn gather_fixed_tasks(conn: &Connection, date: &str) -> Result<Vec<FixedTaskInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, course_id, scheduled_start, scheduled_end FROM tasks \
             WHERE status IN ('not_started', 'in_progress') \
               AND scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL \
               AND date(scheduled_start) = date(?1) \
             ORDER BY scheduled_start",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], |row| {
            let start_ts: String = row.get(3)?;
            let end_ts: String = row.get(4)?;
            Ok(FixedTaskInfo {
                task_id: row.get(0)?,
                title: row.get(1)?,
                course_id: row.get(2)?,
                start_time: start_ts.get(11..16).unwrap_or("").to_string(),
                end_time: end_ts.get(11..16).unwrap_or("").to_string(),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|t: &FixedTaskInfo| !t.start_time.is_empty() && !t.end_time.is_empty())
        .collect();
    Ok(rows)
}

/// Requirement: "if two fixed-time tasks overlap, do NOT silently move
/// either one — return a clear scheduling conflict." Checked before
/// anything else in run_plan_generation: before any DB write, before any
/// AI call, so a conflict never leaves the day in a partially-regenerated
/// state and never spends an AI request on a request that can't succeed.
fn detect_fixed_conflicts(fixed_tasks: &[FixedTaskInfo]) -> Result<(), String> {
    for i in 0..fixed_tasks.len() {
        for j in (i + 1)..fixed_tasks.len() {
            let a = &fixed_tasks[i];
            let b = &fixed_tasks[j];
            let a_start = parse_hhmm_to_minutes(&a.start_time)?;
            let a_end = parse_hhmm_to_minutes(&a.end_time)?;
            let b_start = parse_hhmm_to_minutes(&b.start_time)?;
            let b_end = parse_hhmm_to_minutes(&b.end_time)?;
            if a_start < b_end && b_start < a_end {
                return Err(format!(
                    "'{}' ({}\u{2013}{}) conflicts with '{}' ({}\u{2013}{}) — both are fixed-time tasks on this \
                     date. Edit one of them (Tasks page) before generating a plan; the planner will never move \
                     a fixed-time task automatically.",
                    a.title, a.start_time, a.end_time, b.title, b.start_time, b.end_time
                ));
            }
        }
    }
    Ok(())
}

/// Deterministically upserts one locked schedule_block per fixed-time
/// task on `date`, sourced directly from the task's own scheduled_start/
/// scheduled_end — never from anything the AI proposes. Idempotent and
/// safe to call on every generate/reoptimize: if a matching block already
/// exists for that task+date it's updated in place (preserving id and
/// completed status), never duplicated or dropped.
fn materialize_fixed_task_blocks(conn: &Connection, date: &str, fixed_tasks: &[FixedTaskInfo]) -> Result<(), String> {
    for t in fixed_tasks {
        let start_ts = format!("{date}T{}:00", t.start_time);
        let end_ts = format!("{date}T{}:00", t.end_time);
        let existing_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM schedule_blocks WHERE task_id = ?1 AND date(start_ts) = date(?2) LIMIT 1",
                params![t.task_id, date],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        match existing_id {
            Some(id) => {
                conn.execute(
                    "UPDATE schedule_blocks SET title = ?1, course_id = ?2, start_ts = ?3, end_ts = ?4, \
                     source = 'manual', locked = 1, updated_at = datetime('now') WHERE id = ?5",
                    params![t.title, t.course_id, start_ts, end_ts, id],
                )
                .map_err(|e| e.to_string())?;
            }
            None => {
                conn.execute(
                    "INSERT INTO schedule_blocks (task_id, course_id, title, start_ts, end_ts, source, locked) \
                     VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 1)",
                    params![t.task_id, t.course_id, t.title, start_ts, end_ts],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn gather_exams(conn: &Connection) -> Result<Vec<PlannerExamInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.name, c.name, CAST(julianday(e.date) - julianday(date('now', 'localtime')) AS INTEGER) \
             FROM exams e LEFT JOIN courses c ON c.id = e.course_id \
             WHERE e.status = 'upcoming' AND date(e.date) BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+30 days') \
             ORDER BY e.date ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlannerExamInfo {
                name: row.get(0)?,
                course_name: row.get(1)?,
                days_until: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// (title, start "HH:MM", end "HH:MM") for locked blocks on `date`. Plain
/// substring extraction on an already-local "YYYY-MM-DDTHH:MM:SS" string —
/// no Date object, same reasoning as this file's module doc comment.
fn gather_locked_blocks(conn: &Connection, date: &str) -> Result<Vec<(String, String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT title, start_ts, end_ts FROM schedule_blocks \
             WHERE date(start_ts) = date(?1) AND locked = 1 ORDER BY start_ts",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date], |row| {
            let title: String = row.get(0)?;
            let start_ts: String = row.get(1)?;
            let end_ts: String = row.get(2)?;
            Ok((title, start_ts[11..16].to_string(), end_ts[11..16].to_string()))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn format_minutes(total: i64) -> String {
    let h = total / 60;
    let m = total % 60;
    if h > 0 && m > 0 {
        format!("{h}h {m}m")
    } else if h > 0 {
        format!("{h}h")
    } else {
        format!("{m}m")
    }
}

/// Available window minutes minus locked-block minutes, compared against
/// the sum of estimated_minutes across the gathered tasks. Pure
/// arithmetic — this is the "detect impossible schedules" requirement,
/// computed here rather than left for the AI to eyeball.
fn compute_capacity_warning(
    wake_time: &str,
    sleep_time: &str,
    locked_blocks: &[(String, String, String)],
    tasks: &[PlannerTaskInfo],
) -> Result<Option<String>, String> {
    let wake_min = parse_hhmm_to_minutes(wake_time)?;
    let sleep_min = parse_hhmm_to_minutes(sleep_time)?;
    if sleep_min <= wake_min {
        return Err("Sleep time must be after wake time.".to_string());
    }
    let window = sleep_min - wake_min;

    let mut locked_minutes = 0i64;
    for (_, start, end) in locked_blocks {
        let s = parse_hhmm_to_minutes(start)?;
        let e = parse_hhmm_to_minutes(end)?;
        locked_minutes += (e - s).max(0);
    }
    let available = window - locked_minutes;

    let requested: i64 = tasks.iter().filter_map(|t| t.estimated_minutes).sum();

    if available <= 0 {
        return Ok(Some(
            "Your fixed commitments already fill your entire available window today.".to_string(),
        ));
    }
    if requested > available {
        return Ok(Some(format!(
            "You have about {} of task time estimated but only about {} available today.",
            format_minutes(requested),
            format_minutes(available)
        )));
    }
    Ok(None)
}

// ---- Generation (the actual AI call) ----

fn run_plan_generation(pool: &Pool, req: &PlanRequest) -> Result<PlanResult, String> {
    let settings = get_settings_from_pool(pool)?;
    let conn = pool.get().map_err(|e| e.to_string())?;

    // Fixed-time tasks are handled first, entirely deterministically, and
    // before anything else touches the database or the network:
    //   1. Detect fixed-vs-fixed conflicts and fail fast — no AI call, no
    //      writes, if the user's own data can't be satisfied.
    //   2. Materialize each fixed task as a locked schedule_block sourced
    //      directly from the task's own scheduled_start/scheduled_end.
    // Steps 3+ (gather_locked_blocks picking these up, gather_tasks
    // excluding them, and parse_and_validate rejecting any AI block that
    // overlaps one) are what make it structurally impossible for the AI
    // to move, resize, or reinterpret a fixed-time task — not the prompt
    // wording alone.
    let fixed_tasks = gather_fixed_tasks(&conn, &req.date)?;
    detect_fixed_conflicts(&fixed_tasks)?;
    materialize_fixed_task_blocks(&conn, &req.date, &fixed_tasks)?;

    let tasks = gather_tasks(&conn, &req.date)?;
    let exams = gather_exams(&conn)?;
    let locked_blocks = gather_locked_blocks(&conn, &req.date)?;
    let capacity_warning =
        compute_capacity_warning(&req.wake_time, &req.sleep_time, &locked_blocks, &tasks)?;

    let mut decision = router::route(
        &conn,
        &settings,
        &router::RouteRequest {
            // Planning is "quick planning / task organization" — explicitly
            // a Flash-tier task per architecture.md §6, not Pro.
            complexity: router::Complexity::Simple,
            privacy: router::Privacy::OkExternal,
        },
    )
    .map_err(|e| e.to_string())?;

    let opts = GenOpts {
        temperature: settings.ai_temperature,
        max_output_tokens: settings.ai_max_output_tokens as u32,
    };

    let ctx = PlannerContext {
        date: &req.date,
        wake_time: &req.wake_time,
        sleep_time: &req.sleep_time,
        max_continuous_minutes: req.max_continuous_minutes,
        break_minutes: req.break_minutes,
        daily_study_goal_minutes: settings.daily_study_goal_minutes,
        commitments_text: &req.commitments_text,
        locked_blocks: &locked_blocks,
        tasks: &tasks,
        upcoming_exams: &exams,
        capacity_warning: capacity_warning.as_deref(),
    };

    let provider = router::build_provider(&decision, &settings).map_err(|e| e.to_string())?;
    let mut generation = generate_plan_blocks(provider.as_ref(), &opts, &ctx);

    // Same quota-exhaustion fallback as commands/ai.rs::test_ai_connection
    // (see ai/router.rs's doc comment on route() for the full reasoning):
    // only retries when the failed attempt was Gemini Flash specifically
    // because the spending limit is $0, and the failure looks like
    // exhausted free-tier quota — never for Gemini Pro, which the budget
    // gate already blocks outright before reaching this point.
    let is_free_tier_gemini_flash = decision.provider == "gemini" && decision.model == settings.ai_gemini_flash_model;
    if let Err(e) = &generation {
        if is_free_tier_gemini_flash
            && settings.ai_monthly_spending_limit_usd <= 0.0
            && router::looks_like_quota_exhausted(e)
        {
            if let Some(fallback) = router::fallback_after_quota_exhaustion(&settings) {
                if let Ok(fallback_provider) = router::build_provider(&fallback, &settings) {
                    generation = generate_plan_blocks(fallback_provider.as_ref(), &opts, &ctx);
                    decision = fallback;
                }
            }
        }
    }

    // Log real usage regardless of outcome — token/cost figures come
    // straight from the provider response (never fabricated), and a
    // logging failure must not hide the real result/error below.
    let log_response: Result<crate::ai::AiResponse, crate::ai::AiError> = match &generation {
        Ok(g) => Ok(crate::ai::AiResponse {
            text: format!("{} block(s) generated", g.blocks.len()),
            model: decision.model.clone(),
            input_tokens: g.input_tokens,
            output_tokens: g.output_tokens,
            estimated_cost_usd: g.estimated_cost_usd,
        }),
        Err(e) => Err(clone_ai_error(e)),
    };
    let _ = crate::ai::usage::log_request(&conn, &decision.provider, &decision.model, "planner", &log_response);

    let generation = generation.map_err(|e| e.to_string())?;
    let ai_blocks = generation.blocks;

    // Clear out this date's previous AI-generated blocks that are safe to
    // replace — never touches manual blocks, locked blocks (either
    // source), or completed blocks. This same rule is what makes
    // reoptimize_plan's "only reorganize incomplete tasks" requirement
    // hold: it shares this exact function.
    conn.execute(
        "DELETE FROM schedule_blocks WHERE date(start_ts) = date(?1) AND source = 'ai' AND locked = 0 AND completed = 0",
        params![req.date],
    )
    .map_err(|e| e.to_string())?;

    let mut insert_stmt = conn
        .prepare(
            "INSERT INTO schedule_blocks (task_id, title, start_ts, end_ts, source, locked, ai_reason) \
             VALUES (?1, ?2, ?3, ?4, 'ai', 0, ?5)",
        )
        .map_err(|e| e.to_string())?;
    for block in &ai_blocks {
        let start_ts = format!("{}T{}:00", req.date, block.start_time);
        let end_ts = format!("{}T{}:00", req.date, block.end_time);
        insert_stmt
            .execute(params![block.task_id, block.title, start_ts, end_ts, block.reason])
            .map_err(|e| e.to_string())?;
    }

    // One query for the whole day's picture (the blocks just inserted,
    // plus any locked/completed/manual blocks that were left untouched)
    // rather than re-fetching each inserted row individually and then
    // querying the day again.
    let mut full_day_stmt = conn
        .prepare(&format!("{SELECT_BLOCK_SQL} WHERE date(sb.start_ts) = date(?1) ORDER BY sb.start_ts"))
        .map_err(|e| e.to_string())?;
    let full_day: Vec<ScheduleBlock> = full_day_stmt
        .query_map(params![req.date], row_to_block)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(PlanResult {
        blocks: full_day,
        capacity_warning,
        provider: decision.provider,
        model: decision.model,
    })
}

/// `AiError` doesn't derive `Clone` (its variants hold owned Strings but
/// there's no reason to make error paths pay for that everywhere), so
/// this rebuilds an equivalent value from a `&AiError` for the one place
/// that needs to both log an error AND still return it — small enough
/// that a manual match beats adding `Clone` to a type used across the
/// whole ai/ module for one caller's convenience.
fn clone_ai_error(e: &crate::ai::AiError) -> crate::ai::AiError {
    use crate::ai::AiError;
    match e {
        AiError::NotConfigured(m) => AiError::NotConfigured(m.clone()),
        AiError::BudgetExceeded(m) => AiError::BudgetExceeded(m.clone()),
        AiError::NoProviderAvailable(m) => AiError::NoProviderAvailable(m.clone()),
        AiError::Network(m) => AiError::Network(m.clone()),
        AiError::ProviderError { provider, message } => AiError::ProviderError {
            provider: provider.clone(),
            message: message.clone(),
        },
        AiError::InvalidResponse(m) => AiError::InvalidResponse(m.clone()),
        AiError::Internal(m) => AiError::Internal(m.clone()),
    }
}

#[tauri::command]
pub async fn generate_plan(pool: State<'_, Pool>, req: PlanRequest) -> Result<PlanResult, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || run_plan_generation(&pool, &req))
        .await
        .map_err(|e| format!("Internal error: {e}"))?
}

/// No form — just a date. Reuses the user's saved planner preferences and
/// an empty commitments string, since "reorganize what's left" is meant
/// to be a single-click action, not a full re-fill of the generation form.
#[tauri::command]
pub async fn reoptimize_plan(pool: State<'_, Pool>, date: String) -> Result<PlanResult, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || {
        let settings: UserSettings = get_settings_from_pool(&pool)?;
        let req = PlanRequest {
            date,
            wake_time: settings.planner_wake_time.clone(),
            sleep_time: settings.planner_sleep_time.clone(),
            max_continuous_minutes: settings.planner_max_continuous_minutes,
            break_minutes: settings.planner_break_minutes,
            commitments_text: String::new(),
        };
        run_plan_generation(&pool, &req)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}
