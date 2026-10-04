//! Password hashing, key derivation, and AES-256-GCM encryption for the
//! private video journal (future_enhancement.md §8's "Security" section).
//!
//! Two separate uses of the same password, deliberately kept distinct:
//! - `hash_password`/`verify_password`: an Argon2id PHC string, safe to
//!   store, used only to check "is this the right password" — this is the
//!   one and only password-derived value that ever touches disk.
//! - `derive_key`: raw AES-256 key bytes from the password + a stored
//!   salt, recomputed fresh every unlock and kept in memory only
//!   (journal/session.rs) — never persisted anywhere, not even encrypted,
//!   because that would make the journal's real security boundary "the
//!   OS's access to this app's storage" instead of "the person's memory
//!   of their password."

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::RngCore;

pub type Key32 = [u8; 32];

pub fn hash_password(password: &str) -> Result<String, String> {
    // argon2's own re-exported OsRng (not rand::rngs::OsRng) — the crate's
    // password-hash dependency may pin a different rand_core version than
    // this project's top-level `rand` dependency, and mixing the two
    // types across versions is a real compile error (hit exactly this
    // shape of bug once already with rand::thread_rng() vs a stale
    // Distribution impl — see spotify/pkce.rs). Always go through the
    // crate's own re-export for anything argon2's API expects an RNG for.
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Could not hash password: {e}"))
}

pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored_hash) else {
        return false;
    };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}

/// A fresh random salt (hex-encoded) for `derive_key` — generated once
/// when the password is first set (or changed), stored alongside the
/// password hash in `journal_security.key_salt`. Storing this salt isn't
/// a security weakness: a KDF salt's job is to prevent rainbow-table
/// reuse across different journals, not to be secret itself.
pub fn generate_key_salt() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Derives the raw AES-256 key from the password + stored salt. Same
/// password + same salt always yields the same key — that's the point:
/// the key never needs to be stored, only re-derived on every unlock.
pub fn derive_key(password: &str, key_salt_hex: &str) -> Result<Key32, String> {
    let salt_bytes = hex::decode(key_salt_hex).map_err(|e| format!("Invalid stored salt: {e}"))?;
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), &salt_bytes, &mut key)
        .map_err(|e| format!("Could not derive encryption key: {e}"))?;
    Ok(key)
}

/// Encrypts `plaintext` with AES-256-GCM. Output is `nonce || ciphertext`
/// (12-byte random nonce prepended) — self-contained, so decrypt only
/// needs the key, not a separately-tracked nonce.
pub fn encrypt(key: &Key32, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypts data produced by `encrypt` (expects the 12-byte nonce prefix).
/// A failure here (wrong key, or the data doesn't authenticate) means
/// either a wrong password derived the wrong key, or the file is
/// corrupted/tampered — AES-GCM can't distinguish those, and doesn't need
/// to for this use case.
pub fn decrypt(key: &Key32, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Encrypted data is too short to be valid.".to_string());
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| "Could not decrypt — wrong password or corrupted data.".to_string())
}

/// Encrypts a UTF-8 string (title/note) and returns it as a plain base64
/// string, the shape `journal_entries.title_encrypted`/`note_encrypted`
/// expects — SQLite has no binary-friendly TEXT affinity, so ciphertext
/// bytes go in as base64 rather than raw bytes.
pub fn encrypt_text(key: &Key32, plaintext: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    Ok(STANDARD.encode(encrypt(key, plaintext.as_bytes())?))
}

pub fn decrypt_text(key: &Key32, encoded: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let data = STANDARD.decode(encoded).map_err(|e| format!("Corrupted encrypted text: {e}"))?;
    let bytes = decrypt(key, &data)?;
    String::from_utf8(bytes).map_err(|e| format!("Decrypted text isn't valid UTF-8: {e}"))
}
