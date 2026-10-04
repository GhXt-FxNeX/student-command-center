use super::persistence;
use rusqlite::Connection;

/// Given the companion's current level, resolve which stage it should be
/// in. v1 only has `xp_threshold` stages (checked via `min_level`, which is
/// itself derived from the seeded xp/level curve) — `stat_based` branching
/// stages are schema-ready (see companion_evolution_stages.condition_type)
/// but nothing populates or evaluates that path yet, per the instruction
/// not to build branching logic in this phase.
pub fn resolve_stage_for_level(
    conn: &Connection,
    species_id: i64,
    branch_id: &str,
    level: i64,
) -> Result<String, String> {
    let stages = persistence::evolution_stages(conn, species_id, branch_id)?;
    let mut resolved = "egg".to_string();
    for stage in stages {
        if level >= stage.min_level {
            resolved = stage.stage;
        } else {
            break;
        }
    }
    Ok(resolved)
}
