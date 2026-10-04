use crate::companion::{assets, custom_pack, engine, evolution, persistence};
use crate::db::Pool;
use crate::models::CompanionState;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_companion_state(pool: State<Pool>) -> Result<CompanionState, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    engine::get_state(&conn)
}

#[tauri::command]
pub fn get_companion_manifest(app: AppHandle) -> Result<assets::AssetManifest, String> {
    let assets_root = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("assets")
        .join("companions");

    // In `tauri dev`, resources aren't bundled yet — fall back to the repo's
    // assets/ folder relative to src-tauri/ so the manifest still loads.
    let dev_fallback = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("assets")
        .join("companions");

    let root = if assets_root.join("manifest.json").exists() {
        assets_root
    } else {
        dev_fallback
    };

    let mut manifest = assets::load_manifest(&root)?;

    // Phase 14 Item 4: merge in any installed custom companion pack(s) —
    // currently just the single "custom" slot, but load_all_custom_species
    // already scans generically so a future multi-slot Collection feature
    // (item 5) needs no changes here.
    let companion_packs_dir = crate::db::app_data_dir().join("companion_packs");
    let (custom_species, custom_missing) = assets::load_all_custom_species(&companion_packs_dir);
    manifest.species.extend(custom_species);
    manifest.missing_files.extend(custom_missing);

    Ok(manifest)
}

#[tauri::command]
pub fn rename_companion(app: AppHandle, pool: State<Pool>, name: String) -> Result<CompanionState, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name can't be empty.".to_string());
    }
    if trimmed.chars().count() > 40 {
        return Err("Name is too long (40 characters max).".to_string());
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    let active = persistence::get_active_companion(&conn)?;
    persistence::set_companion_name(&conn, active.id, trimmed)?;
    let state = engine::get_state(&conn)?;

    if let Err(e) = app.emit("companion:updated", state.clone()) {
        eprintln!("[companion] failed to emit companion:updated after rename: {e}");
    }
    Ok(state)
}

/// Step 1 of adding a custom companion pack: extracts + scans the zip the
/// person picked (animations only — no manifest.json) and returns a draft
/// for the editor screen. Nothing is installed yet.
#[tauri::command]
pub fn inspect_custom_companion_zip(zip_path: String) -> Result<custom_pack::PackDraft, String> {
    custom_pack::inspect_zip(&zip_path)
}

/// Opens the installed custom pack as an editable draft ("Edit details").
#[tauri::command]
pub fn get_custom_companion_draft(pool: State<Pool>) -> Result<Option<custom_pack::PackDraft>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    custom_pack::get_installed_draft(&conn)
}

/// Step 2: validates + saves the details the person confirmed on the editor
/// screen — installs the staged upload (`mode == "new"`) or rewrites the
/// installed pack's details (`mode == "installed"`). Neither switches the
/// active companion's art — see `activate_custom_companion`. Emits
/// `companion:assets-changed` so the frontend re-reads the asset manifest
/// (it's otherwise only loaded once at startup, so a new/edited pack would
/// look stale until relaunch).
#[tauri::command]
pub fn save_custom_companion_pack(
    app: AppHandle,
    pool: State<Pool>,
    mode: String,
    edit: custom_pack::PackEdit,
) -> Result<custom_pack::CustomPackSummary, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let summary = custom_pack::save_pack(&conn, &mode, &edit)?;
    if let Err(e) = app.emit("companion:assets-changed", ()) {
        eprintln!("[companion] failed to emit companion:assets-changed after saving a pack: {e}");
    }
    Ok(summary)
}

/// The person cancelled the editor screen — drop the staged upload.
#[tauri::command]
pub fn discard_custom_companion_draft() -> Result<(), String> {
    custom_pack::discard_draft();
    Ok(())
}

/// Deletes the installed custom pack entirely — previously the only way
/// to get rid of one was to upload a *different* pack (which replaces it
/// as a side effect of installing); there was no way to just remove it
/// and go back to a built-in companion. If the custom pack happens to be
/// the one currently active, this reverts to Sparkling first (identical
/// to what "Revert to default companion" already does) so the active
/// companion_collection row stops referencing the species before its row
/// is deleted, and so nothing is left mid-switch. A no-op, not an error,
/// if nothing is installed.
#[tauri::command]
pub fn delete_custom_companion_pack(app: AppHandle, pool: State<Pool>) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let Some(species_id) = persistence::species_id_by_slug(&conn, "custom")? else {
        return Ok(());
    };
    if persistence::get_active_companion(&conn)?.species_id == species_id {
        let sparkling_id = persistence::species_id_by_slug(&conn, "sparkling")?
            .ok_or("The built-in companion species is missing from the database.")?;
        switch_species(&app, &conn, sparkling_id)?;
    }
    custom_pack::delete_installed(&conn, species_id)?;
    if let Err(e) = app.emit("companion:assets-changed", ()) {
        eprintln!("[companion] failed to emit companion:assets-changed after deleting the custom pack: {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn activate_custom_companion(app: AppHandle, pool: State<Pool>) -> Result<CompanionState, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let species_id = persistence::species_id_by_slug(&conn, "custom")?
        .ok_or("No custom companion pack is installed yet — upload one first.")?;
    switch_species(&app, &conn, species_id)
}

#[tauri::command]
pub fn revert_to_default_companion(app: AppHandle, pool: State<Pool>) -> Result<CompanionState, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let species_id = persistence::species_id_by_slug(&conn, "sparkling")?
        .ok_or("The built-in companion species is missing from the database.")?;
    switch_species(&app, &conn, species_id)
}

fn switch_species(app: &AppHandle, conn: &rusqlite::Connection, species_id: i64) -> Result<CompanionState, String> {
    let companion = persistence::get_active_companion(conn)?;
    let new_stage = evolution::resolve_stage_for_level(conn, species_id, &companion.branch_id, companion.level)?;
    persistence::set_companion_species(conn, companion.id, species_id, &new_stage)?;
    let state = engine::get_state(conn)?;

    if let Err(e) = app.emit("companion:updated", state.clone()) {
        eprintln!("[companion] failed to emit companion:updated after species switch: {e}");
    }
    Ok(state)
}

#[tauri::command]
pub fn get_custom_companion_status(pool: State<Pool>) -> Result<Option<custom_pack::CustomPackSummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    custom_pack::get_status(&conn)
}

/// One entry for the collection UI (future_enhancement.md §4). Locked
/// entries deliberately omit progress fields the person hasn't earned the
/// right to see yet — a locked companion's xp/level in the database is
/// just its untouched default (egg, level 1, 0xp), not meaningful
/// information, so showing it would be misleading rather than honest.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionEntrySummary {
    pub id: i64,
    pub species_slug: String,
    pub species_name: String,
    pub name: String,
    pub is_unlocked: bool,
    pub is_active: bool,
    pub current_stage: Option<String>,
    pub level: Option<i64>,
    pub xp: Option<i64>,
    pub xp_for_next_level: Option<i64>,
    pub happiness: Option<i64>,
    pub mood: Option<String>,
}

#[tauri::command]
pub fn get_companion_collection(pool: State<Pool>) -> Result<Vec<CollectionEntrySummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let rows = persistence::list_collection(&conn)?;
    rows.into_iter()
        .map(|r| {
            let xp_for_next_level = if r.is_unlocked {
                crate::companion::xp::xp_for_next_level(&conn, r.level)?
            } else {
                None
            };
            Ok(CollectionEntrySummary {
                id: r.id,
                species_slug: r.species_slug,
                species_name: r.species_name,
                name: r.name,
                is_unlocked: r.is_unlocked,
                is_active: r.is_active,
                current_stage: r.is_unlocked.then_some(r.current_stage),
                level: r.is_unlocked.then_some(r.level),
                xp: r.is_unlocked.then_some(r.xp),
                xp_for_next_level,
                happiness: r.is_unlocked.then_some(r.happiness),
                mood: r.is_unlocked.then_some(r.mood),
            })
        })
        .collect()
}

/// Switches which collection companion is active (future_enhancement.md
/// §4 — "New companion starts at Level 0 [and] its first evolution stage
/// ... Previous companion keeps its progress"). Both halves of that are
/// already true by construction: a locked companion was seeded at
/// level 1/egg/0xp and nothing ever touches an inactive companion's row
/// (process_event only reads/writes the active one), so switching is
/// just flipping which row is_active — no data to reset or preserve here.
#[tauri::command]
pub fn switch_active_companion(app: AppHandle, pool: State<Pool>, id: i64) -> Result<CompanionState, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let entry = persistence::list_collection(&conn)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| "No companion with that id.".to_string())?;
    if !entry.is_unlocked {
        return Err("That companion hasn't been unlocked yet.".to_string());
    }

    persistence::switch_active(&conn, id)?;
    let state = engine::get_state(&conn)?;

    if let Err(e) = app.emit("companion:updated", state.clone()) {
        eprintln!("[companion] failed to emit companion:updated after switching active companion: {e}");
    }
    Ok(state)
}
