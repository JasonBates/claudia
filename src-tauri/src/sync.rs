//! Claude Code Machine Sync (CCMS) integration
//!
//! Provides sync functionality to keep ~/.claude/ synchronized between machines.
//! Uses CCMS (https://github.com/miwidot/ccms) as the underlying sync tool.

use std::path::PathBuf;
use std::process::Command;

/// Result of a sync operation
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Find the ccms executable
fn find_ccms() -> Option<PathBuf> {
    // Check common locations
    let home = dirs::home_dir()?;
    let paths = [
        home.join(".local/bin/ccms"),
        home.join(".ccms-repo/ccms"),
        PathBuf::from("/usr/local/bin/ccms"),
    ];

    for path in paths {
        if path.exists() {
            return Some(path);
        }
    }

    // Try finding in PATH
    if let Ok(output) = Command::new("which").arg("ccms").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Some(PathBuf::from(path_str));
            }
        }
    }

    None
}

/// Check if CCMS is configured
pub fn is_ccms_configured() -> bool {
    if let Some(home) = dirs::home_dir() {
        let config_path = home.join(".ccms/config");
        config_path.exists()
    } else {
        false
    }
}

/// Run a ccms command with the given arguments
fn run_ccms(args: &[&str]) -> SyncResult {
    let ccms_path = match find_ccms() {
        Some(path) => path,
        None => {
            return SyncResult {
                success: false,
                output: String::new(),
                error: Some(
                    "ccms not found. Install from https://github.com/miwidot/ccms".to_string(),
                ),
            };
        }
    };

    if !is_ccms_configured() {
        return SyncResult {
            success: false,
            output: String::new(),
            error: Some("ccms not configured. Run 'ccms config' first".to_string()),
        };
    }

    eprintln!("[SYNC] Running: {} {:?}", ccms_path.display(), args);

    let output = match Command::new(&ccms_path).args(args).output() {
        Ok(output) => output,
        Err(e) => {
            return SyncResult {
                success: false,
                output: String::new(),
                error: Some(format!("Failed to run ccms: {}", e)),
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    eprintln!("[SYNC] Exit status: {:?}", output.status);
    if !stdout.is_empty() {
        eprintln!(
            "[SYNC] stdout: {}",
            stdout.lines().take(5).collect::<Vec<_>>().join("\n")
        );
    }
    if !stderr.is_empty() {
        eprintln!("[SYNC] stderr: {}", stderr);
    }

    if output.status.success() {
        SyncResult {
            success: true,
            output: stdout,
            error: None,
        }
    } else {
        SyncResult {
            success: false,
            output: stdout,
            error: Some(if stderr.is_empty() {
                "ccms command failed".to_string()
            } else {
                stderr
            }),
        }
    }
}

/// Pull latest ~/.claude/ from remote machine
/// Uses --force to skip interactive prompts
pub fn ccms_pull() -> SyncResult {
    run_ccms(&["--force", "pull"])
}

/// Push local ~/.claude/ to remote machine
/// Uses --force to skip interactive prompts
pub fn ccms_push() -> SyncResult {
    run_ccms(&["--force", "push"])
}

/// Get sync status (dry-run showing what would change)
pub fn ccms_status() -> SyncResult {
    run_ccms(&["status"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_ccms() {
        // This will depend on whether ccms is installed
        let result = find_ccms();
        println!("ccms found: {:?}", result);
    }

    #[test]
    fn test_is_configured() {
        let configured = is_ccms_configured();
        println!("ccms configured: {}", configured);
    }
}
