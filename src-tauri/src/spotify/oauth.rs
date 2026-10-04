//! Spotify OAuth — Authorization Code + PKCE with a loopback redirect.
//!
//! Flow: open the Spotify consent screen in the user's default browser
//! (tauri-plugin-opener), catch the redirect on a temporary
//! http://127.0.0.1:<port>/callback listener (tiny_http — see the module
//! doc on why not a full web framework), verify the CSRF `state` value,
//! and exchange the authorization code + PKCE verifier for tokens. The
//! browser handles the actual Spotify login/password entry — this app
//! never sees the password, only ever the resulting tokens
//! (future_enhancement.md §5: "Never request/store the Spotify password").
//!
//! Each user brings their own Spotify app Client ID (Settings > Spotify),
//! the same "you bring your own API key" pattern already used for
//! Gemini/OpenRouter — there's no client_secret to protect here at all,
//! since PKCE was specifically designed for public clients (desktop/
//! mobile apps) that can't keep a secret confidential in a distributed
//! binary.

use super::token_store::{self, StoredTokens};
use super::{pkce, REDIRECT_PORT, REDIRECT_URI, SCOPES};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
/// How long to wait on the loopback listener for the redirect before
/// giving up — generous enough for someone who has to actually log in
/// (not just click "Allow"), short enough not to leave a stray thread
/// listening on a local port indefinitely if they close the browser tab.
const AUTH_TIMEOUT: Duration = Duration::from_secs(180);

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Runs the full connect flow end to end (blocking — callers wrap this in
/// `tokio::task::spawn_blocking`, same as every other blocking-I/O
/// command in this codebase per commands/ai.rs's module doc). Returns the
/// stored tokens on success.
pub fn connect(client_id: &str) -> Result<StoredTokens, String> {
    if client_id.trim().is_empty() {
        return Err(
            "Enter your Spotify app's Client ID first (Settings > Spotify — you get this from \
             your own app at developer.spotify.com/dashboard)."
                .to_string(),
        );
    }
    let client_id = client_id.trim();

    let verifier = pkce::generate_verifier();
    let challenge = pkce::challenge_for(&verifier);
    let state = pkce::generate_state();

    let listener = tiny_http::Server::http(format!("127.0.0.1:{REDIRECT_PORT}"))
        .map_err(|e| format!("Couldn't start the local sign-in listener on port {REDIRECT_PORT}: {e}"))?;

    let auth_url = format!(
        "{AUTHORIZE_URL}?client_id={cid}&response_type=code&redirect_uri={redir}&\
         code_challenge_method=S256&code_challenge={challenge}&scope={scope}&state={state}",
        cid = url_encode(client_id),
        redir = url_encode(REDIRECT_URI),
        challenge = url_encode(&challenge),
        scope = url_encode(SCOPES),
        state = url_encode(&state),
    );

    tauri_plugin_opener::open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Couldn't open your browser for Spotify sign-in: {e}"))?;

    let (code, returned_state) = wait_for_redirect(&listener)?;
    if returned_state != state {
        return Err(
            "Spotify sign-in didn't complete safely (state mismatch) — please try connecting again."
                .to_string(),
        );
    }

    exchange_code(client_id, &code, &verifier)
}

/// Blocks until the loopback listener receives the OAuth redirect (or
/// AUTH_TIMEOUT elapses), parses `code` and `state` out of the request's
/// query string, and responds to the browser with a plain "you can close
/// this tab" page.
fn wait_for_redirect(listener: &tiny_http::Server) -> Result<(String, String), String> {
    let deadline = Instant::now() + AUTH_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(
                "Spotify sign-in timed out — nothing came back within 3 minutes. Please try again."
                    .to_string(),
            );
        }
        let request = match listener.recv_timeout(remaining) {
            Ok(Some(r)) => r,
            Ok(None) => continue, // timed out this iteration, loop will hit the deadline check
            Err(e) => return Err(format!("Local sign-in listener error: {e}")),
        };

        let url = request.url().to_string();
        let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
        let params = parse_query(query);

        let body = if params.contains_key("code") {
            "<html><body style=\"font-family: sans-serif; padding: 2rem;\">\
             Spotify connected — you can close this tab and go back to Student Command Center.\
             </body></html>"
        } else {
            "<html><body style=\"font-family: sans-serif; padding: 2rem;\">\
             Spotify sign-in was cancelled or failed — you can close this tab.\
             </body></html>"
        };
        let response = tiny_http::Response::from_string(body)
            .with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap());
        let _ = request.respond(response);

        return match (params.get("code"), params.get("state")) {
            (Some(code), Some(state)) => Ok((code.clone(), state.clone())),
            _ => {
                let err = params.get("error").cloned().unwrap_or_else(|| "unknown error".to_string());
                Err(format!("Spotify sign-in didn't complete: {err}"))
            }
        };
    }
}

fn parse_query(query: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(url_decode(k), url_decode(v));
        }
    }
    map
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn exchange_code(client_id: &str, code: &str, verifier: &str) -> Result<StoredTokens, String> {
    let http = reqwest::blocking::Client::new();
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|e| format!("Couldn't reach Spotify to finish sign-in: {e}"))?;

    parse_token_response(resp)
}

/// Refreshes an expired/near-expired access token using the stored
/// refresh token. Spotify may or may not return a new refresh token in
/// the response (it rotates them sometimes, not always) — keep the old
/// one if a new one wasn't included, per Spotify's own documented
/// behavior, rather than assuming absence means the old one is invalid.
pub fn refresh(client_id: &str, current: &StoredTokens) -> Result<StoredTokens, String> {
    let http = reqwest::blocking::Client::new();
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", current.refresh_token.as_str()),
        ])
        .send()
        .map_err(|e| format!("Couldn't reach Spotify to refresh your session: {e}"))?;

    let mut refreshed = parse_token_response(resp)?;
    if refreshed.refresh_token.is_empty() {
        refreshed.refresh_token = current.refresh_token.clone();
    }
    Ok(refreshed)
}

fn parse_token_response(resp: reqwest::blocking::Response) -> Result<StoredTokens, String> {
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Spotify rejected the sign-in request: {text}"));
    }
    #[derive(serde::Deserialize)]
    struct TokenResponse {
        access_token: String,
        #[serde(default)]
        refresh_token: String,
        expires_in: i64,
        #[serde(default)]
        scope: String,
    }
    let parsed: TokenResponse =
        serde_json::from_str(&text).map_err(|e| format!("Unexpected response from Spotify: {e}"))?;

    Ok(StoredTokens {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        // Refresh 60s before actual expiry — a comfortable margin so a
        // token doesn't expire mid-request due to clock/network latency.
        expires_at: now_unix() + parsed.expires_in - 60,
        scope: parsed.scope,
    })
}

/// The one thing every Spotify API call needs: a definitely-valid access
/// token, refreshing first if the stored one has expired (or is about to).
/// Returns an error (rather than `None`) when nothing is connected at
/// all, since every caller needs to surface that to the user either way.
pub fn get_valid_access_token(client_id: &str) -> Result<String, String> {
    let stored = token_store::get()
        .ok_or_else(|| "Spotify isn't connected — connect it in Settings first.".to_string())?;

    if now_unix() < stored.expires_at {
        return Ok(stored.access_token);
    }

    let refreshed = refresh(client_id, &stored)?;
    token_store::set(&refreshed)?;
    Ok(refreshed.access_token)
}
