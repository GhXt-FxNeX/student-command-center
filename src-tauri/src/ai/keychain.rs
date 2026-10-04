//! Secure API key storage via the OS keychain (macOS Keychain / Windows
//! Credential Manager / Linux Secret Service), using the `keyring` crate.
//!
//! API keys are NEVER written to SQLite, logged, or sent to the frontend
//! in raw form (architecture.md §8 Security & Privacy). Only Gemini and
//! OpenRouter need a key here — Local (Ollama) has no key concept.

use keyring::Entry;

const SERVICE: &str = "student-command-center";

/// Extra guidance appended to keychain errors. Empty on macOS and Windows, where the OS
/// keychain is always present. On Linux the store is the Secret Service (GNOME Keyring,
/// KWallet, KeePassXC…), which minimal window managers and headless sessions don't run —
/// without one, saving a key fails and this is what tells the person what to do.
pub fn platform_hint() -> &'static str {
    if cfg!(target_os = "linux") {
        " On Linux this needs a Secret Service provider (such as GNOME Keyring or KWallet) that is running and unlocked — install one, sign in again, and retry."
    } else {
        ""
    }
}

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| format!("Keychain error: {e}.{}", platform_hint()))
}

/// `None` covers both "never set" and "keychain unavailable" — callers
/// that need to distinguish those cases don't exist yet, and collapsing
/// them keeps `ProviderStatus::NotConfigured` simple to compute.
pub fn get_key(provider: &str) -> Option<String> {
    entry(provider).ok()?.get_password().ok()
}

pub fn set_key(provider: &str, value: &str) -> Result<(), String> {
    entry(provider)?
        .set_password(value)
        .map_err(|e| format!("Couldn't save the key to your OS keychain: {e}.{}", platform_hint()))
}

pub fn delete_key(provider: &str) -> Result<(), String> {
    match entry(provider)?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting a key that was never set isn't an error from the
        // caller's point of view — the end state (no key stored) is
        // already what was asked for.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Couldn't remove the key from your OS keychain: {e}.{}", platform_hint())),
    }
}

pub fn has_key(provider: &str) -> bool {
    get_key(provider).map(|k| !k.is_empty()).unwrap_or(false)
}
