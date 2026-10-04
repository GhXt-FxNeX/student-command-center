//! Tauri commands for the Secret Private Video Journal
//! (future_enhancement.md §8). Every command that touches entry content
//! (title, note, video bytes) calls `journal::session::get_active_key`
//! first — that's the single enforcement point for "locked means locked,"
//! including auto-lock. There's no separate "is unlocked" check scattered
//! across commands to get out of sync with the real one.
//!
//! Async + spawn_blocking throughout, same reasoning as commands/ai.rs
//! and commands/spotify.rs: password hashing (Argon2) and file I/O are
//! both blocking work that doesn't belong on Tauri's main thread.

use crate::db::Pool;
use crate::journal::session::JournalSession;
use crate::journal::{crypto, session, storage};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalStatus {
    /// False before the very first password is ever set — the frontend
    /// shows a "create a password" flow instead of a "enter password" one.
    pub configured: bool,
    pub unlocked: bool,
    pub auto_lock_minutes: i64,
    /// Seconds to wait before another unlock attempt is accepted — 0 means
    /// not currently rate-limited. Surfaced so the UI can show a countdown
    /// instead of a bare rejection.
    pub locked_out_for_seconds: i64,
}

struct SecurityRow {
    password_hash: String,
    key_salt: String,
    auto_lock_minutes: i64,
    failed_attempts: i64,
    locked_until: Option<String>,
}

fn get_security_row(conn: &rusqlite::Connection) -> Result<Option<SecurityRow>, String> {
    conn.query_row(
        "SELECT password_hash, key_salt, auto_lock_minutes, failed_attempts, locked_until \
         FROM journal_security WHERE id = 1",
        [],
        |row| {
            Ok(SecurityRow {
                password_hash: row.get(0)?,
                key_salt: row.get(1)?,
                auto_lock_minutes: row.get(2)?,
                failed_attempts: row.get(3)?,
                locked_until: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn seconds_until(locked_until: &Option<String>) -> i64 {
    let Some(ts) = locked_until else { return 0 };
    let Ok(target) = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S") else {
        return 0;
    };
    let now = chrono::Utc::now().naive_utc();
    (target - now).num_seconds().max(0)
}

/// Backoff schedule for repeated wrong-password attempts — grows with
/// each additional failure past the free first few, capped at 15 minutes.
/// future_enhancement.md §8 just says "use reasonable protection against
/// repeated password attempts" without specifying numbers; this is a
/// deliberately simple, fully deterministic schedule rather than
/// something elaborate.
fn backoff_seconds(failed_attempts: i64) -> i64 {
    match failed_attempts {
        0..=4 => 0,
        5..=7 => 30,
        8..=10 => 120,
        _ => 900,
    }
}

#[tauri::command]
pub async fn journal_status(pool: State<'_, Pool>, session: State<'_, JournalSession>) -> Result<JournalStatus, String> {
    let unlocked = session::is_unlocked(&session);
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<JournalStatus, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let row = get_security_row(&conn)?;
        Ok(match row {
            None => JournalStatus { configured: false, unlocked, auto_lock_minutes: 15, locked_out_for_seconds: 0 },
            Some(r) => JournalStatus {
                configured: true,
                unlocked,
                auto_lock_minutes: r.auto_lock_minutes,
                locked_out_for_seconds: seconds_until(&r.locked_until),
            },
        })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

/// First-run only — rejects if a password already exists (use
/// journal_change_password to change one that's already set).
#[tauri::command]
pub async fn journal_setup_password(
    pool: State<'_, Pool>,
    session: State<'_, JournalSession>,
    password: String,
) -> Result<(), String> {
    if password.len() < 8 {
        return Err("Password must be at least 8 characters.".to_string());
    }
    let pool = pool.inner().clone();
    let key = tokio::task::spawn_blocking(move || -> Result<crypto::Key32, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        if get_security_row(&conn)?.is_some() {
            return Err("A journal password is already set — use Change Password instead.".to_string());
        }
        let hash = crypto::hash_password(&password)?;
        let salt = crypto::generate_key_salt();
        let key = crypto::derive_key(&password, &salt)?;
        conn.execute(
            "INSERT INTO journal_security (id, password_hash, key_salt) VALUES (1, ?1, ?2)",
            params![hash, salt],
        )
        .map_err(|e| e.to_string())?;
        Ok(key)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))??;

    session::unlock(&session, key);
    Ok(())
}

#[tauri::command]
pub async fn journal_unlock(
    pool: State<'_, Pool>,
    session: State<'_, JournalSession>,
    password: String,
) -> Result<(), String> {
    let pool = pool.inner().clone();
    let key = tokio::task::spawn_blocking(move || -> Result<crypto::Key32, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let row = get_security_row(&conn)?
            .ok_or_else(|| "No journal password has been set up yet.".to_string())?;

        let wait = seconds_until(&row.locked_until);
        if wait > 0 {
            return Err(format!("Too many attempts — try again in {wait}s."));
        }

        if !crypto::verify_password(&password, &row.password_hash) {
            let attempts = row.failed_attempts + 1;
            let backoff = backoff_seconds(attempts);
            let locked_until_sql = if backoff > 0 {
                format!("datetime('now', '+{backoff} seconds')")
            } else {
                "NULL".to_string()
            };
            conn.execute(
                &format!(
                    "UPDATE journal_security SET failed_attempts = ?1, locked_until = {locked_until_sql}, \
                     updated_at = datetime('now') WHERE id = 1"
                ),
                params![attempts],
            )
            .map_err(|e| e.to_string())?;
            return Err("Incorrect password.".to_string());
        }

        conn.execute(
            "UPDATE journal_security SET failed_attempts = 0, locked_until = NULL, \
             updated_at = datetime('now') WHERE id = 1",
            [],
        )
        .map_err(|e| e.to_string())?;

        crypto::derive_key(&password, &row.key_salt)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))??;

    session::unlock(&session, key);
    Ok(())
}

#[tauri::command]
pub fn journal_lock(session: State<JournalSession>) -> Result<(), String> {
    session::lock(&session);
    Ok(())
}

#[tauri::command]
pub async fn journal_set_auto_lock(pool: State<'_, Pool>, minutes: i64) -> Result<(), String> {
    if ![0, 5, 15, 30].contains(&minutes) {
        return Err("Auto-lock must be 0 (Never), 5, 15, or 30 minutes.".to_string());
    }
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE journal_security SET auto_lock_minutes = ?1, updated_at = datetime('now') WHERE id = 1",
            params![minutes],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

/// Re-derives the key from `current_password` (also serving as
/// verification — a wrong current password simply derives the wrong key,
/// which then fails to decrypt the first entry it's tried against) and
/// re-encrypts every existing entry's title/note/video with a freshly
/// derived key from `new_password` + a new salt. Necessary because the
/// encryption key IS the password (via the KDF) — there's no separate
/// "master key" a password change could leave untouched.
#[tauri::command]
pub async fn journal_change_password(
    pool: State<'_, Pool>,
    session: State<'_, JournalSession>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    if new_password.len() < 8 {
        return Err("New password must be at least 8 characters.".to_string());
    }
    let pool = pool.inner().clone();
    let new_key = tokio::task::spawn_blocking(move || -> Result<crypto::Key32, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let row = get_security_row(&conn)?.ok_or_else(|| "No journal password set up yet.".to_string())?;
        if !crypto::verify_password(&current_password, &row.password_hash) {
            return Err("Current password is incorrect.".to_string());
        }
        let old_key = crypto::derive_key(&current_password, &row.key_salt)?;

        let new_hash = crypto::hash_password(&new_password)?;
        let new_salt = crypto::generate_key_salt();
        let new_key = crypto::derive_key(&new_password, &new_salt)?;

        let mut stmt = conn
            .prepare("SELECT id, title_encrypted, note_encrypted, video_file FROM journal_entries")
            .map_err(|e| e.to_string())?;
        let entries: Vec<(i64, Option<String>, Option<String>, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        for (id, title_enc, note_enc, video_file) in entries {
            let new_title = title_enc
                .map(|t| crypto::decrypt_text(&old_key, &t).and_then(|p| crypto::encrypt_text(&new_key, &p)))
                .transpose()?;
            let new_note = note_enc
                .map(|n| crypto::decrypt_text(&old_key, &n).and_then(|p| crypto::encrypt_text(&new_key, &p)))
                .transpose()?;
            let video_bytes = storage::read_encrypted(&video_file)?;
            let plain_video = crypto::decrypt(&old_key, &video_bytes)?;
            let re_encrypted = crypto::encrypt(&new_key, &plain_video)?;
            storage::write_encrypted(&video_file, &re_encrypted)?;

            conn.execute(
                "UPDATE journal_entries SET title_encrypted = ?1, note_encrypted = ?2, \
                 updated_at = datetime('now') WHERE id = ?3",
                params![new_title, new_note, id],
            )
            .map_err(|e| e.to_string())?;
        }

        conn.execute(
            "UPDATE journal_security SET password_hash = ?1, key_salt = ?2, updated_at = datetime('now') WHERE id = 1",
            params![new_hash, new_salt],
        )
        .map_err(|e| e.to_string())?;

        Ok(new_key)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))??;

    session::unlock(&session, new_key);
    Ok(())
}

fn active_key(conn: &rusqlite::Connection, session: &JournalSession) -> Result<crypto::Key32, String> {
    let auto_lock_minutes: i64 = conn
        .query_row("SELECT auto_lock_minutes FROM journal_security WHERE id = 1", [], |r| r.get(0))
        .unwrap_or(15);
    session::get_active_key(session, auto_lock_minutes)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntrySummary {
    pub id: i64,
    pub entry_date: String,
    pub title: Option<String>,
    pub duration_seconds: i64,
    pub file_size_bytes: i64,
    pub created_at: String,
}

#[tauri::command]
pub async fn journal_list_entries(pool: State<'_, Pool>, session: State<'_, JournalSession>) -> Result<Vec<JournalEntrySummary>, String> {
    let pool = pool.inner().clone();
    let key = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        active_key(&conn, &session)?
    };
    tokio::task::spawn_blocking(move || -> Result<Vec<JournalEntrySummary>, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, entry_date, title_encrypted, duration_seconds, file_size_bytes, created_at \
                 FROM journal_entries ORDER BY entry_date DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, String, Option<String>, i64, i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();

        rows.into_iter()
            .map(|(id, entry_date, title_enc, duration_seconds, file_size_bytes, created_at)| {
                let title = title_enc.map(|t| crypto::decrypt_text(&key, &t)).transpose()?;
                Ok(JournalEntrySummary { id, entry_date, title, duration_seconds, file_size_bytes, created_at })
            })
            .collect()
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntryDetail {
    pub id: i64,
    pub entry_date: String,
    pub title: Option<String>,
    pub note: Option<String>,
    pub duration_seconds: i64,
    /// Base64 of the *decrypted* video bytes — see commands/journal.rs's
    /// module doc on why this crosses the IPC boundary as base64 rather
    /// than a file path (no tauri-plugin-fs scope covers a decrypted
    /// temp file, and writing one to disk even briefly, unencrypted,
    /// defeats the point of encrypting it at rest in the first place).
    pub video_base64: String,
    /// What the browser's MediaRecorder actually produced when this entry
    /// was recorded (e.g. "video/webm;codecs=vp8,opus" on Chromium-based
    /// platforms, "video/mp4" on WebKit/Safari before 18.4) — the
    /// frontend needs this exact value to tag the playback Blob
    /// correctly; a browser picks its decoder from the Blob's `type`,
    /// not the file extension, so a wrong/assumed value here is exactly
    /// what made recordings unplayable before this field existed
    /// (migration 0025).
    pub video_mime_type: String,
}

#[tauri::command]
pub async fn journal_get_entry(pool: State<'_, Pool>, session: State<'_, JournalSession>, id: i64) -> Result<JournalEntryDetail, String> {
    let pool = pool.inner().clone();
    let key = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        active_key(&conn, &session)?
    };
    tokio::task::spawn_blocking(move || -> Result<JournalEntryDetail, String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let (entry_date, title_enc, note_enc, duration_seconds, video_file, video_mime_type): (
            String,
            Option<String>,
            Option<String>,
            i64,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT entry_date, title_encrypted, note_encrypted, duration_seconds, video_file, video_mime_type \
                 FROM journal_entries WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .map_err(|e| e.to_string())?;

        let title = title_enc.map(|t| crypto::decrypt_text(&key, &t)).transpose()?;
        let note = note_enc.map(|n| crypto::decrypt_text(&key, &n)).transpose()?;
        let encrypted_video = storage::read_encrypted(&video_file)?;
        let plain_video = crypto::decrypt(&key, &encrypted_video)?;
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let video_base64 = STANDARD.encode(plain_video);

        Ok(JournalEntryDetail { id, entry_date, title, note, duration_seconds, video_base64, video_mime_type })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn journal_save_entry(
    pool: State<'_, Pool>,
    session: State<'_, JournalSession>,
    entry_date: String,
    title: Option<String>,
    note: Option<String>,
    video_base64: String,
    video_mime_type: String,
    duration_seconds: i64,
) -> Result<JournalEntrySummary, String> {
    let pool = pool.inner().clone();
    let key = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        active_key(&conn, &session)?
    };
    tokio::task::spawn_blocking(move || -> Result<JournalEntrySummary, String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let plain_video = STANDARD.decode(&video_base64).map_err(|e| format!("Invalid video data: {e}"))?;
        let encrypted_video = crypto::encrypt(&key, &plain_video)?;

        let filename = storage::new_filename();
        storage::write_encrypted(&filename, &encrypted_video)?;

        let title_enc = title.as_deref().map(|t| crypto::encrypt_text(&key, t)).transpose()?;
        let note_enc = note.as_deref().map(|n| crypto::encrypt_text(&key, n)).transpose()?;
        let file_size_bytes = encrypted_video.len() as i64;

        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO journal_entries \
             (entry_date, title_encrypted, note_encrypted, video_file, duration_seconds, file_size_bytes, video_mime_type) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![entry_date, title_enc, note_enc, filename, duration_seconds, file_size_bytes, video_mime_type],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        let created_at: String = conn
            .query_row("SELECT created_at FROM journal_entries WHERE id = ?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;

        Ok(JournalEntrySummary { id, entry_date, title, duration_seconds, file_size_bytes, created_at })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn journal_update_entry_meta(
    pool: State<'_, Pool>,
    session: State<'_, JournalSession>,
    id: i64,
    title: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let pool = pool.inner().clone();
    let key = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        active_key(&conn, &session)?
    };
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let title_enc = title.as_deref().map(|t| crypto::encrypt_text(&key, t)).transpose()?;
        let note_enc = note.as_deref().map(|n| crypto::encrypt_text(&key, n)).transpose()?;
        let conn = pool.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE journal_entries SET title_encrypted = ?1, note_encrypted = ?2, \
             updated_at = datetime('now') WHERE id = ?3",
            params![title_enc, note_enc, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn journal_delete_entry(pool: State<'_, Pool>, session: State<'_, JournalSession>, id: i64) -> Result<(), String> {
    // Deleting doesn't need to decrypt anything, but it should still only
    // be possible while unlocked — same reasoning as every other journal
    // command, so a locked journal can't be tampered with via a leftover
    // unlocked-looking UI state.
    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        active_key(&conn, &session)?;
    }
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let video_file: Option<String> = conn
            .query_row("SELECT video_file FROM journal_entries WHERE id = ?1", params![id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(file) = video_file {
            storage::delete(&file)?;
        }
        conn.execute("DELETE FROM journal_entries WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

/// Wipes every entry and its video file, AND the password/security row
/// itself — a full reset back to "never set up," not just "no entries."
/// Confirmation happens in the UI (this command does exactly what it's
/// asked, no extra prompt at this layer, matching how every other
/// destructive command in this codebase works).
#[tauri::command]
pub async fn journal_delete_all(pool: State<'_, Pool>, session: State<'_, JournalSession>) -> Result<(), String> {
    {
        let conn = pool.get().map_err(|e| e.to_string())?;
        active_key(&conn, &session)?;
    }
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT video_file FROM journal_entries").map_err(|e| e.to_string())?;
        let files: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        for file in files {
            storage::delete(&file)?;
        }
        conn.execute("DELETE FROM journal_entries", []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM journal_security", []).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    // Two layers: the outer `?` is the task failing to run, the inner one is
    // the closure's own Result. The inner one used to be dropped (rustc's
    // unused-`Result` warning), so a failed file/DB delete was reported to the
    // person as success while the journal was still there.
    .map_err(|e| format!("Internal error: {e}"))??;
    session::lock(&session);
    Ok(())
}

#[tauri::command]
pub async fn journal_storage_usage(pool: State<'_, Pool>) -> Result<i64, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<i64, String> {
        let _ = pool; // usage is read straight from disk, not the DB — see storage::total_bytes_on_disk
        Ok(storage::total_bytes_on_disk() as i64)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}
