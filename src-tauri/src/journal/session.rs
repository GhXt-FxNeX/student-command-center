//! The journal's "unlocked" state: a derived AES key plus a last-activity
//! timestamp, held ONLY in memory via `tauri::Manager::manage` (see
//! main.rs). Nothing here is ever written to disk — that's the entire
//! design: closing the app destroys this struct along with the process,
//! which is exactly future_enhancement.md §8's "Closing the app always
//! locks the journal," with no extra code needed to make it true.

use crate::journal::crypto::Key32;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct JournalSession(pub Mutex<Option<UnlockedState>>);

pub struct UnlockedState {
    pub key: Key32,
    pub last_activity_unix: i64,
}

impl JournalSession {
    pub fn new() -> Self {
        JournalSession(Mutex::new(None))
    }
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

pub fn unlock(session: &JournalSession, key: Key32) {
    let mut guard = session.0.lock().unwrap();
    *guard = Some(UnlockedState { key, last_activity_unix: now_unix() });
}

pub fn lock(session: &JournalSession) {
    let mut guard = session.0.lock().unwrap();
    *guard = None;
}

/// The one function every journal command that touches encrypted content
/// calls first. Enforces auto-lock (per §8's configurable inactivity
/// timeout) as a backstop that doesn't depend on the frontend proactively
/// calling lock() — even if UI logic has a bug, a command can't decrypt
/// anything once the timeout has genuinely elapsed, because this clears
/// the key from memory itself rather than just reporting "you should be
/// locked."
///
/// `auto_lock_minutes` of 0 means "Never" (§8's fourth auto-lock option) —
/// skips the timeout check entirely, session only ends by explicit lock()
/// or app close.
pub fn get_active_key(session: &JournalSession, auto_lock_minutes: i64) -> Result<Key32, String> {
    let mut guard = session.0.lock().unwrap();
    let Some(state) = guard.as_mut() else {
        return Err("Journal is locked.".to_string());
    };
    if auto_lock_minutes > 0 {
        let elapsed_minutes = (now_unix() - state.last_activity_unix) / 60;
        if elapsed_minutes >= auto_lock_minutes {
            *guard = None;
            return Err("Journal auto-locked after inactivity.".to_string());
        }
    }
    state.last_activity_unix = now_unix();
    Ok(state.key)
}

pub fn is_unlocked(session: &JournalSession) -> bool {
    session.0.lock().unwrap().is_some()
}
