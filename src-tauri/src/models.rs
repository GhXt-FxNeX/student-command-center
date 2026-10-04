use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub course_id: Option<i64>,
    pub priority: String,
    pub difficulty: String,
    pub estimated_minutes: Option<i64>,
    pub deadline: Option<String>, // "YYYY-MM-DD" calendar date, never a timestamp
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    pub status: String,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub description: Option<String>,
    pub course_id: Option<i64>,
    pub priority: String,
    pub difficulty: String,
    pub estimated_minutes: Option<i64>,
    pub deadline: Option<String>, // "YYYY-MM-DD" calendar date, never a timestamp
    pub scheduled_start: Option<String>,
    pub scheduled_end: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub name: String,
    pub timezone: String,
    pub week_start: String,
    pub theme: String,
    pub accent_color: String,
    pub dashboard_layout: Vec<String>,
    pub currency: String,
    pub pomodoro_work_minutes: i64,
    pub pomodoro_short_break_minutes: i64,
    pub pomodoro_long_break_minutes: i64,
    pub pomodoro_sessions_before_long_break: i64,
    pub pomodoro_auto_start: bool,
    pub daily_study_goal_minutes: i64,
    pub weekly_study_goal_minutes: i64,
    pub monthly_income_amount: f64,
    // ---- Phase 6: AI settings (non-secret only — API keys live in the OS
    // keychain, see ai/keychain.rs, never in this struct or SQLite) ----
    pub ai_routing_mode: String, // "automatic" | "manual"
    pub ai_manual_provider: String, // "gemini" | "openrouter"
    pub ai_manual_gemini_tier: String, // "flash" | "pro"
    pub ai_gemini_flash_model: String,
    pub ai_gemini_pro_model: String,
    pub ai_openrouter_model: String,
    // Phase 8c: Ollama/local AI was permanently removed (unacceptable
    // CPU/GPU/heat cost on the user's machine — the app is cloud-AI-only
    // now: Gemini + OpenRouter). These two columns are vestigial —
    // kept rather than dropped (SQLite column drops don't fit this
    // project's additive-only migration convention) but no longer read
    // by any active provider/routing/embedding code, and no longer
    // shown in Settings.
    pub ai_local_base_url: String,
    pub ai_local_model: String,
    pub ai_temperature: f64,
    pub ai_max_output_tokens: i64,
    pub ai_monthly_spending_limit_usd: f64,
    // ---- Phase 7: reusable AI Planner preferences (day-specific input —
    // commitments text, the date itself — stays ephemeral, passed
    // directly to generate_plan rather than persisted here) ----
    pub planner_wake_time: String, // "HH:MM"
    pub planner_sleep_time: String, // "HH:MM"
    pub planner_max_continuous_minutes: i64,
    pub planner_break_minutes: i64,
    /// Floating companion bubble diameter in px (Settings > Companion).
    /// A display preference, not a companion property — doesn't affect
    /// the companion's actual art, only how large it renders on screen.
    pub companion_bubble_size_px: i64,
    /// The user's own Spotify app Client ID (Settings > Spotify) — public,
    /// not a secret (see migration 0023's header comment), so this is the
    /// only Spotify-related value that lives in the database rather than
    /// the OS keychain (spotify/token_store.rs).
    pub spotify_client_id: String,
    /// Whether the companion's UI (Dashboard card + floating bubble) is
    /// shown at all (Settings > Companion). Hiding it doesn't pause the
    /// companion — the engine still processes events in the background.
    pub companion_enabled: bool,
    /// Order and visibility of the navigation items (Settings > Appearance >
    /// Navigation). Empty = default order, nothing hidden. The item registry
    /// lives in the frontend; this only stores the user's choices.
    pub nav_layout: Vec<NavItemPref>,
    /// Id of the chosen preset avatar (frontend: features/profile/avatars.ts);
    /// empty = none chosen yet.
    pub profile_icon: String,
    /// False on a fresh install and after "Reset saved data" — the frontend
    /// shows the onboarding screen until it is true.
    pub onboarding_completed: bool,
    /// Max paid-tier Gemini (Pro) requests per month; see migration 0030.
    /// 0 = Gemini Pro disabled. Only enforced for Gemini models other than
    /// the configured Flash model.
    pub ai_pro_monthly_request_cap: i64,
}

/// One entry of `UserSettings::nav_layout`. `id` is a stable slug from the
/// frontend's nav registry ("planner", "study-analytics", ...), not a route.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavItemPref {
    pub id: String,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionState {
    pub id: i64,
    pub name: String,
    pub species_slug: String,
    pub current_stage: String,
    pub xp: i64,
    pub level: i64,
    pub happiness: i64,
    pub mood: String,
    pub state: String,
    /// "evolution" | "level_up" | null — which specific event is driving a
    /// "celebrating" mood right now, so the frontend can play that one-shot
    /// clip instead of the generic "celebration" fallback. Only meaningful
    /// when mood === "celebrating"; stale/irrelevant otherwise (not cleared
    /// immediately when mood changes, same as every other companion field
    /// that's only overwritten by the next process_event call).
    pub celebration_trigger: Option<String>,
    pub xp_for_next_level: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySession {
    pub id: i64,
    pub task_id: Option<i64>,
    pub course_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub start_ts: String,
    pub end_ts: String,
    pub duration_seconds: i64,
    pub session_type: String,
    pub completed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStudySession {
    pub task_id: Option<i64>,
    pub course_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub start_ts: String,
    pub end_ts: String,
    pub duration_seconds: i64,
    pub session_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarItem {
    pub id: String, // "task:12" / "session:7" — composite so the frontend has a stable unique key
    pub title: String,
    pub item_type: String, // "task" | "study_session"
    pub start: String,
    pub end: Option<String>,
    pub course_id: Option<i64>,
    pub completed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyStatsBucket {
    pub label: String, // "YYYY-MM-DD" for day buckets, "YYYY-MM" for month buckets
    pub minutes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseMinutes {
    pub course_name: String,
    pub minutes: i64,
}

/// Mirrors CourseMinutes exactly, joined against `subjects` instead of
/// `courses` — see analytics.rs's subject_breakdown().
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectMinutes {
    pub subject_name: String,
    pub minutes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyStats {
    pub buckets: Vec<StudyStatsBucket>,
    pub total_minutes: i64,
    pub average_minutes_per_active_day: f64,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub by_course: Vec<CourseMinutes>,
    pub by_subject: Vec<SubjectMinutes>,
    pub today_minutes: i64,
    pub this_week_minutes: i64,
    pub daily_goal_minutes: i64,
    pub weekly_goal_minutes: i64,
}

// ---- Phase 4: Finance ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceCategory {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub budget_amount: Option<f64>,
    pub sort_order: i64,
    pub archived: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFinanceCategory {
    pub name: String,
    pub color: String,
    pub budget_amount: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: i64,
    pub category_id: Option<i64>,
    pub amount: f64,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub occurred_on: String, // "YYYY-MM-DD" calendar date, never a timestamp
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTransaction {
    pub category_id: Option<i64>,
    pub amount: f64,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub occurred_on: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryBudget {
    pub category_id: i64,
    pub category_name: String,
    pub color: String,
    pub budget_amount: Option<f64>,
    pub spent: f64, // sum of 'expense'-type transactions in the period, for this category
}

/// Deterministic (no-AI) totals for a single calendar month ("YYYY-MM").
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSummary {
    pub month: String,
    pub total_income: f64,
    pub total_expense: f64,
    pub total_saving: f64,
    pub remaining_balance: f64, // income - expense - saving
    pub savings_percent: Option<f64>, // saving / income * 100; None if income is 0
    pub monthly_income_amount: f64, // the settings baseline, shown alongside logged income
    pub by_category: Vec<CategoryBudget>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceMonthBucket {
    pub month: String, // "YYYY-MM"
    pub income: f64,
    pub expense: f64,
    pub saving: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceStats {
    pub buckets: Vec<FinanceMonthBucket>,
    pub by_category: Vec<CategoryBudget>, // spending across the whole range, for the breakdown view
}

// ---- Phase 5: Academic structure (subjects) ----
// `courses` has existed since Phase 1; `subjects` has existed in the schema
// since Phase 1 too but had no commands/UI until Phase 5's exam tracker
// needed a real subject picker.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: i64,
    pub course_id: i64,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSubject {
    pub course_id: i64,
    pub name: String,
    pub color: Option<String>,
}

// ---- Phase 5: Exams ----

/// `percentage` is computed (score / max_score * 100) every time a row is
/// read, never stored — see migration 0007/0008's header comments. Score,
/// max_score, and percentage are all `None` together for exams that don't
/// have a result yet ("upcoming"/"awaiting_result") — never a fabricated
/// 0. `course_name`/`subject_name` are denormalized read-only conveniences
/// from a LEFT JOIN so the frontend doesn't need a second round trip per
/// exam row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exam {
    pub id: i64,
    pub name: String,
    pub course_id: Option<i64>,
    pub course_name: Option<String>,
    pub subject_id: Option<i64>,
    pub subject_name: Option<String>,
    pub date: String, // "YYYY-MM-DD" calendar date, never a timestamp
    /// "upcoming" | "awaiting_result" | "completed" — see commands/exams.rs
    /// for the invariant (status == "completed" iff score is present).
    pub status: String,
    pub score: Option<f64>,
    pub max_score: Option<f64>,
    pub percentage: Option<f64>, // None unless status == "completed"
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExam {
    pub name: String,
    pub course_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub date: String,
    /// Client-declared pre-result state — only "upcoming" or
    /// "awaiting_result" are meaningful here; the server always derives the
    /// final stored status itself (see commands/exams.rs::resolve_status),
    /// promoting to "completed" automatically whenever a valid score and
    /// max_score are both present, regardless of what's sent in this field.
    pub status: String,
    pub score: Option<f64>,
    pub max_score: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectAverage {
    pub subject_id: i64,
    pub subject_name: String,
    pub average_percentage: f64,
    pub exam_count: i64,
}

/// Deterministic (no-AI) exam analytics — same rule as Finance's
/// FinanceSummary/FinanceStats: all arithmetic is plain SQL/Rust. Every
/// query behind this struct is scoped to `status = 'completed'` — upcoming
/// and awaiting-result exams must never influence these numbers.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamStats {
    /// Count of exams that actually have a result — NOT total exam rows.
    pub completed_count: i64,
    pub overall_average: Option<f64>, // None when there are zero completed exams
    pub highest: Option<Exam>,
    pub lowest: Option<Exam>,
    pub by_subject: Vec<SubjectAverage>,
}

// ---- Phase 6: AI infrastructure ----

/// One provider's current connection status, for the Settings page's
/// 🟢/🔴-style indicators. `hasKey` is only meaningful for Gemini/
/// OpenRouter (Local has no key concept, always false).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusInfo {
    pub provider: String, // "gemini" | "openrouter"
    pub status: crate::ai::ProviderStatus,
    pub has_key: bool,
}

/// Result of the Phase 6 "test call" — the one user-facing AI feature this
/// phase ships, purely to prove the whole pipeline (routing → provider →
/// logging) is wired end to end. See architecture.md §10 roadmap note.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCallResult {
    pub provider: String,
    pub model: String,
    pub reason: String, // why the router picked this provider/model
    pub response_text: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}

// ---- Phase 7: AI Daily Planner ----

/// `start_ts`/`end_ts` are plain "YYYY-MM-DDTHH:MM:SS" strings, always
/// local wall-clock time built from string concatenation — never a UTC
/// conversion or a constructed Date/timestamp object anywhere in this
/// pipeline. See commands/planner.rs's module doc comment for why: this
/// is the first feature in the app that needs an exact clock time rather
/// than just a calendar day, so it's the first place this actually
/// matters (Calendar/StudySessions only ever read the date prefix).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleBlock {
    pub id: i64,
    pub task_id: Option<i64>,
    pub task_title: Option<String>, // denormalized via LEFT JOIN, display convenience
    pub course_id: Option<i64>,
    pub course_name: Option<String>,
    pub subject_id: Option<i64>,
    pub title: String,
    pub start_ts: String,
    pub end_ts: String,
    pub source: String, // "ai" | "manual"
    pub locked: bool,
    pub completed: bool,
    /// Concise "why this is here" — only ever set for AI-generated blocks,
    /// never fabricated for manual ones.
    pub ai_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewScheduleBlock {
    pub task_id: Option<i64>,
    pub course_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub title: String,
    pub start_ts: String,
    pub end_ts: String,
    pub locked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRequest {
    pub date: String, // "YYYY-MM-DD"
    pub wake_time: String, // "HH:MM"
    pub sleep_time: String,
    pub max_continuous_minutes: i64,
    pub break_minutes: i64,
    pub commitments_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResult {
    pub blocks: Vec<ScheduleBlock>,
    /// Set when the deterministic capacity check found more requested task
    /// time than available window time — computed in Rust, never left for
    /// the AI to estimate (architecture.md §62).
    pub capacity_warning: Option<String>,
    pub provider: String,
    pub model: String,
}

// ---- Phase 14: Data Management (Reset Saved Data / Reset Demo Data) ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableResetCount {
    pub table: String,
    pub rows_deleted: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetSummary {
    pub deleted: Vec<TableResetCount>,
    pub settings_reset: bool,
    /// Absolute path to a pre-reset copy of the database file — `None`
    /// only for reset_demo_data, which doesn't back up (see
    /// commands/data_management.rs: a scoped, is_demo-only delete is a
    /// fundamentally lower-risk operation than a full reset).
    pub backup_path: Option<String>,
}

// ---- Phase 14: Courses tab — recurring weekly class schedule ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectScheduleEntry {
    pub id: i64,
    pub subject_id: i64,
    pub day_of_week: String, // "monday".."sunday"
    pub start_time: String,  // "HH:MM"
    pub end_time: Option<String>,
}

