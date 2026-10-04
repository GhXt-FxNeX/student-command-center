//! Data Management (Phase 14 — future_enhancement.md §1: "Reset Saved
//! Data & Reset Demo Data").
//!
//! Three commands:
//! - `reset_saved_data`: deletes user-created data across every feature
//!   table, backs up the database file first, resets every companion
//!   collection slot (Phase 14 Item 5) to its original seeded state (not
//!   deleted — `companion_collection` rows are singleton slots other code
//!   assumes always exist), and leaves `user_settings` untouched unless
//!   the caller explicitly opts in.
//! - `generate_demo_data`: inserts a small, unmistakably-labeled sample
//!   dataset, every row tagged `is_demo = 1` (migration 0018).
//! - `reset_demo_data`: deletes only `is_demo = 1` rows — never a
//!   heuristic guess at what "looks like" demo data, only what was
//!   explicitly tagged as such when created.
//!
//! All three run inside a single transaction each — a failure partway
//! through rolls back cleanly rather than leaving a half-reset database.

use crate::db::Pool;
use crate::models::{ResetSummary, TableResetCount};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Every table `reset_saved_data` clears, in dependency order (children
/// before the parents they reference) — safe regardless of which exact
/// `ON DELETE` behavior each foreign key uses, since a child row is
/// always gone before its parent is touched.
///
/// Deliberately NOT included: `companion_collection` (reset via UPDATE
/// below, not deleted — see module doc), `user_settings` (kept unless explicitly
/// opted into), and pure reference/config tables that were seeded once
/// and have no per-user editing UI (`companion_species`,
/// `companion_evolution_stages`, `xp_rules`, `level_thresholds`) — those
/// aren't "saved data" in the sense this feature means.
const RESET_TABLES_IN_ORDER: &[&str] = &[
    "schedule_blocks",
    "pomodoro_sessions",
    "study_sessions",
    "study_goals",
    "companion_achievements",
    "companion_evolution_history",
    "companion_event_log",
    "transactions",
    "finance_categories",
    "ai_requests",
    "exams",
    "tasks",
    "topics",
    "subjects",
    "courses",
];

/// Tables `reset_demo_data` scopes its delete to (WHERE is_demo = 1 only)
/// — matches exactly what `generate_demo_data` populates. Not every table
/// in `RESET_TABLES_IN_ORDER` needs its own entry here: e.g. a demo task
/// with `schedule_blocks` pointing at it would cascade-delete those via
/// the foreign key's `ON DELETE CASCADE` (migration 0001) without needing
/// its own `is_demo` flag — but `generate_demo_data` doesn't create any
/// schedule_blocks/study_sessions, so this list only needs what's
/// actually tagged.
const DEMO_TABLES_IN_ORDER: &[&str] = &["transactions", "exams", "tasks", "finance_categories", "subjects", "courses"];

/// Safety copy taken before a reset. Uses SQLite's `VACUUM INTO` (via
/// `backup::snapshot_to`) rather than copying the .sqlite file: the database runs
/// in WAL mode, so a plain file copy can miss recent changes that are still in the
/// -wal file and produce a backup that is quietly out of date.
fn backup_db_file(conn: &Connection) -> Result<String, String> {
    let backups_dir = crate::db::app_data_dir().join("backups");
    std::fs::create_dir_all(&backups_dir).map_err(|e| format!("Couldn't create backups folder: {e}"))?;

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_path: PathBuf = backups_dir.join(format!("reset_backup_{unique}.sqlite"));

    crate::commands::backup::snapshot_to(conn, &backup_path)
        .map_err(|e| format!("Couldn't create a backup before resetting: {e}"))?;
    Ok(backup_path.to_string_lossy().to_string())
}

/// Restores the entire companion collection to exactly the state migration
/// 0021 originally seeded it with: Sparkling (id 1) unlocked/active at
/// level 1/'egg'/0xp/60 happiness, and every other collection slot back to
/// locked/inactive/'egg'/level 1/0xp with `unlocked_at` cleared — undoing
/// any unlocks or active-companion switches, not just the active one's
/// progress. UPDATEs, not DELETEs: `companion_collection` rows are
/// singleton slots other code (the Dashboard companion widget, XP-award
/// logic, the collection UI) assumes always exist, one per slot.
fn reset_companion(tx: &Connection) -> Result<(), String> {
    tx.execute(
        "UPDATE companion_collection SET \
         species_id = (SELECT id FROM companion_species WHERE slug = 'sparkling'), \
         name = 'Sparkling', branch_id = 'main', current_stage = 'egg', xp = 0, level = 1, \
         happiness = 60, mood = 'neutral', state = 'idle', celebration_trigger = NULL, \
         is_unlocked = 1, is_active = 1, unlocked_at = datetime('now'), \
         last_interaction_at = datetime('now'), updated_at = datetime('now') \
         WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE companion_collection SET \
         current_stage = 'egg', xp = 0, level = 1, happiness = 60, mood = 'neutral', \
         state = 'idle', celebration_trigger = NULL, is_unlocked = 0, is_active = 0, \
         unlocked_at = NULL, last_interaction_at = datetime('now'), updated_at = datetime('now') \
         WHERE id != 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Resets `user_settings` to its column defaults by deleting the
/// singleton row and re-running the exact same `INSERT INTO
/// user_settings (id) VALUES (1)` that migration 0001 originally used —
/// every column not explicitly listed falls back to its own `DEFAULT`
/// clause (including columns added by later migrations, e.g. 0009's AI
/// settings), so this can't drift out of sync with what "default" means
/// as the schema grows, unlike hand-maintaining a list of default values
/// here would.
fn reset_settings(tx: &Connection) -> Result<(), String> {
    tx.execute("DELETE FROM user_settings WHERE id = 1", [])
        .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO user_settings (id) VALUES (1)", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clears the profile (name, icon) and re-arms onboarding, so the next launch
/// asks who the user is again. Always part of a saved-data reset — a name and
/// avatar are personal data, not a preference — whether or not the caller also
/// opted into resetting every setting (which would do this anyway, since
/// `onboarding_completed` and `profile_icon` default to 0 / '').
fn reset_profile(tx: &Connection) -> Result<(), String> {
    tx.execute(
        "UPDATE user_settings SET name = '', profile_icon = '', onboarding_completed = 0 WHERE id = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Wipes the private journal back to "never set up" — entries, the
/// password/security row, AND the actual encrypted video files on disk
/// (matching journal/storage.rs's delete, not just the DB rows it
/// tracks), plus locking any currently-unlocked in-memory session so a
/// reset can't leave a stale "unlocked" UI state pointing at data that no
/// longer exists. A full app data reset resetting the journal too matches
/// this command's own "deletes user-created data across every feature"
/// scope (module doc) — the journal is still app data, just password-
/// gated, and it has its own separate "Delete all journal data" action
/// (commands/journal.rs) for someone who wants to clear only the journal.
fn reset_journal(tx: &Connection, session: &crate::journal::session::JournalSession) -> Result<(), String> {
    let mut stmt = tx.prepare("SELECT video_file FROM journal_entries").map_err(|e| e.to_string())?;
    let files: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);
    for file in files {
        crate::journal::storage::delete(&file)?;
    }
    tx.execute("DELETE FROM journal_entries", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM journal_security", []).map_err(|e| e.to_string())?;
    crate::journal::session::lock(session);
    Ok(())
}

#[tauri::command]
pub fn reset_saved_data(
    pool: State<Pool>,
    journal_session: State<crate::journal::session::JournalSession>,
    also_reset_settings: bool,
) -> Result<ResetSummary, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let backup_path = backup_db_file(&conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut deleted = Vec::with_capacity(RESET_TABLES_IN_ORDER.len());
    for table in RESET_TABLES_IN_ORDER {
        tx.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|e| format!("Couldn't clear {table}: {e}"))?;
        deleted.push(TableResetCount {
            table: table.to_string(),
            rows_deleted: tx.changes() as i64,
        });
    }

    reset_companion(&tx)?;
    reset_journal(&tx, &journal_session)?;
    reset_profile(&tx)?;

    if also_reset_settings {
        reset_settings(&tx)?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ResetSummary {
        deleted,
        settings_reset: also_reset_settings,
        backup_path: Some(backup_path),
    })
}

#[tauri::command]
pub fn reset_demo_data(pool: State<Pool>) -> Result<ResetSummary, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut deleted = Vec::with_capacity(DEMO_TABLES_IN_ORDER.len());
    for table in DEMO_TABLES_IN_ORDER {
        tx.execute(&format!("DELETE FROM {table} WHERE is_demo = 1"), [])
            .map_err(|e| format!("Couldn't clear demo rows from {table}: {e}"))?;
        deleted.push(TableResetCount {
            table: table.to_string(),
            rows_deleted: tx.changes() as i64,
        });
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ResetSummary {
        deleted,
        settings_reset: false,
        backup_path: None,
    })
}

/// Inserts a small, unmistakably-labeled sample dataset (every course/
/// task/exam/category name is prefixed "[Demo]", every row tagged
/// `is_demo = 1`) — for trying the app out without mixing fake data into
/// real records, per architecture.md's no-fake-data rule: this is
/// clearly-labeled seed data the person explicitly asked for, never
/// something presented as real.
///
/// Refuses to run if demo data already exists (checks `courses` for any
/// `is_demo = 1` row) rather than silently creating duplicates — the
/// person should reset demo data first if they want a fresh batch.
#[tauri::command]
pub fn generate_demo_data(pool: State<Pool>) -> Result<ResetSummary, String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let existing: i64 = tx
        .query_row("SELECT COUNT(*) FROM courses WHERE is_demo = 1", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if existing > 0 {
        return Err(
            "Demo data already exists. Use \"Reset Demo Data\" first if you want a fresh batch.".to_string(),
        );
    }

    tx.execute(
        "INSERT INTO courses (name, is_demo) VALUES ('[Demo] Anatomy 101', 1), ('[Demo] Biochemistry', 1)",
        [],
    )
    .map_err(|e| e.to_string())?;
    let anatomy_id: i64 = tx
        .query_row("SELECT id FROM courses WHERE name = '[Demo] Anatomy 101'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let biochem_id: i64 = tx
        .query_row("SELECT id FROM courses WHERE name = '[Demo] Biochemistry'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO subjects (course_id, name, is_demo) VALUES (?1, '[Demo] Upper Limb', 1), (?1, '[Demo] Thorax', 1)",
        params![anatomy_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO subjects (course_id, name, is_demo) VALUES (?1, '[Demo] Enzyme Kinetics', 1)",
        params![biochem_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO tasks (title, course_id, status, priority, is_demo) VALUES \
         ('[Demo] Review brachial plexus diagram', ?1, 'not_started', 'medium', 1), \
         ('[Demo] Practice enzyme kinetics problems', ?2, 'not_started', 'high', 1), \
         ('[Demo] Read thorax chapter', ?1, 'completed', 'low', 1)",
        params![anatomy_id, biochem_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO exams (name, course_id, date, status, is_demo) VALUES \
         ('[Demo] Anatomy Midterm', ?1, date('now', 'localtime', '+14 days'), 'upcoming', 1)",
        params![anatomy_id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO finance_categories (name, is_demo) VALUES ('[Demo] Groceries', 1), ('[Demo] Textbooks', 1)",
        [],
    )
    .map_err(|e| e.to_string())?;
    let groceries_id: i64 = tx
        .query_row(
            "SELECT id FROM finance_categories WHERE name = '[Demo] Groceries'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let textbooks_id: i64 = tx
        .query_row(
            "SELECT id FROM finance_categories WHERE name = '[Demo] Textbooks'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO transactions (amount, occurred_on, category_id, description, type, is_demo) VALUES \
         (45.50, date('now', 'localtime', '-3 days'), ?1, '[Demo] Weekly groceries', 'expense', 1), \
         (120.00, date('now', 'localtime', '-10 days'), ?2, '[Demo] Anatomy atlas', 'expense', 1)",
        params![groceries_id, textbooks_id],
    )
    .map_err(|e| e.to_string())?;

    let mut deleted = Vec::new(); // reused as an "inserted counts" summary for the same UI
    for (table, count_sql) in [
        ("courses", "SELECT COUNT(*) FROM courses WHERE is_demo = 1"),
        ("subjects", "SELECT COUNT(*) FROM subjects WHERE is_demo = 1"),
        ("tasks", "SELECT COUNT(*) FROM tasks WHERE is_demo = 1"),
        ("exams", "SELECT COUNT(*) FROM exams WHERE is_demo = 1"),
        ("finance_categories", "SELECT COUNT(*) FROM finance_categories WHERE is_demo = 1"),
        ("transactions", "SELECT COUNT(*) FROM transactions WHERE is_demo = 1"),
    ] {
        let n: i64 = tx.query_row(count_sql, [], |row| row.get(0)).map_err(|e| e.to_string())?;
        deleted.push(TableResetCount {
            table: table.to_string(),
            rows_deleted: n,
        });
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ResetSummary {
        deleted,
        settings_reset: false,
        backup_path: None,
    })
}
