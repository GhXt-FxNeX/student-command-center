//! Thin Spotify Web API client. Every function here does exactly one
//! thing: build a request with a bearer token, send it, parse the JSON
//! it's given. No caching, no retry logic, no business rules — those
//! belong in commands/spotify.rs, which is what future_enhancement.md
//! §5's "modular" requirement is really asking for: if Spotify changes a
//! response shape or endpoint, the fix is isolated to one function here.

use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.spotify.com/v1";

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::new()
}

fn get_json<T: for<'de> Deserialize<'de>>(url: &str, access_token: &str) -> Result<T, String> {
    let resp = client()
        .get(url)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("Couldn't reach Spotify: {e}"))?;
    handle_response(resp)
}

fn handle_response<T: for<'de> Deserialize<'de>>(resp: reqwest::blocking::Response) -> Result<T, String> {
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(describe_error(status.as_u16(), &text));
    }
    serde_json::from_str(&text).map_err(|e| format!("Unexpected response from Spotify: {e}"))
}

fn describe_error(status: u16, body: &str) -> String {
    match status {
        401 => "Spotify session expired — try disconnecting and reconnecting.".to_string(),
        403 => "Spotify says this account/app doesn't have permission for that \
                (some actions require Spotify Premium)."
            .to_string(),
        404 => "No active Spotify device found — open Spotify on a device first, then try again.".to_string(),
        429 => "Spotify is rate-limiting requests right now — try again in a moment.".to_string(),
        _ => format!("Spotify returned an error ({status}): {body}"),
    }
}

// ---- Profile ----

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyProfile {
    pub id: String,
    pub display_name: Option<String>,
}

pub fn get_profile(access_token: &str) -> Result<SpotifyProfile, String> {
    get_json(&format!("{API_BASE}/me"), access_token)
}

// ---- Library: playlists, saved tracks, saved albums ----

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyImage {
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyPlaylist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<SpotifyImage>,
    // Spotify's February 2026 Web API migration renamed this field from
    // "tracks" to "items" (same shape, just a new key — see
    // developer.spotify.com's migration guide). `alias` accepts either
    // name during deserialization, so this keeps working whether Spotify
    // sends the old or new key for a given account/app. `default` on top
    // of that means a playlist object missing this entirely (rather than
    // just renamed) still deserializes instead of hard-failing — the
    // track count just shows as 0 in that case, which is a much better
    // failure mode than the whole playlist list erroring out.
    #[serde(alias = "items", default)]
    pub tracks: SpotifyPlaylistTrackCount,
    // Not every object Spotify returns is guaranteed to include this —
    // three separate "missing field" reports in a row (external_urls
    // twice, then publisher) is a strong signal that Spotify's response
    // shape for secondary/descriptive fields is looser than assumed
    // throughout this file, not just for this one struct. Optional
    // fields tolerate a missing key automatically in serde (no
    // `#[serde(default)]` needed for Option<T> specifically); the
    // frontend already treats a missing external link as "don't show the
    // ↗ icon," so this degrades gracefully rather than erroring.
    #[serde(default)]
    pub external_urls: Option<SpotifyExternalUrls>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SpotifyPlaylistTrackCount {
    #[serde(default)]
    pub total: i64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyExternalUrls {
    pub spotify: String,
}

#[derive(Deserialize)]
struct Paged<T> {
    items: Vec<T>,
}

pub fn get_playlists(access_token: &str) -> Result<Vec<SpotifyPlaylist>, String> {
    let paged: Paged<SpotifyPlaylist> =
        get_json(&format!("{API_BASE}/me/playlists?limit=50"), access_token)?;
    Ok(paged.items)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyArtist {
    pub name: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyAlbum {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<SpotifyImage>,
    #[serde(default)]
    pub artists: Vec<SpotifyArtist>,
    #[serde(default)]
    pub external_urls: Option<SpotifyExternalUrls>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyTrack {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub artists: Vec<SpotifyArtist>,
    pub album: SpotifyAlbum,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub external_urls: Option<SpotifyExternalUrls>,
}

#[derive(Deserialize)]
struct SavedTrackItem {
    track: SpotifyTrack,
}
pub fn get_saved_tracks(access_token: &str) -> Result<Vec<SpotifyTrack>, String> {
    let paged: Paged<SavedTrackItem> =
        get_json(&format!("{API_BASE}/me/tracks?limit=50"), access_token)?;
    Ok(paged.items.into_iter().map(|i| i.track).collect())
}

#[derive(Deserialize)]
struct SavedAlbumItem {
    album: SpotifyAlbum,
}
pub fn get_saved_albums(access_token: &str) -> Result<Vec<SpotifyAlbum>, String> {
    let paged: Paged<SavedAlbumItem> =
        get_json(&format!("{API_BASE}/me/albums?limit=50"), access_token)?;
    Ok(paged.items.into_iter().map(|i| i.album).collect())
}

// ---- Podcasts (saved shows) ----

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyShow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<SpotifyImage>,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub total_episodes: i64,
    #[serde(default)]
    pub external_urls: Option<SpotifyExternalUrls>,
}

#[derive(Deserialize)]
struct SavedShowItem {
    show: SpotifyShow,
}
pub fn get_saved_shows(access_token: &str) -> Result<Vec<SpotifyShow>, String> {
    let paged: Paged<SavedShowItem> =
        get_json(&format!("{API_BASE}/me/shows?limit=50"), access_token)?;
    Ok(paged.items.into_iter().map(|i| i.show).collect())
}

// ---- Playback ----

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyPlaybackState {
    pub is_playing: bool,
    pub item: Option<SpotifyTrack>,
    pub device: Option<SpotifyDevice>,
    pub progress_ms: Option<i64>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SpotifyDevice {
    pub name: String,
    pub volume_percent: Option<i64>,
}

/// `Ok(None)` means "nothing is currently playing anywhere" (Spotify
/// returns an empty 204 body for that case) — a normal, common state, not
/// an error.
pub fn get_playback_state(access_token: &str) -> Result<Option<SpotifyPlaybackState>, String> {
    let resp = client()
        .get(format!("{API_BASE}/me/player"))
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("Couldn't reach Spotify: {e}"))?;
    if resp.status().as_u16() == 204 {
        return Ok(None);
    }
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(describe_error(status.as_u16(), &text));
    }
    if text.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("Unexpected response from Spotify: {e}"))
}

fn put_player(access_token: &str, path: &str, body: Option<&serde_json::Value>) -> Result<(), String> {
    let req = client().put(format!("{API_BASE}/me/player{path}")).bearer_auth(access_token);
    // Spotify's player endpoints require a Content-Length header even for
    // a body-less play/pause — reqwest's blocking client doesn't send one
    // when no body is set at all (as opposed to an explicitly empty
    // body), which is exactly what produced the reported 411 Length
    // Required. An explicit empty body has a known length, so reqwest
    // sets Content-Length: 0 for it automatically.
    let req = match body {
        Some(b) => req.json(b),
        None => req.body(""),
    };
    let resp = req.send().map_err(|e| format!("Couldn't reach Spotify: {e}"))?;
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let text = resp.text().unwrap_or_default();
    Err(describe_error(status.as_u16(), &text))
}

fn post_player(access_token: &str, path: &str) -> Result<(), String> {
    let resp = client()
        .post(format!("{API_BASE}/me/player{path}"))
        .bearer_auth(access_token)
        .body("") // same Content-Length fix as put_player
        .send()
        .map_err(|e| format!("Couldn't reach Spotify: {e}"))?;
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let text = resp.text().unwrap_or_default();
    Err(describe_error(status.as_u16(), &text))
}

/// Resumes whatever was last playing (no specific track/context) — the
/// now-playing bar's plain Play button.
pub fn play(access_token: &str) -> Result<(), String> {
    put_player(access_token, "/play", None)
}

/// Starts playing a specific track (or list of tracks) — clicking a saved
/// track. Requires an already-active Spotify Connect device (phone,
/// desktop app, speaker, etc.) somewhere; this *controls* that device
/// rather than producing audio inside this app itself. Spotify's Web API
/// has no way to hand a third-party app raw playable audio — actually
/// streaming inside this app would need their separate Web Playback SDK,
/// which creates a DRM-backed virtual device inside a web page and needs
/// browser EME support Tauri's WebKit-based webview may not reliably
/// have. This is the same approach every third-party Spotify controller
/// app uses.
pub fn play_track_uris(access_token: &str, uris: Vec<String>) -> Result<(), String> {
    put_player(access_token, "/play", Some(&serde_json::json!({ "uris": uris })))
}

/// Starts playing a playlist or album by its context URI (e.g.
/// "spotify:playlist:...", "spotify:album:...") — clicking a playlist or
/// album card. Same device requirement as play_track_uris.
pub fn play_context(access_token: &str, context_uri: &str) -> Result<(), String> {
    put_player(access_token, "/play", Some(&serde_json::json!({ "context_uri": context_uri })))
}

pub fn pause(access_token: &str) -> Result<(), String> {
    put_player(access_token, "/pause", None)
}
pub fn next_track(access_token: &str) -> Result<(), String> {
    post_player(access_token, "/next")
}
pub fn previous_track(access_token: &str) -> Result<(), String> {
    post_player(access_token, "/previous")
}
pub fn set_volume(access_token: &str, percent: i64) -> Result<(), String> {
    let percent = percent.clamp(0, 100);
    put_player(
        access_token,
        &format!("/volume?volume_percent={percent}"),
        None,
    )
}
