use super::events::{CompanionEvent, CompanionEventType};
use super::{evolution, mood, persistence, xp};
use crate::models::CompanionState;
use rusqlite::Connection;

fn clamp_happiness(value: i64) -> i64 {
    value.clamp(15, 100) // floor above zero per the "recovery, not punishment" rule (A6)
}

fn to_state(conn: &Connection, row: &persistence::CompanionRow) -> Result<CompanionState, String> {
    Ok(CompanionState {
        id: row.id,
        name: row.name.clone(),
        species_slug: row.species_slug.clone(),
        current_stage: row.current_stage.clone(),
        xp: row.xp,
        level: row.level,
        happiness: row.happiness,
        mood: row.mood.clone(),
        state: row.state.clone(),
        celebration_trigger: row.celebration_trigger.clone(),
        xp_for_next_level: xp::xp_for_next_level(conn, row.level)?,
    })
}

pub fn get_state(conn: &Connection) -> Result<CompanionState, String> {
    let row = persistence::get_active_companion(conn)?;
    to_state(conn, &row)
}

/// Apply one companion event end-to-end: reward → level check → evolution
/// check → mood recompute → persist → return the fresh state. Entirely
/// deterministic — no AI call anywhere in this function, per architecture.md
/// A1/A4. Called by domain command modules after their own write commits.
pub fn process_event(conn: &Connection, event: CompanionEvent) -> Result<CompanionState, String> {
    let reward = xp::evaluate_event(conn, event.event_type)?;
    let event_id = persistence::log_event(
        conn,
        event.event_type,
        &event.payload.to_string(),
        reward.xp_delta,
        reward.happiness_delta,
    )?;

    let companion = persistence::get_active_companion(conn)?;

    if reward.on_cooldown {
        // Still logged for the audit trail / mood window, but no reward applied.
        return to_state(conn, &companion);
    }

    let new_xp = (companion.xp + reward.xp_delta).max(0);
    let new_happiness = clamp_happiness(companion.happiness + reward.happiness_delta);
    let new_level = xp::level_for_xp(conn, new_xp)?;

    let leveled_up = new_level > companion.level;
    if leveled_up {
        persistence::log_event(conn, CompanionEventType::LevelUp.as_str(), "{}", 0, 0)?;
    }

    let new_stage =
        evolution::resolve_stage_for_level(conn, companion.species_id, &companion.branch_id, new_level)?;
    let evolved = new_stage != companion.current_stage;
    if evolved {
        persistence::log_event(conn, CompanionEventType::EvolutionUnlocked.as_str(), "{}", 0, 0)?;
        persistence::record_evolution(conn, companion.id, &companion.current_stage, &new_stage, Some(event_id))?;

        // Phase 14 Item 5: reaching the final evolution stage of the
        // active companion unlocks the next one in the collection
        // (future_enhancement.md §4). "mega" is the last of the 7 stages
        // (companion_collection.current_stage CHECK constraint order,
        // migration 0021) — deterministic, not an AI judgment call.
        if new_stage == "mega" {
            persistence::unlock_next_locked(conn)?;
        }
    }

    let (new_mood, celebration_trigger) = mood::compute_mood(conn, new_happiness)?;

    persistence::update_companion(
        conn,
        companion.id,
        new_xp,
        new_level,
        new_happiness,
        new_mood,
        celebration_trigger,
        &new_stage,
    )?;

    let updated = persistence::get_companion_by_id(conn, companion.id)?;
    to_state(conn, &updated)
}
