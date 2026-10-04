//! Spotify integration (Phase 14 Item 6, future_enhancement.md §5).
//!
//! Kept deliberately self-contained — everything Spotify-specific lives
//! under this module, with a narrow, stable surface exposed to
//! commands/spotify.rs (get_valid_access_token, the client:: request
//! functions, token_store::is_connected/clear). If Spotify's API or
//! policies change, the blast radius is this folder, not the rest of the
//! app (future_enhancement.md §5: "Keep the integration modular").
//!
//! Nothing in here ever touches the AI layer — no Spotify data (tracks,
//! playlists, profile info) is passed to ai::router or any AiProvider
//! anywhere in this module or its callers (§5: "Do not send Spotify data
//! to AI providers unless a future feature explicitly opts in" — no such
//! feature exists yet).

pub mod client;
pub mod oauth;
pub mod pkce;
pub mod token_store;

/// Fixed loopback redirect — Spotify matches registered redirect URIs
/// byte-for-byte, so whatever Spotify app the user registers at
/// developer.spotify.com must list exactly this URI.
pub const REDIRECT_URI: &str = "http://127.0.0.1:8898/callback";
pub const REDIRECT_PORT: u16 = 8898;

/// future_enhancement.md §5's "Initial capabilities": library/playlists/
/// saved tracks plus playback control. `user-read-email` isn't requested
/// — nothing in this app displays or needs the user's email address, just
/// enough profile info (display name) to show "Connected as ___".
pub const SCOPES: &str = "user-read-private user-library-read playlist-read-private \
    playlist-read-collaborative user-read-playback-state user-modify-playback-state \
    user-read-currently-playing";
