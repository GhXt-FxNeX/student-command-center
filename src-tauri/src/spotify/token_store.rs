//! Spotify token storage — reuses the exact OS-keychain pattern
//! ai/keychain.rs already established for Gemini/OpenRouter API keys
//! (architecture.md §8: secrets never touch SQLite, never get logged,
//! never reach the frontend in raw form). The access/refresh token pair
//! and the access token's expiry are stored together as one JSON blob
//! under a single keychain entry, since they're always read/written
//! together (there's no case where the app wants the refresh token
//! without also wanting to know if the access token needs refreshing).

use serde::{Deserialize, Serialize};

const SERVICE: &str = "student-command-center";
const KEYCHAIN_KEY: &str = "spotify_tokens";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds. Spotify access tokens last 1 hour; refreshed a
    /// little early (see oauth.rs's get_valid_access_token) rather than
    /// waiting for an API call to actually fail on an expired one.
    pub expires_at: i64,
    pub scope: String,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, KEYCHAIN_KEY)
        .map_err(|e| format!("Keychain error: {e}.{}", crate::ai::keychain::platform_hint()))
}

pub fn get() -> Option<StoredTokens> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn set(tokens: &StoredTokens) -> Result<(), String> {
    let raw = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&raw)
        .map_err(|e| {
            format!(
                "Couldn't save Spotify tokens to your OS keychain: {e}.{}",
                crate::ai::keychain::platform_hint()
            )
        })
}

pub fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        // Disconnecting when nothing was ever connected isn't an error —
        // the end state (no stored tokens) is already what was asked for.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Couldn't remove Spotify tokens from your OS keychain: {e}.{}",
            crate::ai::keychain::platform_hint()
        )),
    }
}

pub fn is_connected() -> bool {
    get().is_some()
}
