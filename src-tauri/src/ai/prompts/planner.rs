//! AI daily planner prompt + structured-output validation (architecture.md
//! §53 "Structured AI Output" — the first real consumer of that principle
//! in this codebase; Phase 6 deliberately left it unimplemented since
//! nothing needed it yet).
//!
//! The AI is asked for HH:MM times, not full timestamps — resolving those
//! against a specific date happens in commands/planner.rs once validation
//! has passed, via plain string concatenation (no Date/timezone math
//! anywhere in this pipeline; see that file's module doc comment for why).

use crate::ai::{AiError, AiProvider, GenOpts};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPlanBlock {
    pub title: String,
    pub start_time: String, // "HH:MM", 24-hour
    pub end_time: String,   // "HH:MM", 24-hour
    pub task_id: Option<i64>,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AiPlanResponse {
    blocks: Vec<AiPlanBlock>,
}

pub struct PlannerTaskInfo {
    pub id: i64,
    pub title: String,
    pub course_name: Option<String>,
    pub priority: String,
    pub difficulty: String,
    pub estimated_minutes: Option<i64>,
    pub days_until_deadline: Option<i64>,
}

pub struct PlannerExamInfo {
    pub name: String,
    pub course_name: Option<String>,
    pub days_until: i64,
}

pub struct PlannerContext<'a> {
    pub date: &'a str, // "YYYY-MM-DD"
    pub wake_time: &'a str,
    pub sleep_time: &'a str,
    pub max_continuous_minutes: i64,
    pub break_minutes: i64,
    pub daily_study_goal_minutes: i64,
    pub commitments_text: &'a str,
    /// (title, start_time "HH:MM", end_time "HH:MM") for blocks already
    /// locked today — fixed, must not be scheduled over.
    pub locked_blocks: &'a [(String, String, String)],
    pub tasks: &'a [PlannerTaskInfo],
    pub upcoming_exams: &'a [PlannerExamInfo],
    /// Set when the deterministic capacity check (commands/planner.rs)
    /// finds more requested task time than available window time — this
    /// fact is computed in Rust, never left for the AI to estimate, per
    /// architecture.md §62 "Do not call AI for deterministic operations".
    pub capacity_warning: Option<&'a str>,
}

fn build_prompt(ctx: &PlannerContext) -> String {
    let mut p = String::new();
    p.push_str(&format!(
        "You are a study planning assistant. Build a realistic daily schedule for {}.\n\n",
        ctx.date
    ));
    p.push_str(&format!(
        "Available window: {} to {}. Do not schedule anything outside this window.\n",
        ctx.wake_time, ctx.sleep_time
    ));
    p.push_str(&format!(
        "Maximum continuous study block: {} minutes, followed by at least a {}-minute break before \
         the next study block.\n",
        ctx.max_continuous_minutes, ctx.break_minutes
    ));
    p.push_str(&format!("Daily study time target: {} minutes.\n\n", ctx.daily_study_goal_minutes));

    if !ctx.commitments_text.trim().is_empty() {
        p.push_str(&format!(
            "The user has these additional commitments today — do not schedule anything over them: {}\n\n",
            ctx.commitments_text.trim()
        ));
    }

    if !ctx.locked_blocks.is_empty() {
        p.push_str("These time ranges are already fixed and must not be scheduled over:\n");
        for (title, start, end) in ctx.locked_blocks {
            p.push_str(&format!("- {start}-{end}: {title}\n"));
        }
        p.push('\n');
    }

    if !ctx.upcoming_exams.is_empty() {
        p.push_str("Upcoming exams (prioritize related tasks accordingly):\n");
        for exam in ctx.upcoming_exams {
            let course = exam.course_name.as_deref().unwrap_or("General");
            p.push_str(&format!("- {} ({}) in {} day(s)\n", exam.name, course, exam.days_until));
        }
        p.push('\n');
    }

    if ctx.tasks.is_empty() {
        p.push_str("There are no pending tasks to schedule today. Return an empty blocks array.\n\n");
    } else {
        p.push_str("Tasks to schedule (use the exact numeric id shown as taskId in your response):\n");
        for t in ctx.tasks {
            let course = t.course_name.as_deref().unwrap_or("General");
            let est = t
                .estimated_minutes
                .map(|m| format!("{m} min"))
                .unwrap_or_else(|| "unknown duration".to_string());
            let deadline = t
                .days_until_deadline
                .map(|d| format!(", due in {d} day(s)"))
                .unwrap_or_default();
            p.push_str(&format!(
                "- id={}, \"{}\" ({}), priority={}, difficulty={}, estimated {}{}\n",
                t.id, t.title, course, t.priority, t.difficulty, est, deadline
            ));
        }
        p.push('\n');
    }

    if let Some(warning) = ctx.capacity_warning {
        p.push_str(&format!(
            "IMPORTANT: {warning} You cannot fit everything — deprioritize lower-priority or \
             later-deadline tasks rather than overpacking the day.\n\n"
        ));
    }

    p.push_str(
        "Rules:\n\
         - Leave reasonable buffers; do not fill every minute of the window.\n\
         - Every block must be fully inside the available window and must not overlap another \
           block, a locked block, or a stated commitment.\n\
         - startTime must be strictly before endTime, and both must be on the same day (never \
           cross midnight).\n\
         - taskId must be one of the exact ids listed above, or null for a generic block (e.g. \
           review, warm-up) not tied to a specific task.\n\
         - reason must be one short sentence explaining why this block is placed here — this is \
           shown to the user, so keep it concrete (e.g. mention the exam or deadline it relates to).\n\n\
         Respond with ONLY valid JSON, no markdown code fences, no prose before or after, matching \
         exactly this shape:\n\
         {\"blocks\": [{\"title\": string, \"startTime\": \"HH:MM\", \"endTime\": \"HH:MM\", \
         \"taskId\": number-or-null, \"reason\": string}]}",
    );

    p
}

fn strip_markdown_fences(text: &str) -> &str {
    let trimmed = text.trim();
    for prefix in ["```json", "```"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest.trim().strip_suffix("```").unwrap_or(rest).trim();
        }
    }
    trimmed
}

/// Exposed (not just used internally) so commands/planner.rs can reuse the
/// exact same HH:MM parsing for its own deterministic capacity check —
/// one parser, not two copies that could quietly drift apart.
pub fn parse_hhmm_to_minutes(s: &str) -> Result<i64, String> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return Err(format!("'{s}' isn't a valid HH:MM time."));
    }
    let h: i64 = parts[0].parse().map_err(|_| format!("'{s}' isn't a valid HH:MM time."))?;
    let m: i64 = parts[1].parse().map_err(|_| format!("'{s}' isn't a valid HH:MM time."))?;
    if !(0..24).contains(&h) || !(0..60).contains(&m) {
        return Err(format!("'{s}' isn't a valid HH:MM time."));
    }
    Ok(h * 60 + m)
}

fn parse_and_validate(raw_text: &str, ctx: &PlannerContext) -> Result<Vec<AiPlanBlock>, String> {
    let cleaned = strip_markdown_fences(raw_text);
    let parsed: AiPlanResponse =
        serde_json::from_str(cleaned).map_err(|e| format!("Response wasn't valid JSON: {e}"))?;

    let valid_task_ids: HashSet<i64> = ctx.tasks.iter().map(|t| t.id).collect();
    let window_start = parse_hhmm_to_minutes(ctx.wake_time)?;
    let window_end = parse_hhmm_to_minutes(ctx.sleep_time)?;

    // Fixed-time tasks and other already-locked blocks are pre-parsed once
    // here so every AI-returned block can be checked against them below —
    // this is the deterministic half of "AI proposes, Rust validates"
    // (architecture.md §53 / the planner's fixed-time-task guarantee). The
    // prompt *asks* the model not to overlap these, but a prompt is not
    // enforcement — this loop is.
    let mut locked_ranges: Vec<(i64, i64, &str)> = Vec::with_capacity(ctx.locked_blocks.len());
    for (title, start, end) in ctx.locked_blocks {
        let s = parse_hhmm_to_minutes(start)?;
        let e = parse_hhmm_to_minutes(end)?;
        locked_ranges.push((s, e, title.as_str()));
    }

    let mut ranges: Vec<(i64, i64, String)> = Vec::with_capacity(parsed.blocks.len());
    for block in &parsed.blocks {
        if block.title.trim().is_empty() {
            return Err("A block had an empty title.".to_string());
        }
        let start_min = parse_hhmm_to_minutes(&block.start_time).map_err(|e| format!("Block '{}': {e}", block.title))?;
        let end_min = parse_hhmm_to_minutes(&block.end_time).map_err(|e| format!("Block '{}': {e}", block.title))?;
        if start_min >= end_min {
            return Err(format!("Block '{}' has startTime not before endTime.", block.title));
        }
        if start_min < window_start || end_min > window_end {
            return Err(format!(
                "Block '{}' ({}-{}) falls outside the {}\u{2013}{} window.",
                block.title, block.start_time, block.end_time, ctx.wake_time, ctx.sleep_time
            ));
        }
        if let Some(tid) = block.task_id {
            if !valid_task_ids.contains(&tid) {
                // Fixed-time tasks are deliberately excluded from
                // ctx.tasks (see commands/planner.rs::gather_tasks) so
                // this same check also catches — and rejects — any
                // attempt by the AI to "schedule" a task that already has
                // a user-fixed time, without needing a separate check.
                return Err(format!(
                    "Block '{}' references taskId {} which isn't in the schedulable task list — it may be a \
                     fixed-time task the AI must leave alone, or an invalid id.",
                    block.title, tid
                ));
            }
        }
        // Every returned block must fit fully inside the available window
        // AND not touch any already-locked range (fixed-time tasks,
        // previously-locked blocks). This is the check that actually
        // enforces "the AI must never move, resize, or overlap a fixed
        // task" — not just the prompt's wording.
        for (locked_start, locked_end, locked_title) in &locked_ranges {
            if start_min < *locked_end && *locked_start < end_min {
                return Err(format!(
                    "Block '{}' ({}-{}) overlaps the fixed/locked block '{}' — fixed-time tasks and locked \
                     blocks must never be moved or overlapped.",
                    block.title, block.start_time, block.end_time, locked_title
                ));
            }
        }
        ranges.push((start_min, end_min, block.title.clone()));
    }

    // Overlap check across the AI's own returned blocks — O(n^2) is fine
    // for a single day's worth of blocks.
    for i in 0..ranges.len() {
        for j in (i + 1)..ranges.len() {
            let (a_start, a_end, a_title) = &ranges[i];
            let (b_start, b_end, b_title) = &ranges[j];
            if a_start < b_end && b_start < a_end {
                return Err(format!("Blocks '{a_title}' and '{b_title}' overlap."));
            }
        }
    }

    Ok(parsed.blocks)
}

/// Generates a plan by calling the provider, validating the JSON response,
/// and — if invalid — making exactly one repair attempt by re-prompting
/// with the specific validation error before giving up (architecture.md
/// §53: attempt repair, retry once, otherwise surface a clear error —
/// never silently accept malformed output).
pub struct PlanGenerationResult {
    pub blocks: Vec<AiPlanBlock>,
    /// Summed across the initial call and the repair retry, if one
    /// happened — "best effort combine" (a value present on either call
    /// counts; both missing stays None), never fabricated when a provider
    /// genuinely doesn't report token counts.
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub estimated_cost_usd: Option<f64>,
}

fn combine_optional(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)),
    }
}

pub fn generate_plan_blocks(
    provider: &dyn AiProvider,
    opts: &GenOpts,
    ctx: &PlannerContext,
) -> Result<PlanGenerationResult, AiError> {
    let prompt = build_prompt(ctx);
    let response = provider.generate(&prompt, opts)?;

    match parse_and_validate(&response.text, ctx) {
        Ok(blocks) => Ok(PlanGenerationResult {
            blocks,
            input_tokens: response.input_tokens,
            output_tokens: response.output_tokens,
            estimated_cost_usd: response.estimated_cost_usd,
        }),
        Err(first_error) => {
            let repair_prompt = format!(
                "Your previous response was invalid: {first_error}\n\nYour previous response was:\n{}\n\n\
                 Fix this and respond again with ONLY valid JSON matching the exact shape requested in \
                 the original instructions below — no markdown fences, no prose.\n\n{}",
                response.text, prompt
            );
            let retry_response = provider.generate(&repair_prompt, opts)?;
            let blocks = parse_and_validate(&retry_response.text, ctx).map_err(|second_error| {
                AiError::InvalidResponse(format!(
                    "The AI couldn't produce a valid schedule after a retry. First issue: {first_error}. \
                     After retry: {second_error}. Try again, or add/edit tasks manually."
                ))
            })?;
            let input_tokens = match (response.input_tokens, retry_response.input_tokens) {
                (None, None) => None,
                (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
            };
            let output_tokens = match (response.output_tokens, retry_response.output_tokens) {
                (None, None) => None,
                (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
            };
            Ok(PlanGenerationResult {
                blocks,
                input_tokens,
                output_tokens,
                estimated_cost_usd: combine_optional(response.estimated_cost_usd, retry_response.estimated_cost_usd),
            })
        }
    }
}
