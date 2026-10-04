use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;

/// One embedded SQL migration file. `include_str!` bakes the file into the
/// binary at compile time so the app never depends on finding these files
/// on disk at runtime.
struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_init",
        sql: include_str!("migrations/0001_init.sql"),
    },
    Migration {
        version: 2,
        name: "0002_week_start_all_days",
        sql: include_str!("migrations/0002_week_start_all_days.sql"),
    },
    Migration {
        version: 3,
        name: "0003_companion",
        sql: include_str!("migrations/0003_companion.sql"),
    },
    Migration {
        version: 4,
        name: "0004_phase2_study_pomodoro",
        sql: include_str!("migrations/0004_phase2_study_pomodoro.sql"),
    },
    Migration {
        version: 5,
        name: "0005_deadline_date_only",
        sql: include_str!("migrations/0005_deadline_date_only.sql"),
    },
    Migration {
        version: 6,
        name: "0006_phase4_finance",
        sql: include_str!("migrations/0006_phase4_finance.sql"),
    },
    Migration {
        version: 7,
        name: "0007_phase5_exams",
        sql: include_str!("migrations/0007_phase5_exams.sql"),
    },
    Migration {
        version: 8,
        name: "0008_exam_lifecycle",
        sql: include_str!("migrations/0008_exam_lifecycle.sql"),
    },
    Migration {
        version: 9,
        name: "0009_phase6_ai",
        sql: include_str!("migrations/0009_phase6_ai.sql"),
    },
    Migration {
        version: 10,
        name: "0010_phase7_planner",
        sql: include_str!("migrations/0010_phase7_planner.sql"),
    },
    Migration {
        version: 11,
        name: "0011_raise_ai_max_output_tokens",
        sql: include_str!("migrations/0011_raise_ai_max_output_tokens.sql"),
    },
    Migration {
        version: 12,
        name: "0012_phase8_documents",
        sql: include_str!("migrations/0012_phase8_documents.sql"),
    },
    Migration {
        version: 13,
        name: "0013_remove_local_ai_provider",
        sql: include_str!("migrations/0013_remove_local_ai_provider.sql"),
    },
    Migration {
        version: 14,
        name: "0014_phase8c_scalable_retrieval",
        sql: include_str!("migrations/0014_phase8c_scalable_retrieval.sql"),
    },
    Migration {
        version: 15,
        name: "0015_ocr_status",
        sql: include_str!("migrations/0015_ocr_status.sql"),
    },
    Migration {
        version: 16,
        name: "0016_fts5_chunks",
        sql: include_str!("migrations/0016_fts5_chunks.sql"),
    },
    Migration {
        version: 17,
        name: "0017_drop_documents_system",
        sql: include_str!("migrations/0017_drop_documents_system.sql"),
    },
    Migration {
        version: 18,
        name: "0018_demo_data_tagging",
        sql: include_str!("migrations/0018_demo_data_tagging.sql"),
    },
    Migration {
        version: 19,
        name: "0019_subject_weekly_schedule",
        sql: include_str!("migrations/0019_subject_weekly_schedule.sql"),
    },
    Migration {
        version: 20,
        name: "0020_companion_celebration_trigger",
        sql: include_str!("migrations/0020_companion_celebration_trigger.sql"),
    },
    Migration {
        version: 21,
        name: "0021_companion_collection",
        sql: include_str!("migrations/0021_companion_collection.sql"),
    },
    Migration {
        version: 22,
        name: "0022_companion_bubble_size",
        sql: include_str!("migrations/0022_companion_bubble_size.sql"),
    },
    Migration {
        version: 23,
        name: "0023_spotify_client_id",
        sql: include_str!("migrations/0023_spotify_client_id.sql"),
    },
    Migration {
        version: 24,
        name: "0024_private_journal",
        sql: include_str!("migrations/0024_private_journal.sql"),
    },
    Migration {
        version: 25,
        name: "0025_journal_video_mime_type",
        sql: include_str!("migrations/0025_journal_video_mime_type.sql"),
    },
    Migration {
        version: 26,
        name: "0026_companion_enabled",
        sql: include_str!("migrations/0026_companion_enabled.sql"),
    },
    Migration {
        version: 27,
        name: "0027_nav_layout",
        sql: include_str!("migrations/0027_nav_layout.sql"),
    },
    Migration {
        version: 28,
        name: "0028_study_sessions_local_time",
        sql: include_str!("migrations/0028_study_sessions_local_time.sql"),
    },
    Migration {
        version: 29,
        name: "0029_profile_onboarding",
        sql: include_str!("migrations/0029_profile_onboarding.sql"),
    },
    Migration {
        version: 30,
        name: "0030_ai_pro_request_cap",
        sql: include_str!("migrations/0030_ai_pro_request_cap.sql"),
    },
];

/// Must equal `identifier` in tauri.conf.json. Tauri's own `$APPDATA` (which the
/// companion-pack asset-protocol scope is written against) is
/// `<per-user data folder>/<identifier>` on every OS, so the data folder is built the
/// same way here instead of from the `directories` crate's `ProjectDirs`:
/// `ProjectDirs` agrees with Tauri on macOS only — on Windows it nests
/// `studentcommandcenter\app\data` and on Linux it uses just `~/.local/share/app`,
/// which would leave custom companion art outside the asset scope.
///
/// Resulting folders:
///   macOS   ~/Library/Application Support/com.studentcommandcenter.app   (unchanged)
///   Windows %APPDATA%\com.studentcommandcenter.app
///   Linux   $XDG_DATA_HOME or ~/.local/share/com.studentcommandcenter.app
const APP_IDENTIFIER: &str = "com.studentcommandcenter.app";
const DB_FILE_NAME: &str = "student_command_center.sqlite";

fn resolve_data_dir(per_user_data_dir: &Path) -> PathBuf {
    per_user_data_dir.join(APP_IDENTIFIER)
}

/// Where `ProjectDirs::from("com", "studentcommandcenter", "app")` put the data
/// before this build. Identical to the current folder on macOS (nothing to do there).
fn legacy_data_dir() -> Option<PathBuf> {
    directories::ProjectDirs::from("com", "studentcommandcenter", "app")
        .map(|d| d.data_dir().to_path_buf())
}

/// If an older build left a database in `legacy` and the current folder has none, moves
/// the legacy folder to `current` (a rename, never a copy-then-delete). If the move
/// fails the legacy folder is used as-is, so data is never stranded or lost.
fn adopt_legacy_dir(current: PathBuf, legacy: Option<PathBuf>) -> PathBuf {
    let Some(legacy) = legacy else {
        return current;
    };
    if legacy == current || current.join(DB_FILE_NAME).exists() || !legacy.join(DB_FILE_NAME).exists() {
        return current;
    }
    if let Some(parent) = current.parent() {
        let _ = fs::create_dir_all(parent);
    }
    // An empty folder left by an earlier launch would make the rename fail on Windows;
    // remove_dir only ever removes an EMPTY folder.
    let _ = fs::remove_dir(&current);
    match fs::rename(&legacy, &current) {
        Ok(()) => current,
        Err(_) => legacy,
    }
}

pub fn app_data_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    let dir = DIR.get_or_init(|| {
        let base = directories::BaseDirs::new().unwrap_or_else(|| {
            panic!(
                "Unable to locate your user data folder: no home directory could be determined \
                 for this account."
            )
        });
        adopt_legacy_dir(resolve_data_dir(base.data_dir()), legacy_data_dir())
    });
    fs::create_dir_all(dir).unwrap_or_else(|e| {
        panic!(
            "Unable to create the application data folder at {}: {e}. Check that this folder \
             is writable.",
            dir.display()
        )
    });
    dir.clone()
}

/// The newest schema version this build knows (the last migration). A backup made
/// by a build with a HIGHER number can't be restored here.
pub fn latest_schema_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

pub fn db_path() -> PathBuf {
    app_data_dir().join(DB_FILE_NAME)
}

/// Copies the DB file before running migrations, so a bad migration is
/// always recoverable — see the "Tauri + SQLite migrations" risk note in
/// the architecture doc.
fn backup_before_migrate(path: &PathBuf) {
    if path.exists() {
        let backup = path.with_extension("sqlite.pre-migration-bak");
        let _ = fs::copy(path, backup);
    }
}

pub fn init_pool() -> Pool {
    let path = db_path();
    backup_before_migrate(&path);

    let manager = SqliteConnectionManager::file(&path).with_init(|c| {
        c.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
    });
    let pool = r2d2::Pool::new(manager).unwrap_or_else(|e| {
        panic!(
            "Unable to open the database at {}: {e}. Check that the folder is writable and the \
             file is not locked by another program.",
            path.display()
        )
    });

    let conn = pool.get().unwrap_or_else(|e| {
        panic!("Unable to open the database at {} to apply migrations: {e}", path.display())
    });
    run_migrations(&conn);

    pool
}

fn run_migrations(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .expect("failed to create schema_migrations table");

    let mut applied: Vec<i64> = conn
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    applied.sort();

    for migration in MIGRATIONS {
        if applied.contains(&migration.version) {
            continue;
        }
        conn.execute_batch(migration.sql).unwrap_or_else(|e| {
            panic!(
                "migration {} ({}) failed: {e}. Database was backed up before migrating.",
                migration.version, migration.name
            )
        });
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            (migration.version, migration.name),
        )
        .expect("failed to record migration");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "scc_dbdir_test_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn data_dir_is_identifier_under_per_user_folder() {
        let base = Path::new("base").join("share");
        assert_eq!(resolve_data_dir(&base), base.join("com.studentcommandcenter.app"));
    }

    #[test]
    fn legacy_database_is_moved_when_current_has_none() {
        let root = scratch("move");
        let legacy = root.join("legacy");
        let current = root.join("current");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join(DB_FILE_NAME), b"db").unwrap();

        let used = adopt_legacy_dir(current.clone(), Some(legacy.clone()));
        assert_eq!(used, current);
        assert!(current.join(DB_FILE_NAME).exists());
        assert!(!legacy.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn existing_current_database_is_never_replaced() {
        let root = scratch("keep");
        let legacy = root.join("legacy");
        let current = root.join("current");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&current).unwrap();
        fs::write(legacy.join(DB_FILE_NAME), b"old").unwrap();
        fs::write(current.join(DB_FILE_NAME), b"new").unwrap();

        let used = adopt_legacy_dir(current.clone(), Some(legacy.clone()));
        assert_eq!(used, current);
        assert_eq!(fs::read(current.join(DB_FILE_NAME)).unwrap(), b"new");
        assert!(legacy.join(DB_FILE_NAME).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn folder_without_a_database_is_left_alone() {
        let root = scratch("nodb");
        let legacy = root.join("legacy");
        let current = root.join("current");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("unrelated.txt"), b"x").unwrap();

        assert_eq!(adopt_legacy_dir(current.clone(), Some(legacy.clone())), current);
        assert!(legacy.join("unrelated.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn same_folder_is_a_no_op() {
        let root = scratch("same");
        fs::write(root.join(DB_FILE_NAME), b"db").unwrap();
        assert_eq!(adopt_legacy_dir(root.clone(), Some(root.clone())), root);
        assert!(root.join(DB_FILE_NAME).exists());
        let _ = fs::remove_dir_all(&root);
    }
}
