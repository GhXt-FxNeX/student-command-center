//! Encrypted video file storage for the private journal. Files live under
//! `{app_data_dir}/private_journal/videos/`, never as SQLite BLOBs (per
//! future_enhancement.md §8's explicit "do not store large videos
//! directly as SQLite BLOBs unless there is a compelling reason" — there
//! isn't one here). `journal_entries.video_file` stores just the
//! filename; this module is the only place that knows the full path.

use rand::RngCore;
use std::path::PathBuf;

fn videos_dir() -> PathBuf {
    crate::db::app_data_dir().join("private_journal").join("videos")
}

/// The folder the encrypted videos live in (used by backup & restore).
pub fn dir() -> PathBuf {
    videos_dir()
}

/// Full path of one stored video. `filename` must be one this module generated —
/// callers that take names from outside (a backup file) validate them first.
pub fn path_of(filename: &str) -> PathBuf {
    videos_dir().join(filename)
}

pub fn ensure_dir() -> Result<(), String> {
    std::fs::create_dir_all(videos_dir()).map_err(|e| format!("Could not create journal storage directory: {e}"))
}

/// A new, collision-safe filename for a video about to be saved — the
/// caller doesn't get to pick a name (no user-provided string ever
/// becomes a filesystem path component here, sidestepping path-traversal
/// concerns entirely rather than having to sanitize one). 16 random bytes
/// hex-encoded (32 hex chars) — no need for a full UUID crate just for a
/// locally-unique filename; rand + hex are already dependencies.
pub fn new_filename() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{}.enc", hex::encode(bytes))
}

pub fn write_encrypted(filename: &str, data: &[u8]) -> Result<(), String> {
    ensure_dir()?;
    std::fs::write(videos_dir().join(filename), data)
        .map_err(|e| format!("Could not save journal video: {e}"))
}

pub fn read_encrypted(filename: &str) -> Result<Vec<u8>, String> {
    std::fs::read(videos_dir().join(filename)).map_err(|e| format!("Could not read journal video: {e}"))
}

pub fn delete(filename: &str) -> Result<(), String> {
    let path = videos_dir().join(filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Could not delete journal video file: {e}"))?;
    }
    Ok(())
}

/// Total bytes on disk across every stored (still-encrypted) video —
/// backs the "show storage usage" requirement in §8 without needing a
/// running total tracked separately (and possibly drifting from reality).
pub fn total_bytes_on_disk() -> u64 {
    let Ok(entries) = std::fs::read_dir(videos_dir()) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum()
}
