//! PKCE (Proof Key for Code Exchange, RFC 7636) helpers for the
//! Authorization Code + PKCE flow Spotify requires for desktop apps.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

/// 64 random bytes, base64url-encoded (no padding) — comfortably inside
/// RFC 7636's required 43-128 character range for a code_verifier.
pub fn generate_verifier() -> String {
    // rand 0.8's `Rng::gen::<[u8; N]>()` only implements `Standard` for
    // arrays up to a fixed size, well under 64 — fill_bytes has no such
    // limit, since it writes into any `&mut [u8]` regardless of length.
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// S256 challenge: base64url(SHA-256(verifier)) — the "code_challenge"
/// sent in the authorize request. Spotify hashes the verifier we send at
/// token-exchange time the same way and compares, so an intercepted
/// authorization code alone isn't enough to complete the flow.
pub fn challenge_for(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

/// Random CSRF `state` value, checked against what the redirect echoes
/// back before an authorization code is ever exchanged.
pub fn generate_state() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
