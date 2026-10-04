//! Tauri commands for Spotify: connect/disconnect, connection status,
//! library browsing, playback control.
//!
//! Same async fn + tokio::task::spawn_blocking pattern commands/ai.rs's
//! module doc explains in full — every command here does blocking network
//! I/O (reqwest::blocking) and/or blocking keychain I/O, neither of which
//! belongs on Tauri's main thread.

use crate::commands::settings::get_settings_from_pool;
use crate::db::Pool;
use crate::spotify::{client, oauth, token_store};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub connected: bool,
    pub display_name: Option<String>,
}

#[tauri::command]
pub async fn spotify_get_status(pool: State<'_, Pool>) -> Result<SpotifyStatus, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<SpotifyStatus, String> {
        if !token_store::is_connected() {
            return Ok(SpotifyStatus { connected: false, display_name: None });
        }
        let settings = get_settings_from_pool(&pool)?;
        // A stored token existing is enough to report "connected" even if
        // this profile fetch fails (e.g. transient network issue) — don't
        // make a flaky /me call the difference between "connected" and
        // "not connected" in the UI.
        let display_name = oauth::get_valid_access_token(&settings.spotify_client_id)
            .ok()
            .and_then(|token| client::get_profile(&token).ok())
            .and_then(|p| p.display_name);
        Ok(SpotifyStatus { connected: true, display_name })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn spotify_connect(pool: State<'_, Pool>) -> Result<SpotifyStatus, String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<SpotifyStatus, String> {
        let settings = get_settings_from_pool(&pool)?;
        let tokens = oauth::connect(&settings.spotify_client_id)?;
        token_store::set(&tokens)?;
        let display_name = client::get_profile(&tokens.access_token).ok().and_then(|p| p.display_name);
        Ok(SpotifyStatus { connected: true, display_name })
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn spotify_disconnect() -> Result<(), String> {
    tokio::task::spawn_blocking(token_store::clear)
        .await
        .map_err(|e| format!("Internal error: {e}"))?
}

/// Every library/playback command below shares this exact shape: get a
/// valid access token (refreshing if needed), call one client:: function.
/// A tiny macro would save a few lines per command but make the
/// async/spawn_blocking wrapping (the part actually worth getting right)
/// harder to see at each call site, so this stays written out longhand —
/// consistent with how commands/ai.rs already prioritizes that tradeoff.
macro_rules! spotify_command {
    ($name:ident, $ret:ty, $body:expr) => {
        #[tauri::command]
        pub async fn $name(pool: State<'_, Pool>) -> Result<$ret, String> {
            let pool = pool.inner().clone();
            tokio::task::spawn_blocking(move || -> Result<$ret, String> {
                let settings = get_settings_from_pool(&pool)?;
                let token = oauth::get_valid_access_token(&settings.spotify_client_id)?;
                ($body)(token)
            })
            .await
            .map_err(|e| format!("Internal error: {e}"))?
        }
    };
}

spotify_command!(spotify_get_playlists, Vec<client::SpotifyPlaylist>, |t: String| client::get_playlists(&t));
spotify_command!(spotify_get_saved_tracks, Vec<client::SpotifyTrack>, |t: String| client::get_saved_tracks(&t));
spotify_command!(spotify_get_saved_albums, Vec<client::SpotifyAlbum>, |t: String| client::get_saved_albums(&t));
spotify_command!(spotify_get_saved_shows, Vec<client::SpotifyShow>, |t: String| client::get_saved_shows(&t));
spotify_command!(
    spotify_get_playback_state,
    Option<client::SpotifyPlaybackState>,
    |t: String| client::get_playback_state(&t)
);
spotify_command!(spotify_play, (), |t: String| client::play(&t));
spotify_command!(spotify_pause, (), |t: String| client::pause(&t));

#[tauri::command]
pub async fn spotify_play_track(pool: State<'_, Pool>, uri: String) -> Result<(), String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let settings = get_settings_from_pool(&pool)?;
        let token = oauth::get_valid_access_token(&settings.spotify_client_id)?;
        client::play_track_uris(&token, vec![uri])
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}

#[tauri::command]
pub async fn spotify_play_context(pool: State<'_, Pool>, context_uri: String) -> Result<(), String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let settings = get_settings_from_pool(&pool)?;
        let token = oauth::get_valid_access_token(&settings.spotify_client_id)?;
        client::play_context(&token, &context_uri)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}
spotify_command!(spotify_next_track, (), |t: String| client::next_track(&t));
spotify_command!(spotify_previous_track, (), |t: String| client::previous_track(&t));

#[tauri::command]
pub async fn spotify_set_volume(pool: State<'_, Pool>, percent: i64) -> Result<(), String> {
    let pool = pool.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let settings = get_settings_from_pool(&pool)?;
        let token = oauth::get_valid_access_token(&settings.spotify_client_id)?;
        client::set_volume(&token, percent)
    })
    .await
    .map_err(|e| format!("Internal error: {e}"))?
}
