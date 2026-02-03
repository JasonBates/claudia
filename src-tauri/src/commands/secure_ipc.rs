//! Secure IPC file handling for permission requests/responses
//!
//! This module provides secure file-based IPC with:
//! - App-private directory with 0700 permissions
//! - Files with 0600 permissions (owner read/write only)
//! - Atomic writes (temp file + rename)
//! - Owner/permission verification before reads
//!
//! Security model: Relies on OS file permissions rather than cryptographic
//! signing. An attacker who cannot write to the user's files cannot spoof
//! permission requests. This approach works across session reloads.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(not(unix))]
use std::fs::File;

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

/// Verify file permissions and ownership from an open file handle
/// This avoids TOCTOU vulnerabilities by using fstat instead of stat
#[cfg(unix)]
pub fn verify_file_security_from_handle(file: &std::fs::File) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file
        .metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

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
pub fn verify_file_security_from_handle(_file: &std::fs::File) -> Result<(), String> {
    // On non-Unix platforms, skip permission verification
    // Windows has different ACL-based security model
    Ok(())
}

/// Legacy path-based verification - prefer verify_file_security_from_handle
/// to avoid TOCTOU vulnerabilities
#[cfg(unix)]
#[allow(dead_code)]
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
#[allow(dead_code)]
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
    // Use timestamp + process ID for uniqueness
    let temp_path = dir.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
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
/// Opens the file once with O_NOFOLLOW and verifies metadata from the handle
/// to prevent TOCTOU/symlink attacks
pub fn secure_read(path: &PathBuf) -> Result<String, String> {
    use std::io::Read;

    // Open file with O_NOFOLLOW to prevent symlink attacks
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|e| {
                if e.raw_os_error() == Some(libc::ELOOP) {
                    "Refusing to follow symlink".to_string()
                } else {
                    format!("Failed to open file: {}", e)
                }
            })?
    };

    #[cfg(not(unix))]
    let file = OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    // Verify security from the open file handle (fstat, not stat)
    verify_file_security_from_handle(&file)?;

    // Read from the already-verified handle
    let mut content = String::new();
    let mut file = file;
    file.read_to_string(&mut content)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    Ok(content)
}

/// Write a JSON IPC message with secure file permissions
pub fn write_ipc_message(path: &PathBuf, content: &serde_json::Value) -> Result<(), String> {
    let content_str = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize content: {}", e))?;

    secure_write(path, &content_str)
}

/// Read a JSON IPC message with file permission verification
pub fn read_ipc_message(path: &PathBuf) -> Result<serde_json::Value, String> {
    let content = secure_read(path)?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse message: {}", e))
}

/// Clean up IPC files for a session
#[allow(dead_code)]
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
    use std::io::Write;
    use tempfile::TempDir;

    // ============================================================================
    // Path generation tests
    // ============================================================================

    #[test]
    fn test_get_secure_ipc_dir() {
        let dir = get_secure_ipc_dir();
        assert!(dir.is_ok());
        let path = dir.unwrap();
        assert!(path.to_string_lossy().contains("com.jasonbates.claudia"));
    }

    #[test]
    fn test_permission_paths() {
        let session_id = "test-session-123";
        let request_path = get_permission_request_path(session_id);
        let response_path = get_permission_response_path(session_id);

        assert!(request_path.is_ok());
        assert!(response_path.is_ok());

        let req = request_path.unwrap();
        let res = response_path.unwrap();

        assert!(req.to_string_lossy().contains("permission-request-test-session-123"));
        assert!(res.to_string_lossy().contains("permission-response-test-session-123"));
    }

    #[test]
    fn test_permission_paths_with_special_characters() {
        let session_id = "abc-123_def";
        let request_path = get_permission_request_path(session_id);
        assert!(request_path.is_ok());
        assert!(request_path
            .unwrap()
            .to_string_lossy()
            .contains("permission-request-abc-123_def"));
    }

    // ============================================================================
    // secure_write tests
    // ============================================================================

    #[test]
    fn test_secure_write_creates_file_with_content() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-file.json");

        let result = secure_write(&file_path, "test content");
        assert!(result.is_ok());
        assert!(file_path.exists());

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "test content");
    }

    #[test]
    fn test_secure_write_overwrites_existing_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-file.json");

        secure_write(&file_path, "original content").unwrap();
        secure_write(&file_path, "new content").unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "new content");
    }

    #[cfg(unix)]
    #[test]
    fn test_secure_write_sets_0600_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-file.json");

        secure_write(&file_path, "test content").unwrap();

        let metadata = fs::metadata(&file_path).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "File should have 0600 permissions");
    }

    #[test]
    fn test_secure_write_no_parent_dir_fails() {
        let path = PathBuf::from("");
        let result = secure_write(&path, "content");
        assert!(result.is_err());
    }

    #[test]
    fn test_secure_write_nonexistent_parent_fails() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("nonexistent/subdir/test.json");

        let result = secure_write(&file_path, "content");
        assert!(result.is_err());
    }

    #[test]
    fn test_secure_write_atomic_behavior() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-file.json");

        secure_write(&file_path, "original").unwrap();
        secure_write(&file_path, "new content that is much longer").unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "new content that is much longer");
    }

    #[test]
    fn test_secure_write_with_unicode_content() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-unicode.json");

        let unicode_content = r#"{"message": "Hello 世界 🌍 émoji"}"#;
        secure_write(&file_path, unicode_content).unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, unicode_content);
    }

    // ============================================================================
    // secure_read tests
    // ============================================================================

    #[cfg(unix)]
    #[test]
    fn test_secure_read_with_valid_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test-read.json");

        // Use secure_write to create a properly permissioned file
        secure_write(&file_path, "test content").unwrap();

        let result = secure_read(&file_path);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test content");
    }

    #[cfg(unix)]
    #[test]
    fn test_secure_read_rejects_symlink() {
        use std::os::unix::fs::symlink;

        let temp_dir = TempDir::new().unwrap();
        let real_file = temp_dir.path().join("real-file.json");
        let symlink_path = temp_dir.path().join("symlink.json");

        // Create a real file with secure permissions
        secure_write(&real_file, "secret content").unwrap();

        // Create a symlink to it
        symlink(&real_file, &symlink_path).unwrap();

        // secure_read should refuse to follow the symlink (O_NOFOLLOW)
        let result = secure_read(&symlink_path);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("symlink"),
            "Error should mention symlink"
        );
    }

    #[cfg(unix)]
    #[test]
    fn test_secure_read_rejects_insecure_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("insecure.json");

        // Create file with insecure permissions (world-readable)
        {
            let mut file = fs::File::create(&file_path).unwrap();
            file.write_all(b"content").unwrap();
        }
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o644)).unwrap();

        let result = secure_read(&file_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insecure file permissions"));
    }

    #[test]
    fn test_secure_read_nonexistent_file_fails() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("nonexistent.json");

        let result = secure_read(&file_path);
        assert!(result.is_err());
    }

    // ============================================================================
    // verify_file_security_from_handle tests (TOCTOU-safe verification)
    // ============================================================================

    #[cfg(unix)]
    #[test]
    fn test_verify_file_security_from_handle_accepts_0600() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("secure-file.txt");

        {
            let mut file = fs::File::create(&file_path).unwrap();
            file.write_all(b"test content").unwrap();
        }
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o600)).unwrap();

        let file = fs::File::open(&file_path).unwrap();
        let result = verify_file_security_from_handle(&file);
        assert!(result.is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn test_verify_file_security_from_handle_rejects_group_readable() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("group-readable.txt");

        {
            let mut file = fs::File::create(&file_path).unwrap();
            file.write_all(b"test content").unwrap();
        }
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o640)).unwrap();

        let file = fs::File::open(&file_path).unwrap();
        let result = verify_file_security_from_handle(&file);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insecure file permissions"));
    }

    #[cfg(unix)]
    #[test]
    fn test_verify_file_security_from_handle_rejects_world_readable() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("world-readable.txt");

        {
            let mut file = fs::File::create(&file_path).unwrap();
            file.write_all(b"test content").unwrap();
        }
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o644)).unwrap();

        let file = fs::File::open(&file_path).unwrap();
        let result = verify_file_security_from_handle(&file);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Insecure file permissions"));
    }

    #[cfg(unix)]
    #[test]
    fn test_verify_file_security_from_handle_accepts_0400_readonly() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("readonly.txt");

        {
            let mut file = fs::File::create(&file_path).unwrap();
            file.write_all(b"test content").unwrap();
        }
        fs::set_permissions(&file_path, fs::Permissions::from_mode(0o400)).unwrap();

        let file = fs::File::open(&file_path).unwrap();
        let result = verify_file_security_from_handle(&file);
        assert!(result.is_ok());
    }

    // ============================================================================
    // IPC message tests (JSON serialization)
    // ============================================================================

    #[test]
    fn test_write_and_read_ipc_message() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("ipc-message.json");

        let message = serde_json::json!({
            "type": "permission_request",
            "tool": "Bash",
            "command": "ls -la"
        });

        write_ipc_message(&file_path, &message).unwrap();

        // On Unix, use secure_read which verifies permissions
        #[cfg(unix)]
        {
            let read_result = read_ipc_message(&file_path);
            assert!(read_result.is_ok());
            let read_message = read_result.unwrap();
            assert_eq!(read_message["type"], "permission_request");
            assert_eq!(read_message["tool"], "Bash");
        }

        // On non-Unix, just verify the file was written correctly
        #[cfg(not(unix))]
        {
            let content = fs::read_to_string(&file_path).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
            assert_eq!(parsed["type"], "permission_request");
        }
    }

    #[test]
    fn test_read_ipc_message_invalid_json_fails() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("invalid.json");

        secure_write(&file_path, "not valid json {{{").unwrap();

        #[cfg(unix)]
        {
            let result = read_ipc_message(&file_path);
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Failed to parse"));
        }
    }

    // ============================================================================
    // ensure_secure_dir tests
    // ============================================================================

    #[test]
    fn test_ensure_secure_dir_creates_directory() {
        let result = ensure_secure_dir();
        assert!(result.is_ok());

        let dir = result.unwrap();
        assert!(dir.exists());
        assert!(dir.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn test_ensure_secure_dir_has_0700_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = ensure_secure_dir().unwrap();
        let metadata = fs::metadata(&dir).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "Directory should have 0700 permissions");
    }
}
