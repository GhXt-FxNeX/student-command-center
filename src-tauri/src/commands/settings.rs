use crate::db::Pool;
use crate::models::UserSettings;
use std::collections::HashSet;
use rusqlite::params;
use tauri::State;

const SELECT_SETTINGS_COLUMNS: &str = "name, timezone, week_start, theme, accent_color, \
    dashboard_layout_json, currency, pomodoro_work_minutes, pomodoro_short_break_minutes, \
    pomodoro_long_break_minutes, pomodoro_sessions_before_long_break, pomodoro_auto_start, \
    daily_study_goal_minutes, weekly_study_goal_minutes, monthly_income_amount, \
    ai_routing_mode, ai_manual_provider, ai_manual_gemini_tier, ai_gemini_flash_model, \
    ai_gemini_pro_model, ai_openrouter_model, ai_local_base_url, ai_local_model, \
    ai_temperature, ai_max_output_tokens, ai_monthly_spending_limit_usd, \
    planner_wake_time, planner_sleep_time, planner_max_continuous_minutes, planner_break_minutes, \
    companion_bubble_size_px, spotify_client_id, companion_enabled, nav_layout_json, profile_icon, onboarding_completed, ai_pro_monthly_request_cap";

#[tauri::command]
pub fn get_settings(pool: State<Pool>) -> Result<UserSettings, String> {
    get_settings_from_pool(&pool)
}

/// Core logic behind `get_settings`, taking a plain `&Pool` rather than a
/// Tauri `State<Pool>`. Exists so other command modules that need settings
/// from inside a `tokio::task::spawn_blocking` closure (which requires
/// `'static` captured data, not a borrowed `State`) can call this with an
/// owned `Pool` clone instead — see commands/ai.rs, commands/planner.rs.
pub fn get_settings_from_pool(pool: &Pool) -> Result<UserSettings, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("SELECT {SELECT_SETTINGS_COLUMNS} FROM user_settings WHERE id = 1"),
        [],
        |row| {
            let layout_json: String = row.get(5)?;
            let nav_json: String = row.get(33)?;
            Ok(UserSettings {
                name: row.get(0)?,
                timezone: row.get(1)?,
                week_start: row.get(2)?,
                theme: row.get(3)?,
                accent_color: row.get(4)?,
                dashboard_layout: serde_json::from_str(&layout_json).unwrap_or_default(),
                currency: row.get(6)?,
                pomodoro_work_minutes: row.get(7)?,
                pomodoro_short_break_minutes: row.get(8)?,
                pomodoro_long_break_minutes: row.get(9)?,
                pomodoro_sessions_before_long_break: row.get(10)?,
                pomodoro_auto_start: row.get::<_, i64>(11)? != 0,
                daily_study_goal_minutes: row.get(12)?,
                weekly_study_goal_minutes: row.get(13)?,
                monthly_income_amount: row.get(14)?,
                ai_routing_mode: row.get(15)?,
                ai_manual_provider: row.get(16)?,
                ai_manual_gemini_tier: row.get(17)?,
                ai_gemini_flash_model: row.get(18)?,
                ai_gemini_pro_model: row.get(19)?,
                ai_openrouter_model: row.get(20)?,
                ai_local_base_url: row.get(21)?,
                ai_local_model: row.get(22)?,
                ai_temperature: row.get(23)?,
                ai_max_output_tokens: row.get(24)?,
                ai_monthly_spending_limit_usd: row.get(25)?,
                planner_wake_time: row.get(26)?,
                planner_sleep_time: row.get(27)?,
                planner_max_continuous_minutes: row.get(28)?,
                planner_break_minutes: row.get(29)?,
                companion_bubble_size_px: row.get(30)?,
                spotify_client_id: row.get(31)?,
                companion_enabled: row.get::<_, i64>(32)? != 0,
                // A corrupt value falls back to "default order, nothing
                // hidden" rather than failing the whole settings load.
                nav_layout: serde_json::from_str(&nav_json).unwrap_or_default(),
                profile_icon: row.get(34)?,
                onboarding_completed: row.get::<_, i64>(35)? != 0,
                ai_pro_monthly_request_cap: row.get(36)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Range/enum validation the database no longer enforces for columns added
/// after migration 0009 (see that migration's header comment — ALTER
/// TABLE ADD COLUMN + CHECK is unreliable on this table for reasons
/// unrelated to these values themselves). This is the authoritative check
/// for all of them, not just the AI ones the name once implied.
fn validate_settings(settings: &UserSettings) -> Result<(), String> {
    if !["automatic", "manual"].contains(&settings.ai_routing_mode.as_str()) {
        return Err("AI routing mode must be 'automatic' or 'manual'.".to_string());
    }
    if !["gemini", "openrouter"].contains(&settings.ai_manual_provider.as_str()) {
        return Err("AI manual provider must be 'gemini' or 'openrouter'.".to_string());
    }
    if !["flash", "pro"].contains(&settings.ai_manual_gemini_tier.as_str()) {
        return Err("Gemini tier must be 'flash' or 'pro'.".to_string());
    }
    if !(0.0..=2.0).contains(&settings.ai_temperature) {
        return Err("AI temperature must be between 0 and 2.".to_string());
    }
    if settings.ai_max_output_tokens <= 0 {
        return Err("AI max output tokens must be greater than 0.".to_string());
    }
    if settings.ai_monthly_spending_limit_usd < 0.0 {
        return Err("AI monthly spending limit can't be negative.".to_string());
    }
    if settings.planner_max_continuous_minutes <= 0 {
        return Err("Planner max continuous study minutes must be greater than 0.".to_string());
    }
    if settings.planner_break_minutes < 0 {
        return Err("Planner break minutes can't be negative.".to_string());
    }
    if !(48..=160).contains(&settings.companion_bubble_size_px) {
        return Err("Companion bubble size must be between 48 and 160px.".to_string());
    }
    validate_nav_layout(settings)?;
    validate_profile(settings)?;
    if !(0..=10_000).contains(&settings.ai_pro_monthly_request_cap) {
        return Err("The Gemini Pro request cap must be between 0 and 10,000.".to_string());
    }
    Ok(())
}

/// The avatar id is a short lowercase slug ("owl", "graduation-cap") or empty.
/// Unknown ids are deliberately accepted — the frontend owns the preset list
/// and falls back to the name's initial for one it no longer has.
fn validate_profile(settings: &UserSettings) -> Result<(), String> {
    let icon = settings.profile_icon.as_str();
    let well_formed = icon.len() <= 32 && icon.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !well_formed {
        return Err("Profile icon is invalid.".to_string());
    }
    if settings.name.chars().count() > 80 {
        return Err("Name is too long (80 characters max).".to_string());
    }
    Ok(())
}

/// Shape checks for the navigation layout. The frontend owns the item
/// registry, so unknown ids are deliberately NOT rejected (a page removed in
/// a later version must not make saving settings fail) — only structural
/// problems are. "settings" can never be hidden: it is the only way back into
/// this very list, and the private journal's entry gesture lives on its link.
fn validate_nav_layout(settings: &UserSettings) -> Result<(), String> {
    if settings.nav_layout.len() > 64 {
        return Err("Navigation layout has too many items.".to_string());
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for item in &settings.nav_layout {
        let id = item.id.as_str();
        let well_formed = !id.is_empty()
            && id.len() <= 40
            && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !well_formed {
            return Err("Navigation layout contains an invalid item id.".to_string());
        }
        if !seen.insert(id) {
            return Err("Navigation layout lists the same item twice.".to_string());
        }
        if id == "settings" && item.hidden {
            return Err("The Settings tab can't be hidden.".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn update_settings(pool: State<Pool>, settings: UserSettings) -> Result<UserSettings, String> {
    validate_settings(&settings)?;
    let conn = pool.get().map_err(|e| e.to_string())?;
    let layout_json = serde_json::to_string(&settings.dashboard_layout).map_err(|e| e.to_string())?;
    let nav_json = serde_json::to_string(&settings.nav_layout).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE user_settings SET name = ?1, timezone = ?2, week_start = ?3, theme = ?4, \
         accent_color = ?5, dashboard_layout_json = ?6, currency = ?7, pomodoro_work_minutes = ?8, \
         pomodoro_short_break_minutes = ?9, pomodoro_long_break_minutes = ?10, \
         pomodoro_sessions_before_long_break = ?11, pomodoro_auto_start = ?12, \
         daily_study_goal_minutes = ?13, weekly_study_goal_minutes = ?14, monthly_income_amount = ?15, \
         ai_routing_mode = ?16, ai_manual_provider = ?17, ai_manual_gemini_tier = ?18, \
         ai_gemini_flash_model = ?19, ai_gemini_pro_model = ?20, ai_openrouter_model = ?21, \
         ai_local_base_url = ?22, ai_local_model = ?23, ai_temperature = ?24, \
         ai_max_output_tokens = ?25, ai_monthly_spending_limit_usd = ?26, \
         planner_wake_time = ?27, planner_sleep_time = ?28, planner_max_continuous_minutes = ?29, \
         planner_break_minutes = ?30, companion_bubble_size_px = ?31, spotify_client_id = ?32, \
         companion_enabled = ?33, nav_layout_json = ?34, profile_icon = ?35, onboarding_completed = ?36, ai_pro_monthly_request_cap = ?37, \
         updated_at = datetime('now') \
         WHERE id = 1",
        params![
            settings.name,
            settings.timezone,
            settings.week_start,
            settings.theme,
            settings.accent_color,
            layout_json,
            settings.currency,
            settings.pomodoro_work_minutes,
            settings.pomodoro_short_break_minutes,
            settings.pomodoro_long_break_minutes,
            settings.pomodoro_sessions_before_long_break,
            settings.pomodoro_auto_start as i64,
            settings.daily_study_goal_minutes,
            settings.weekly_study_goal_minutes,
            settings.monthly_income_amount,
            settings.ai_routing_mode,
            settings.ai_manual_provider,
            settings.ai_manual_gemini_tier,
            settings.ai_gemini_flash_model,
            settings.ai_gemini_pro_model,
            settings.ai_openrouter_model,
            settings.ai_local_base_url,
            settings.ai_local_model,
            settings.ai_temperature,
            settings.ai_max_output_tokens,
            settings.ai_monthly_spending_limit_usd,
            settings.planner_wake_time,
            settings.planner_sleep_time,
            settings.planner_max_continuous_minutes,
            settings.planner_break_minutes,
            settings.companion_bubble_size_px,
            settings.spotify_client_id,
            settings.companion_enabled as i64,
            nav_json,
            settings.profile_icon,
            settings.onboarding_completed as i64,
            settings.ai_pro_monthly_request_cap,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_settings(pool)
}
