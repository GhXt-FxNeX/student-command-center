use rusqlite::{params, Connection, OptionalExtension};

pub struct CompanionRow {
    pub id: i64,
    pub species_id: i64,
    pub species_slug: String,
    pub name: String,
    pub branch_id: String,
    pub current_stage: String,
    pub xp: i64,
    pub level: i64,
    pub happiness: i64,
    pub mood: String,
    pub state: String,
    pub celebration_trigger: Option<String>,
}

fn companion_row_from_sql(row: &rusqlite::Row) -> rusqlite::Result<CompanionRow> {
    Ok(CompanionRow {
        id: row.get(0)?,
        species_id: row.get(1)?,
        species_slug: row.get(2)?,
        name: row.get(3)?,
        branch_id: row.get(4)?,
        current_stage: row.get(5)?,
        xp: row.get(6)?,
        level: row.get(7)?,
        happiness: row.get(8)?,
        mood: row.get(9)?,
        state: row.get(10)?,
        celebration_trigger: row.get(11)?,
    })
}

const COMPANION_ROW_SELECT: &str = "SELECT c.id, c.species_id, s.slug, c.name, c.branch_id, c.current_stage, \
     c.xp, c.level, c.happiness, c.mood, c.state, c.celebration_trigger \
     FROM companion_collection c JOIN companion_species s ON s.id = c.species_id";

/// The one companion currently being displayed/interacted with (Phase 14
/// Item 5 — companion_collection.is_active). Exactly one row has
/// is_active = 1, enforced by a partial unique index (migration 0021), so
/// this can never ambiguously match more than one row.
pub fn get_active_companion(conn: &Connection) -> Result<CompanionRow, String> {
    conn.query_row(
        &format!("{COMPANION_ROW_SELECT} WHERE c.is_active = 1"),
        [],
        companion_row_from_sql,
    )
    .map_err(|e| e.to_string())
}

pub fn get_companion_by_id(conn: &Connection, id: i64) -> Result<CompanionRow, String> {
    conn.query_row(
        &format!("{COMPANION_ROW_SELECT} WHERE c.id = ?1"),
        params![id],
        companion_row_from_sql,
    )
    .map_err(|e| e.to_string())
}

pub struct XpRule {
    pub xp_amount: i64,
    pub happiness_delta: i64,
    pub cooldown_seconds: Option<i64>,
}

pub fn get_xp_rule(conn: &Connection, event_type: &str) -> Result<Option<XpRule>, String> {
    conn.query_row(
        "SELECT xp_amount, happiness_delta, cooldown_seconds FROM xp_rules WHERE event_type = ?1",
        params![event_type],
        |row| {
            Ok(XpRule {
                xp_amount: row.get(0)?,
                happiness_delta: row.get(1)?,
                cooldown_seconds: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Seconds since this event type last fired, or None if it has never fired.
pub fn seconds_since_last_event(conn: &Connection, event_type: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT CAST((julianday('now') - julianday(occurred_at)) * 86400 AS INTEGER) \
         FROM companion_event_log WHERE event_type = ?1 ORDER BY occurred_at DESC LIMIT 1",
        params![event_type],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn log_event(
    conn: &Connection,
    event_type: &str,
    payload_json: &str,
    xp_delta: i64,
    happiness_delta: i64,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO companion_event_log (event_type, payload_json, xp_delta, happiness_delta) \
         VALUES (?1, ?2, ?3, ?4)",
        params![event_type, payload_json, xp_delta, happiness_delta],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// Count of events matching one of the given types within the last `seconds`.
pub fn recent_event_count(conn: &Connection, event_types: &[&str], seconds: i64) -> Result<i64, String> {
    let placeholders = event_types.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT COUNT(*) FROM companion_event_log \
         WHERE event_type IN ({placeholders}) \
         AND (julianday('now') - julianday(occurred_at)) * 86400 <= ?"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut param_values: Vec<&dyn rusqlite::ToSql> =
        event_types.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    param_values.push(&seconds);
    stmt.query_row(param_values.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())
}

pub fn update_companion(
    conn: &Connection,
    id: i64,
    xp: i64,
    level: i64,
    happiness: i64,
    mood: &str,
    celebration_trigger: Option<&str>,
    stage: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE companion_collection SET xp = ?1, level = ?2, happiness = ?3, mood = ?4, \
         celebration_trigger = ?5, current_stage = ?6, \
         last_interaction_at = datetime('now'), updated_at = datetime('now') WHERE id = ?7",
        params![xp, level, happiness, mood, celebration_trigger, stage, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn xp_required_for_level(conn: &Connection, level: i64) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT xp_required FROM level_thresholds WHERE level = ?1",
        params![level],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub struct EvolutionStageRow {
    pub stage: String,
    pub min_level: i64,
}

/// All stages for this companion's species+branch, ordered so the *last*
/// one whose `min_level` the companion meets is the correct current stage.
pub fn evolution_stages(conn: &Connection, species_id: i64, branch_id: &str) -> Result<Vec<EvolutionStageRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT stage, min_level FROM companion_evolution_stages \
             WHERE species_id = ?1 AND branch_id = ?2 AND condition_type = 'xp_threshold' \
             ORDER BY min_level ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![species_id, branch_id], |row| {
            Ok(EvolutionStageRow {
                stage: row.get(0)?,
                min_level: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

pub fn record_evolution(
    conn: &Connection,
    companion_id: i64,
    from_stage: &str,
    to_stage: &str,
    trigger_event_id: Option<i64>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO companion_evolution_history (companion_id, from_stage, to_stage, trigger_event_id) \
         VALUES (?1, ?2, ?3, ?4)",
        params![companion_id, from_stage, to_stage, trigger_event_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_companion_name(conn: &Connection, id: i64, name: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE companion_collection SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Switches which species' art the companion uses, re-resolving
/// `current_stage` for the new species (Phase 14 Item 4 — activating/
/// reverting a custom pack). Deliberately does NOT touch xp/level/
/// happiness/mood/name: a species swap changes appearance, not progression.
pub fn set_companion_species(conn: &Connection, id: i64, species_id: i64, current_stage: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE companion_collection SET species_id = ?1, current_stage = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![species_id, current_stage, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One row for the collection UI (future_enhancement.md §4 — "owned/locked
/// companions, current companion, level, XP, evolution progress"). A
/// locked companion's xp/level/stage are still real columns (all start at
/// the same egg/level-1/0xp default, migration 0021), just not shown as
/// progress in the UI — see commands/companion.rs for what's actually
/// surfaced to the frontend for a locked slot.
pub struct CollectionEntry {
    pub id: i64,
    pub species_slug: String,
    pub species_name: String,
    pub name: String,
    pub current_stage: String,
    pub xp: i64,
    pub level: i64,
    pub happiness: i64,
    pub mood: String,
    pub is_unlocked: bool,
    pub is_active: bool,
}

pub fn list_collection(conn: &Connection) -> Result<Vec<CollectionEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT c.id, s.slug, s.display_name, c.name, c.current_stage, \
             c.xp, c.level, c.happiness, c.mood, c.is_unlocked, c.is_active \
             FROM companion_collection c JOIN companion_species s ON s.id = c.species_id \
             ORDER BY c.unlock_order ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CollectionEntry {
                id: row.get(0)?,
                species_slug: row.get(1)?,
                species_name: row.get(2)?,
                name: row.get(3)?,
                current_stage: row.get(4)?,
                xp: row.get(5)?,
                level: row.get(6)?,
                happiness: row.get(7)?,
                mood: row.get(8)?,
                is_unlocked: row.get::<_, i64>(9)? != 0,
                is_active: row.get::<_, i64>(10)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// Unlocks the next locked companion in `unlock_order` (future_enhancement.md
/// §4 — reaching a companion's final evolution unlocks another). Returns
/// the unlocked companion's id, or None if every collection slot is
/// already unlocked (nothing left to unlock, not an error).
pub fn unlock_next_locked(conn: &Connection) -> Result<Option<i64>, String> {
    let next_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM companion_collection WHERE is_unlocked = 0 ORDER BY unlock_order ASC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = next_id {
        conn.execute(
            "UPDATE companion_collection SET is_unlocked = 1, unlocked_at = datetime('now'), \
             updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(next_id)
}

/// Makes `target_id` the active companion and every other collection slot
/// inactive. Caller (commands/companion.rs) is responsible for checking
/// `target_id` is actually unlocked first — this function only enforces
/// the "exactly one active" invariant, not the unlock rule, since that's a
/// user-facing validation concern, not a storage concern.
pub fn switch_active(conn: &Connection, target_id: i64) -> Result<(), String> {
    conn.execute("UPDATE companion_collection SET is_active = 0 WHERE is_active = 1", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE companion_collection SET is_active = 1, last_interaction_at = datetime('now'), \
         updated_at = datetime('now') WHERE id = ?1",
        params![target_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn species_id_by_slug(conn: &Connection, slug: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM companion_species WHERE slug = ?1",
        params![slug],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn species_display_name(conn: &Connection, species_id: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT display_name FROM companion_species WHERE id = ?1",
        params![species_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Inserts a new species row, or updates the display name/description of
/// an existing one with the same slug (re-installing a custom pack updates
/// its name rather than accumulating duplicate species rows). Returns the
/// species id either way.
pub fn upsert_species(
    conn: &Connection,
    slug: &str,
    display_name: &str,
    description: &str,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO companion_species (slug, display_name, description) VALUES (?1, ?2, ?3) \
         ON CONFLICT(slug) DO UPDATE SET display_name = excluded.display_name, description = excluded.description",
        params![slug, display_name, description],
    )
    .map_err(|e| e.to_string())?;
    species_id_by_slug(conn, slug)?.ok_or_else(|| "species upsert did not produce a row".to_string())
}

/// Copies `from_species_id`'s evolution-stage thresholds onto
/// `to_species_id` (replacing whatever was there), so a custom pack follows
/// the exact same level curve as the built-in companion rather than needing
/// its own — a custom pack only supplies art, not progression rules.
pub fn copy_evolution_thresholds(conn: &Connection, from_species_id: i64, to_species_id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM companion_evolution_stages WHERE species_id = ?1",
        params![to_species_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO companion_evolution_stages (species_id, branch_id, stage, min_level, condition_type, condition_json) \
         SELECT ?1, branch_id, stage, min_level, condition_type, condition_json \
         FROM companion_evolution_stages WHERE species_id = ?2",
        params![to_species_id, from_species_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
