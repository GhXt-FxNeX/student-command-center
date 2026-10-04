//! Minimal diagnostics for a GUI app that has no console.
//!
//! On Windows a release build is a GUI-subsystem program (see the attribute at the top
//! of main.rs), so anything printed to stderr — including a startup panic — goes
//! nowhere, and on Linux a launcher-started app has no terminal either. This module
//! gives both a place to look: `<app data folder>/logs/scc.log`, in the same
//! per-user folder as the database, so no OS-specific log path is hard-coded.
//!
//! What it records: a start-up line (version, OS, architecture, data folder) and any
//! panic (message + source location). It never records user data, API keys or tokens —
//! nothing else in the app writes to it. The file is capped (rotated to `scc.log.1`
//! at 512 KB), and there is no background thread or polling.
//!
//! A panic *before the window exists* (database can't be opened, data folder not
//! writable, a migration fails) additionally shows a native error box on Windows,
//! where otherwise the app would simply never appear. On macOS/Linux the message goes
//! to stderr (visible when launched from a terminal) and to the log file.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const LOG_FILE: &str = "scc.log";
const MAX_LOG_BYTES: u64 = 512 * 1024;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static UI_READY: AtomicBool = AtomicBool::new(false);

fn fallback_dir() -> PathBuf {
    std::env::temp_dir().join("student-command-center-logs")
}

fn log_dir() -> PathBuf {
    LOG_DIR.get().cloned().unwrap_or_else(fallback_dir)
}

#[cfg(windows)]
fn log_path() -> PathBuf {
    log_dir().join(LOG_FILE)
}

/// Call first thing in `main`. Resolves the log folder and installs the panic hook.
pub fn init() {
    // Resolve BEFORE installing the hook: if the data folder itself can't be created,
    // that panic is reported by the default hook only (stderr), and the log falls back
    // to the OS temp folder instead of failing again inside the hook. The real failure
    // is then reported (once, with a dialog on Windows) when the database opens.
    let dir = std::panic::catch_unwind(|| crate::db::app_data_dir().join("logs")).unwrap_or_else(|_| fallback_dir());
    let _ = LOG_DIR.set(dir);

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let text = payload
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown error".to_string());
        let message = match info.location() {
            Some(l) => format!("{text} (at {}:{})", l.file(), l.line()),
            None => text.clone(),
        };
        write_line("PANIC", &message);
        if !UI_READY.load(Ordering::Relaxed) {
            show_fatal_error(&text);
        }
        default_hook(info);
    }));
}

/// Call once the Tauri setup hook runs: from here on a panic is a runtime fault, not a
/// failure to start, so no start-up error box is shown for it.
pub fn mark_ready() {
    UI_READY.store(true, Ordering::Relaxed);
}

/// Appends one informational line (best-effort; a log failure must never break the app).
pub fn note(message: &str) {
    write_line("INFO", message);
}

fn write_line(level: &str, message: &str) {
    let dir = log_dir();
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(LOG_FILE);
    if fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        // rename replaces an existing scc.log.1 on every supported OS
        let _ = fs::rename(&path, dir.join(format!("{LOG_FILE}.1")));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {level} {message}", utc_stamp(SystemTime::now()));
    }
}

/// "2026-10-04T14:05:09Z" without a date crate (Howard Hinnant's civil-from-days).
fn utc_stamp(t: SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

#[cfg(windows)]
fn show_fatal_error(message: &str) {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }
    const MB_ICONERROR: u32 = 0x10;

    let wide = |s: &str| -> Vec<u16> { std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect() };
    let text = wide(&format!(
        "Student Command Center couldn't start.\n\n{message}\n\nDetails were saved to:\n{}",
        log_path().display()
    ));
    let caption = wide("Student Command Center");
    // SAFETY: both buffers are NUL-terminated UTF-16 that outlive the call; a null owner
    // window is allowed.
    unsafe {
        MessageBoxW(core::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), MB_ICONERROR);
    }
}

#[cfg(not(windows))]
fn show_fatal_error(_message: &str) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn utc_stamp_matches_known_instants() {
        assert_eq!(utc_stamp(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(utc_stamp(UNIX_EPOCH + Duration::from_secs(1_700_000_000)), "2023-11-14T22:13:20Z");
        // leap day
        assert_eq!(utc_stamp(UNIX_EPOCH + Duration::from_secs(1_709_164_800)), "2024-02-29T00:00:00Z");
    }
}
