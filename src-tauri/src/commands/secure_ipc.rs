//! Secure IPC file handling for permission requests/responses
//!
//! This module provides secure file-based IPC with:
//! - App-private directory with 0700 permissions
//! - Files with 0600 permissions
//! - Atomic writes (temp file + rename)
//! - HMAC authentication to prevent spoofing
//! - Owner/permission verification before reads

use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

type HmacSha256 = Hmac<Sha256>;

/// Per-session secret for HMAC authentication
/// Generated once per session and used to sign/verify IPC messages
pub struct SessionSecret {
    secret: [u8; 32],
}

impl SessionSecret {
    /// Generate a new cryptographically secure session secret
    pub fn new() -> Self {
        let mut secret = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret);
        Self { secret }
    }

    /// Generate HMAC for a message
    pub fn sign(&self, message: &str) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC can take key of any size");
        mac.update(message.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    /// Verify HMAC for a message
    pub fn verify(&self, message: &str, signature: &str) -> bool {
        let expected = self.sign(message);
        // Constant-time comparison to prevent timing attacks
        constant_time_eq(expected.as_bytes(), signature.as_bytes())
    }
}

impl Default for SessionSecret {
    fn default() -> Self {
        Self::new()
    }
}

/// Constant-time byte comparison to prevent timing attacks
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Get the secure IPC directory path
/// Uses app data directory instead of temp to prevent access by other processes
pub fn get_secure_ipc_dir() -> Result<PathBuf, String> {
    // Use platform-specific app data directory
    let base_dir = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or("Could not find app data directory")?;

    Ok(base_dir.join("com.jasonbates.claudia").join("ipc"))
}

/// Ensure the secure IPC directory exists with proper permissions (0700)
pub fn ensure_secure_dir() -> Result<PathBuf, String> {
    let dir = get_secure_ipc_dir()?;

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create secure IPC directory: {}", e))?;
    }

    // Set directory permissions to 0700 (owner read/write/execute only)
    #[cfg(unix)]
    {
        let perms = fs::Permissions::from_mode(0o700);
        fs::set_permissions(&dir, perms)
            .map_err(|e| format!("Failed to set directory permissions: {}", e))?;
    }

    Ok(dir)
}

/// Permission request file path within secure directory
pub fn get_permission_request_path(session_id: &str) -> Result<PathBuf, String> {
    let dir = ensure_secure_dir()?;
    Ok(dir.join(format!("permission-request-{}.json", session_id)))
}

/// Permission response file path within secure directory
pub fn get_permission_response_path(session_id: &str) -> Result<PathBuf, String> {
    let dir = ensure_secure_dir()?;
    Ok(dir.join(format!("permission-response-{}.json", session_id)))
}

/// Verify file permissions and ownership before reading
/// Returns error if file doesn't have expected secure permissions
#[cfg(unix)]
pub fn verify_file_security(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    // Verify it's a regular file
    if !metadata.is_file() {
        return Err("Path is not a regular file".to_string());
    }

    // Verify owner is current user
    let file_uid = metadata.uid();
    let current_uid = unsafe { libc::getuid() };
    if file_uid != current_uid {
        return Err(format!(
            "File owner mismatch: expected {}, got {}",
            current_uid, file_uid
        ));
    }

    // Verify permissions are 0600 (no group/other access)
    let mode = metadata.permissions().mode() & 0o777;
    if mode & 0o077 != 0 {
        return Err(format!(
            "Insecure file permissions: {:o} (expected 0600)",
            mode
        ));
    }

    Ok(())
}

#[cfg(not(unix))]
pub fn verify_file_security(_path: &PathBuf) -> Result<(), String> {
    // On non-Unix platforms, skip permission verification
    // Windows has different ACL-based security model
    Ok(())
}

/// Atomically write a file with secure permissions (0600)
/// Uses temp file + rename pattern to prevent partial reads
pub fn secure_write(path: &PathBuf, content: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or("Invalid path: no parent directory")?;

    // Create temp file in same directory (required for atomic rename)
    let temp_path = dir.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        rand::random::<u32>()
    ));

    // Write to temp file
    {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temp_path)
                .map_err(|e| format!("Failed to create temp file: {}", e))?;
            file.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write temp file: {}", e))?;
            file.sync_all()
                .map_err(|e| format!("Failed to sync temp file: {}", e))?;
        }

        #[cfg(not(unix))]
        {
            let mut file = File::create(&temp_path)
                .map_err(|e| format!("Failed to create temp file: {}", e))?;
            file.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write temp file: {}", e))?;
            file.sync_all()
                .map_err(|e| format!("Failed to sync temp file: {}", e))?;
        }
    }

    // Atomic rename
    fs::rename(&temp_path, path).map_err(|e| {
        // Clean up temp file on failure
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename temp file: {}", e)
    })?;

    Ok(())
}

/// Securely read a file with permission verification
pub fn secure_read(path: &PathBuf) -> Result<String, String> {
    // Verify file security before reading
    verify_file_security(path)?;

    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write a signed IPC message (includes HMAC for authentication)
pub fn write_signed_message(
    path: &PathBuf,
    content: &serde_json::Value,
    secret: &SessionSecret,
) -> Result<(), String> {
    let content_str = serde_json::to_string(content)
        .map_err(|e| format!("Failed to serialize content: {}", e))?;

    let signature = secret.sign(&content_str);

    let signed_message = serde_json::json!({
        "content": content,
        "signature": signature
    });

    let signed_str = serde_json::to_string_pretty(&signed_message)
        .map_err(|e| format!("Failed to serialize signed message: {}", e))?;

    secure_write(path, &signed_str)
}

/// Read and verify a signed IPC message
pub fn read_signed_message(
    path: &PathBuf,
    secret: &SessionSecret,
) -> Result<serde_json::Value, String> {
    let content = secure_read(path)?;

    let signed_message: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse signed message: {}", e))?;

    let inner_content = signed_message
        .get("content")
        .ok_or("Missing content in signed message")?;

    let signature = signed_message
        .get("signature")
        .and_then(|s| s.as_str())
        .ok_or("Missing or invalid signature in signed message")?;

    // Verify HMAC
    let content_str = serde_json::to_string(inner_content)
        .map_err(|e| format!("Failed to serialize content for verification: {}", e))?;

    if !secret.verify(&content_str, signature) {
        return Err("Invalid signature - message may have been tampered with".to_string());
    }

    Ok(inner_content.clone())
}

/// Clean up IPC files for a session
pub fn cleanup_session_files(session_id: &str) -> Result<(), String> {
    if let Ok(request_path) = get_permission_request_path(session_id) {
        let _ = fs::remove_file(request_path);
    }
    if let Ok(response_path) = get_permission_response_path(session_id) {
        let _ = fs::remove_file(response_path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_secret_sign_verify() {
        let secret = SessionSecret::new();
        let message = "test message";
        let signature = secret.sign(message);
        assert!(secret.verify(message, &signature));
        assert!(!secret.verify("different message", &signature));
    }

    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq(b"hello", b"hello"));
        assert!(!constant_time_eq(b"hello", b"world"));
        assert!(!constant_time_eq(b"hello", b"hell"));
    }
}
