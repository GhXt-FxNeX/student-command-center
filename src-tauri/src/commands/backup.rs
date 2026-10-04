//! Backup & restore ("Export / Import" in Settings → Data).
//!
//! A backup is ONE file (`*.sccbackup`, a standard zip archive) containing:
//!
//! - `manifest.json`          — format version, app/schema version, when it was made,
//!                              whether journal videos are included
//! - `database.sqlite`        — a consistent snapshot of the whole database
//!                              (`VACUUM INTO`, so it is safe while the app is running
//!                              in WAL mode — copying the .sqlite file is not)
//! - `journal/videos/*.enc`   — OPTIONAL: the private journal's still-encrypted videos
//! - `companion_custom/…`     — the custom companion's artwork, if one is installed
//!
//! What is deliberately NOT in it: API keys and Spotify tokens (they live in the OS
//! keychain, never in the database, so they cannot leak through a backup file — the
//! person re-enters / reconnects them after restoring), and the journal password
//! itself (only its salted Argon2 hash is stored anywhere; the journal videos stay
//! encrypted inside the backup and open with the same password after restoring).
//!
//! Restore REPLACES everything. It never swaps the database file out from under the
//! open connection pool; instead it copies the backup's rows into the live database
//! inside a single transaction, so a failure rolls back and leaves the current data
//! exactly as it was. Before touching anything it saves a safety copy of the current
//! database to `backups/pre_import_<time>.sqlite`, and the journal-video / custom-
//! companion folders it replaces are renamed aside (`…pre-import-<time>`), not deleted.

use crate::db::Pool;
use crate::journal::{session::JournalSession, storage};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const FORMAT_VERSION: u32 = 1;
const MANIFEST: &str = "manifest.json";
const DB_ENTRY: &str = "database.sqlite";
const VIDEO_PREFIX: &str = "journal/videos/";
const PACK_PREFIX: &str = "companion_custom/";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const NOT_A_BACKUP: &str = "That file isn't a Student Command Center backup (or it is damaged).";

/// Tables whose rows are defined by migrations rather than by the person (XP rules,
/// level thresholds). A restore keeps the live ones: an older backup must not roll
/// them back to old values a newer migration has since changed.
const KEEP_LIVE_TABLES: &[&str] = &["xp_rules", "level_thresholds"];

// ---- wire types ---------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: u32,
    pub app_version: String,
    pub schema_version: i64,
    /// UTC, "YYYY-MM-DD HH:MM:SS" (SQLite's `datetime('now')`).
    pub created_at: String,
    pub includes_journal_videos: bool,
    pub journal_video_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSizeEstimate {
    /// Upper bound: the database is compressed inside the file, so the real file
    /// is usually smaller. Videos are already compressed and are stored as-is.
    pub without_videos_bytes: u64,
    pub with_videos_bytes: u64,
    pub journal_video_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupExportResult {
    pub path: String,
    pub bytes: u64,
    pub included_journal_videos: bool,
    pub journal_video_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub manifest: BackupManifest,
    pub file_bytes: u64,
    /// Journal videos actually present in the file (should equal the manifest's).
    pub videos_in_file: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupImportResult {
    /// Where the pre-restore copy of the old database was saved.
    pub safety_backup_path: String,
    /// Where the replaced journal videos were moved (None if there were none).
    pub old_journal_videos_kept_at: Option<String>,
}

// ---- small helpers ------------------------------------------------------

fn io_err(e: io::Error) -> String {
    e.to_string()
}

fn zip_err(e: zip::result::ZipError) -> String {
    format!("Backup file error: {e}")
}

/// SQLite string literal for a path: single quotes doubled.
fn sql_str(p: &Path) -> String {
    p.to_string_lossy().replace('\'', "''")
}

/// SQLite identifier: double quotes doubled.
fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// A scratch folder under the app data dir, removed when dropped (even on error).
struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Result<Self, String> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = crate::db::app_data_dir().join("backup_work").join(format!("{prefix}_{nanos}"));
        fs::create_dir_all(&path).map_err(|e| format!("Couldn't create a working folder: {e}"))?;
        Ok(Self(path))
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A consistent copy of the live database at `dest` — safe while the app runs.
/// Also used by "Reset saved data" for its safety backup, which used to copy the
/// .sqlite file directly and so could miss recent changes still sitting in the WAL.
pub fn snapshot_to(conn: &Connection, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_file(dest).map_err(|e| format!("Couldn't replace an existing file: {e}"))?;
    }
    conn.execute_batch(&format!("VACUUM INTO '{}'", sql_str(dest)))
        .map_err(|e| format!("Couldn't copy the database: {e}"))
}

fn schema_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

fn timestamp(conn: &Connection, fmt: &str) -> Result<String, String> {
    conn.query_row(&format!("SELECT strftime('{fmt}', 'now')"), [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Only the file names the journal itself generates (hex + ".enc"); anything else
/// in a backup is refused rather than ever becoming a path on disk.
fn is_safe_video_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// A relative path from inside a backup, rejected if it could escape the folder
/// it is extracted into.
fn safe_relative(rest: &str) -> Option<PathBuf> {
    if rest.is_empty() {
        return None;
    }
    let mut out = PathBuf::new();
    for part in rest.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains(':') {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

/// (relative path with '/' separators, absolute path) of every file under `root`.
fn walk_files(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(path);
            } else if kind.is_file() {
                if let Ok(rel) = path.strip_prefix(root) {
                    let name = rel
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                        .join("/");
                    out.push((name, path));
                }
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// (file name, path, size) of every journal video the database references AND that
/// exists on disk.
fn journal_video_files(conn: &Connection) -> Result<Vec<(String, PathBuf, u64)>, String> {
    let mut stmt = conn
        .prepare("SELECT video_file FROM journal_entries")
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    let mut out = Vec::new();
    for name in names {
        if !is_safe_video_name(&name) {
            continue;
        }
        let path = storage::path_of(&name);
        if let Ok(meta) = fs::metadata(&path) {
            if meta.is_file() {
                out.push((name, path, meta.len()));
            }
        }
    }
    Ok(out)
}

// ---- size estimate (shown before the person chooses what to include) ------

#[tauri::command]
pub async fn get_backup_size_estimate(pool: State<'_, Pool>) -> Result<BackupSizeEstimate, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<BackupSizeEstimate, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let page_count: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let page_size: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let free: i64 = conn.query_row("PRAGMA freelist_count", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let db_bytes = ((page_count - free).max(0) * page_size) as u64;
        let pack_bytes: u64 = walk_files(&crate::companion::custom_pack::install_dir_path())
            .iter()
            .filter_map(|(_, p)| fs::metadata(p).ok())
            .map(|m| m.len())
            .sum();
        let videos = journal_video_files(&conn)?;
        let video_bytes: u64 = videos.iter().map(|v| v.2).sum();
        let base = db_bytes + pack_bytes;
        Ok(BackupSizeEstimate {
            without_videos_bytes: base,
            with_videos_bytes: base + video_bytes,
            journal_video_count: videos.len() as u32,
        })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

// ---- export ---------------------------------------------------------------

#[tauri::command]
pub async fn export_backup(
    pool: State<'_, Pool>,
    dest_path: String,
    include_journal_videos: bool,
) -> Result<BackupExportResult, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || export_blocking(&pool, &dest_path, include_journal_videos))
        .await
        .map_err(|e| format!("Internal error: {e}"))?
}

fn export_blocking(pool: &Pool, dest_path: &str, include_videos: bool) -> Result<BackupExportResult, String> {
    let mut dest = PathBuf::from(dest_path);
    if dest.extension().and_then(|e| e.to_str()) != Some("sccbackup") {
        let mut s = dest.into_os_string();
        s.push(".sccbackup");
        dest = PathBuf::from(s);
    }
    match dest.parent() {
        Some(p) if p.as_os_str().is_empty() || p.is_dir() => {}
        _ => return Err("The folder you chose doesn't exist.".to_string()),
    }

    let conn = pool.get().map_err(|e| e.to_string())?;
    let manifest_schema = schema_version(&conn)?;
    let created_at = timestamp(&conn, "%Y-%m-%d %H:%M:%S")?;

    let tmp = TempDir::new("export")?;
    let snapshot = tmp.path().join(DB_ENTRY);
    snapshot_to(&conn, &snapshot)?;

    let videos = if include_videos { journal_video_files(&conn)? } else { Vec::new() };
    if !include_videos {
        // Without videos the entries (which ARE the videos) are left out too; the
        // journal's password/settings row stays, so it is still "set up" after a restore.
        let snap = Connection::open(&snapshot).map_err(|e| format!("Couldn't prepare the backup: {e}"))?;
        snap.execute_batch("DELETE FROM journal_entries; VACUUM;")
            .map_err(|e| format!("Couldn't prepare the backup: {e}"))?;
    }
    let packs = walk_files(&crate::companion::custom_pack::install_dir_path());

    let manifest = BackupManifest {
        format: FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: manifest_schema,
        created_at,
        includes_journal_videos: include_videos,
        journal_video_count: videos.len() as u32,
    };

    // Written next to the destination and renamed at the end, so a failure or a
    // full disk never leaves something that looks like a complete backup.
    let mut partial_name = dest.clone().into_os_string();
    partial_name.push(".partial");
    let partial = PathBuf::from(partial_name);
    if let Err(e) = write_archive(&partial, &manifest, &snapshot, &videos, &packs) {
        let _ = fs::remove_file(&partial);
        return Err(e);
    }
    if let Err(e) = fs::rename(&partial, &dest) {
        let _ = fs::remove_file(&partial);
        return Err(format!("Couldn't finish saving the backup: {e}"));
    }
    let bytes = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);

    Ok(BackupExportResult {
        path: dest.to_string_lossy().to_string(),
        bytes,
        included_journal_videos: include_videos,
        journal_video_count: manifest.journal_video_count,
    })
}

fn write_archive(
    path: &Path,
    manifest: &BackupManifest,
    snapshot: &Path,
    videos: &[(String, PathBuf, u64)],
    packs: &[(String, PathBuf)],
) -> Result<(), String> {
    let file = File::create(path).map_err(|e| format!("Couldn't create the backup file: {e}"))?;
    let mut zip = ZipWriter::new(BufWriter::new(file));
    // Built fresh each time rather than reused, so this doesn't depend on the
    // options type being Copy.
    let deflated = || SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).large_file(true);
    let stored = || SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(true);

    zip.start_file(MANIFEST, deflated()).map_err(zip_err)?;
    let json = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    zip.write_all(&json).map_err(io_err)?;

    zip.start_file(DB_ENTRY, deflated()).map_err(zip_err)?;
    let mut db = File::open(snapshot).map_err(io_err)?;
    io::copy(&mut db, &mut zip).map_err(io_err)?;

    for (name, source, _) in videos {
        // Journal videos are encrypted already, so compressing them gains nothing.
        zip.start_file(format!("{VIDEO_PREFIX}{name}"), stored()).map_err(zip_err)?;
        let mut f = File::open(source).map_err(|e| format!("Couldn't read a journal video: {e}"))?;
        io::copy(&mut f, &mut zip).map_err(io_err)?;
    }
    for (rel, source) in packs {
        zip.start_file(format!("{PACK_PREFIX}{rel}"), deflated()).map_err(zip_err)?;
        let mut f = File::open(source).map_err(io_err)?;
        io::copy(&mut f, &mut zip).map_err(io_err)?;
    }

    let mut writer = zip.finish().map_err(zip_err)?;
    writer.flush().map_err(io_err)?;
    Ok(())
}

// ---- inspect (what is in this file, and can this version restore it?) -----

#[tauri::command]
pub async fn inspect_backup(path: String) -> Result<BackupInfo, String> {
    tokio::task::spawn_blocking(move || inspect_blocking(Path::new(&path)))
        .await
        .map_err(|e| format!("Internal error: {e}"))?
}

fn inspect_blocking(path: &Path) -> Result<BackupInfo, String> {
    let file = File::open(path).map_err(|e| format!("Couldn't open that file: {e}"))?;
    let file_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut archive = ZipArchive::new(file).map_err(|_| NOT_A_BACKUP.to_string())?;

    let manifest: BackupManifest = {
        let mut entry = archive.by_name(MANIFEST).map_err(|_| NOT_A_BACKUP.to_string())?;
        if entry.size() > MAX_MANIFEST_BYTES {
            return Err(NOT_A_BACKUP.to_string());
        }
        let mut text = String::new();
        entry.read_to_string(&mut text).map_err(|_| NOT_A_BACKUP.to_string())?;
        serde_json::from_str(&text).map_err(|_| NOT_A_BACKUP.to_string())?
    };
    if manifest.format != FORMAT_VERSION {
        return Err("This backup was made by a different version of the app and can't be read by this one.".to_string());
    }
    let latest = crate::db::latest_schema_version();
    if manifest.schema_version > latest {
        return Err(format!(
            "This backup was made by a newer version of the app (database version {}, this app supports up to {}). Update the app, then try again.",
            manifest.schema_version, latest
        ));
    }

    let mut has_db = false;
    let mut videos = 0u32;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|_| NOT_A_BACKUP.to_string())?;
        if entry.is_dir() {
            continue;
        }
        if entry.name() == DB_ENTRY {
            has_db = true;
        } else if entry.name().starts_with(VIDEO_PREFIX) {
            videos += 1;
        }
    }
    if !has_db {
        return Err(NOT_A_BACKUP.to_string());
    }
    Ok(BackupInfo {
        manifest,
        file_bytes,
        videos_in_file: videos,
    })
}

// ---- import (REPLACES everything) -----------------------------------------

#[tauri::command]
pub async fn import_backup(
    pool: State<'_, Pool>,
    journal_session: State<'_, JournalSession>,
    path: String,
) -> Result<BackupImportResult, String> {
    let pool = pool.inner().clone();
    let result = tokio::task::spawn_blocking(move || import_blocking(&pool, Path::new(&path)))
        .await
        .map_err(|e| format!("Internal error: {e}"))??;
    // The restored journal may have a different password: never leave an old
    // unlocked session pointing at it.
    crate::journal::session::lock(&journal_session);
    Ok(result)
}

fn import_blocking(pool: &Pool, path: &Path) -> Result<BackupImportResult, String> {
    // Re-validates (format, version, database present) even though the UI inspected
    // the file already: the file may have changed, and this is the one that matters.
    let info = inspect_blocking(path)?;

    let tmp = TempDir::new("import")?;
    let db_copy = tmp.path().join("backup.sqlite");
    let staged_videos = tmp.path().join("videos");
    let staged_pack = tmp.path().join("pack");
    extract_all(path, &db_copy, &staged_videos, &staged_pack)?;
    verify_backup_db(&db_copy)?;

    let conn = pool.get().map_err(|e| e.to_string())?;

    // Safety copy of what is about to be replaced.
    let stamp = timestamp(&conn, "%Y%m%d-%H%M%S")?;
    let backups_dir = crate::db::app_data_dir().join("backups");
    fs::create_dir_all(&backups_dir).map_err(|e| format!("Couldn't create the backups folder: {e}"))?;
    let safety = backups_dir.join(format!("pre_import_{stamp}.sqlite"));
    snapshot_to(&conn, &safety)?;

    // Files first (renames are instant and reversible), then the database in one
    // transaction; if the database step fails the folders are put back.
    let videos_swap = swap_in(&storage::dir(), &staged_videos, &stamp)?;
    let pack_swap = match swap_in(&crate::companion::custom_pack::install_dir_path(), &staged_pack, &stamp) {
        Ok(s) => s,
        Err(e) => {
            undo_swap(videos_swap);
            return Err(e);
        }
    };
    if let Err(e) = replace_database(&conn, &db_copy) {
        undo_swap(pack_swap);
        undo_swap(videos_swap);
        return Err(e);
    }

    // Success. Keep the replaced videos only if there actually were some.
    let kept_at = match &videos_swap.aside {
        Some(a) if !walk_files(a).is_empty() => Some(a.to_string_lossy().to_string()),
        Some(a) => {
            let _ = fs::remove_dir_all(a);
            None
        }
        None => None,
    };
    let _ = info; // validated above; nothing else from it is needed here
    Ok(BackupImportResult {
        safety_backup_path: safety.to_string_lossy().to_string(),
        old_journal_videos_kept_at: kept_at,
    })
}

fn extract_all(path: &Path, db_out: &Path, videos_dir: &Path, pack_dir: &Path) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("Couldn't open that file: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|_| NOT_A_BACKUP.to_string())?;
    let mut saw_db = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|_| NOT_A_BACKUP.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if name == DB_ENTRY {
            let mut out = File::create(db_out).map_err(io_err)?;
            io::copy(&mut entry, &mut out).map_err(|e| format!("Couldn't read the backup: {e}"))?;
            saw_db = true;
        } else if let Some(rest) = name.strip_prefix(VIDEO_PREFIX) {
            if !is_safe_video_name(rest) {
                return Err("The backup contains an unsafe file name, so it was not restored.".to_string());
            }
            fs::create_dir_all(videos_dir).map_err(io_err)?;
            let mut out = File::create(videos_dir.join(rest)).map_err(io_err)?;
            io::copy(&mut entry, &mut out).map_err(|e| format!("Couldn't read the backup: {e}"))?;
        } else if let Some(rest) = name.strip_prefix(PACK_PREFIX) {
            let Some(rel) = safe_relative(rest) else {
                return Err("The backup contains an unsafe file path, so it was not restored.".to_string());
            };
            let target = pack_dir.join(rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(io_err)?;
            }
            let mut out = File::create(&target).map_err(io_err)?;
            io::copy(&mut entry, &mut out).map_err(|e| format!("Couldn't read the backup: {e}"))?;
        }
    }
    if !saw_db {
        return Err(NOT_A_BACKUP.to_string());
    }
    Ok(())
}

fn verify_backup_db(path: &Path) -> Result<(), String> {
    const DAMAGED: &str = "The data inside this backup is damaged, so nothing was changed.";
    let conn = Connection::open(path).map_err(|_| DAMAGED.to_string())?;
    let verdict: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| DAMAGED.to_string())?;
    if verdict != "ok" {
        return Err(DAMAGED.to_string());
    }
    let settings_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_settings", [], |r| r.get(0))
        .map_err(|_| DAMAGED.to_string())?;
    if settings_rows == 0 {
        return Err(DAMAGED.to_string());
    }
    Ok(())
}

/// A folder that was replaced: `aside` is where the old one went (None if there
/// was no old one).
struct Swapped {
    live: PathBuf,
    aside: Option<PathBuf>,
}

/// Moves the live folder aside (renamed, not deleted) and moves `staged` into its
/// place. If `staged` doesn't exist (the backup has none of this kind of file) the
/// live folder is simply gone afterwards — it is "replace everything".
fn swap_in(live: &Path, staged: &Path, stamp: &str) -> Result<Swapped, String> {
    let aside = if live.exists() {
        let mut name = live.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        name.push(format!(".pre-import-{stamp}"));
        let target = live.with_file_name(name);
        fs::rename(live, &target).map_err(|e| format!("Couldn't set aside your current files: {e}"))?;
        Some(target)
    } else {
        None
    };
    if staged.exists() {
        if let Some(parent) = live.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::rename(staged, live) {
            if let Some(a) = &aside {
                let _ = fs::rename(a, live);
            }
            return Err(format!("Couldn't put the restored files in place: {e}"));
        }
    }
    Ok(Swapped {
        live: live.to_path_buf(),
        aside,
    })
}

fn undo_swap(swapped: Swapped) {
    let _ = fs::remove_dir_all(&swapped.live);
    if let Some(aside) = swapped.aside {
        let _ = fs::rename(aside, &swapped.live);
    }
}

fn list_tables(conn: &Connection, schema: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT name FROM {schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(names)
}

fn columns(conn: &Connection, schema: &str, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA {schema}.table_info({})", quote(table)))
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(cols)
}

/// Columns present in BOTH the live and the backup copy of `table`, so a backup from
/// an older version (fewer columns) restores cleanly — newer columns take their
/// defaults — and extra columns in a backup are ignored.
fn common_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let backup_cols: HashSet<String> = columns(conn, "bk", table)?.into_iter().collect();
    Ok(columns(conn, "main", table)?
        .into_iter()
        .filter(|c| backup_cols.contains(c))
        .collect())
}

fn copy_table(conn: &Connection, table: &str, in_backup: bool) -> Result<(), String> {
    let q = quote(table);
    conn.execute(&format!("DELETE FROM main.{q}"), [])
        .map_err(|e| format!("Couldn't clear {table}: {e}"))?;
    if !in_backup {
        return Ok(());
    }
    let common = common_columns(conn, table)?;
    if common.is_empty() {
        return Ok(());
    }
    let list = common.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");
    conn.execute(&format!("INSERT INTO main.{q} ({list}) SELECT {list} FROM bk.{q}"), [])
        .map_err(|e| format!("Couldn't restore {table}: {e}"))?;
    Ok(())
}

/// The custom companion's species/stage rows are person-made data, but the same two
/// tables also hold the built-in species. So only the 'custom' rows are replaced.
/// Its row id can differ between the backup and the live database (another built-in
/// species may have been added since), so it is re-inserted with a fresh id and
/// every row that points at the old one is updated.
fn restore_custom_companion(conn: &Connection, backup_tables: &HashSet<String>) -> Result<(), String> {
    let step = |e: rusqlite::Error| format!("Couldn't restore the custom companion: {e}");
    conn.execute(
        "DELETE FROM main.companion_evolution_stages WHERE species_id IN \
         (SELECT id FROM main.companion_species WHERE slug = 'custom')",
        [],
    )
    .map_err(step)?;
    conn.execute("DELETE FROM main.companion_species WHERE slug = 'custom'", [])
        .map_err(step)?;
    if !backup_tables.contains("companion_species") || !backup_tables.contains("companion_evolution_stages") {
        return Ok(());
    }
    let old_id: Option<i64> = conn
        .query_row("SELECT id FROM bk.companion_species WHERE slug = 'custom'", [], |r| r.get(0))
        .ok();
    let Some(old_id) = old_id else {
        return Ok(());
    };

    let species_cols: Vec<String> = common_columns(conn, "companion_species")?
        .into_iter()
        .filter(|c| c != "id")
        .collect();
    let list = species_cols.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");
    conn.execute(
        &format!("INSERT INTO main.companion_species ({list}) SELECT {list} FROM bk.companion_species WHERE slug = 'custom'"),
        [],
    )
    .map_err(step)?;
    let new_id = conn.last_insert_rowid();

    let stage_cols: Vec<String> = common_columns(conn, "companion_evolution_stages")?
        .into_iter()
        .filter(|c| c != "id" && c != "species_id")
        .collect();
    let stage_list = stage_cols.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");
    let sep = if stage_cols.is_empty() { "" } else { ", " };
    conn.execute(
        &format!(
            "INSERT INTO main.companion_evolution_stages ({stage_list}{sep}species_id) \
             SELECT {stage_list}{sep}?1 FROM bk.companion_evolution_stages WHERE species_id = ?2"
        ),
        params![new_id, old_id],
    )
    .map_err(step)?;

    if new_id != old_id {
        // The collection was copied with the backup's ids, so anything that
        // referenced the backup's custom species now points at the new one.
        conn.execute(
            "UPDATE main.companion_collection SET species_id = ?1 WHERE species_id = ?2",
            params![new_id, old_id],
        )
        .map_err(step)?;
    }
    Ok(())
}

/// Carries AUTOINCREMENT counters over for the replaced tables, so ids of rows
/// deleted before the backup was made are not handed out again.
fn copy_sequences(conn: &Connection) -> Result<(), String> {
    let keep = "('xp_rules','level_thresholds','companion_species','companion_evolution_stages')";
    let has = |schema: &str| -> bool {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {schema}.sqlite_master WHERE name = 'sqlite_sequence'"),
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    };
    if !has("main") {
        return Ok(());
    }
    let step = |e: rusqlite::Error| format!("Couldn't restore id counters: {e}");
    conn.execute(&format!("DELETE FROM main.sqlite_sequence WHERE name NOT IN {keep}"), [])
        .map_err(step)?;
    if has("bk") {
        conn.execute(
            &format!(
                "INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM bk.sqlite_sequence \
                 WHERE name NOT IN {keep} AND name IN (SELECT name FROM main.sqlite_master WHERE type = 'table')"
            ),
            [],
        )
        .map_err(step)?;
    }
    Ok(())
}

/// Replaces the live data with the backup's. Everything happens in one transaction,
/// and the connection is always returned to the state the pool expects (foreign
/// keys ON, backup detached) — even on failure — because it goes back into the pool.
fn replace_database(conn: &Connection, backup: &Path) -> Result<(), String> {
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS bk", sql_str(backup)))
        .map_err(|e| format!("Couldn't open the backup data: {e}"))?;
    let result = replace_inner(conn);
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON");
    let _ = conn.execute_batch("DETACH DATABASE bk");
    result
}

fn replace_inner(conn: &Connection) -> Result<(), String> {
    // Must be switched off BEFORE the transaction starts (it is ignored inside one).
    conn.execute_batch("PRAGMA foreign_keys = OFF").map_err(|e| e.to_string())?;
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

    let outcome = (|| -> Result<(), String> {
        let live_tables = list_tables(conn, "main")?;
        let backup_tables: HashSet<String> = list_tables(conn, "bk")?.into_iter().collect();
        for table in &live_tables {
            let t = table.as_str();
            if t == "schema_migrations"
                || KEEP_LIVE_TABLES.contains(&t)
                || t == "companion_species"
                || t == "companion_evolution_stages"
            {
                continue;
            }
            copy_table(conn, t, backup_tables.contains(t))?;
        }
        restore_custom_companion(conn, &backup_tables)?;
        copy_sequences(conn)?;

        let mut check = conn.prepare("PRAGMA foreign_key_check").map_err(|e| e.to_string())?;
        if check.exists([]).map_err(|e| e.to_string())? {
            return Err("The backup's data is inconsistent, so nothing was changed.".to_string());
        }
        Ok(())
    })();

    match outcome {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| {
            let _ = conn.execute_batch("ROLLBACK");
            format!("Couldn't finish restoring: {e}")
        }),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
