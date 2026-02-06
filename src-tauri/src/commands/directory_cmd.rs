//! Directory and window commands

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

use super::cmd_debug_log;
use super::AppState;

/// Result of checking for Claude Code CLI installation
#[derive(Debug, Serialize)]
pub struct ClaudeCodeStatus {
    /// Whether Claude Code CLI is installed and accessible
    pub installed: bool,
    /// Version string if installed (e.g., "1.0.30")
    pub version: Option<String>,
    /// Path to the claude binary if found
    pub path: Option<String>,
}

/// Open a new Claudia window with the specified directory
///
/// Re-launches the current executable with the specified directory as an argument.
#[tauri::command]
pub async fn open_new_window(directory: String) -> Result<(), String> {
    cmd_debug_log(
        "NEW_WINDOW",
        &format!("open_new_window called with: {}", directory),
    );

    // Validate the directory exists
    let working_dir = std::path::PathBuf::from(&directory);
    if !working_dir.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    if !working_dir.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    // Get the current executable path
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;
    cmd_debug_log("NEW_WINDOW", &format!("Current executable: {:?}", exe_path));

    // Spawn new instance by running the executable directly
    let result = Command::new(&exe_path).arg(&directory).spawn();

    match result {
        Ok(_) => {
            cmd_debug_log("NEW_WINDOW", "New window spawned successfully");
            Ok(())
        }
        Err(e) => {
            cmd_debug_log("NEW_WINDOW", &format!("Failed to spawn new window: {}", e));
            Err(format!("Failed to open new window: {}", e))
        }
    }
}

/// Check if a CLI directory argument was provided when launching the app.
///
/// Used by the frontend to decide whether to show the project picker.
/// If true, the user explicitly chose this directory (via reopen or CLI),
/// so we should skip the picker.
#[tauri::command]
pub fn has_cli_directory(state: tauri::State<'_, AppState>) -> bool {
    state.has_cli_directory
}

/// Close current window and open a new one in the specified directory.
///
/// This effectively "reopens" the app in a different project by:
/// 1. Spawning a new instance with the directory as CLI argument
/// 2. Exiting the current instance
///
/// The directory is passed as a CLI arg, which AppState::new picks up
/// via the cli_dir parameter (see mod.rs line 63).
#[tauri::command]
pub async fn reopen_in_directory(directory: String, app: tauri::AppHandle) -> Result<(), String> {
    cmd_debug_log(
        "REOPEN",
        &format!("reopen_in_directory called with: {}", directory),
    );

    // Validate the directory exists
    let working_dir = std::path::PathBuf::from(&directory);
    if !working_dir.exists() {
        return Err(format!("Directory does not exist: {}", directory));
    }
    if !working_dir.is_dir() {
        return Err(format!("Path is not a directory: {}", directory));
    }

    // Get the current executable path
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Failed to get executable path: {}", e))?;
    cmd_debug_log("REOPEN", &format!("Current executable: {:?}", exe_path));

    // Spawn new instance with the directory as CLI argument.
    // This is how AppState::new picks up the launch_dir (see mod.rs).
    // Note: We intentionally do NOT pass CLAUDIA_LAUNCH_DIR env var because
    // CLI args take precedence and the new instance should use the new directory.
    let result = Command::new(&exe_path).arg(&directory).spawn();

    match result {
        Ok(_) => {
            cmd_debug_log("REOPEN", "New instance spawned, exiting current");
            // Exit current instance
            app.exit(0);
            Ok(())
        }
        Err(e) => {
            cmd_debug_log("REOPEN", &format!("Failed to spawn new instance: {}", e));
            Err(format!("Failed to reopen in directory: {}", e))
        }
    }
}

/// Find the claude binary by checking common installation locations.
/// macOS Launch Services doesn't include user PATH, so we need to check manually.
fn find_claude_binary() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    // Check common locations for user-installed binaries
    let candidates = [
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
        PathBuf::from("/usr/bin/claude"),
    ];

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    // Check nvm node path (claude is a node-based tool)
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            versions.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
            if let Some(latest) = versions.first() {
                let bin_path = latest.path().join("bin/claude");
                if bin_path.exists() {
                    return Some(bin_path);
                }
            }
        }
    }

    None
}

/// Check if Claude Code CLI is installed and return status info.
///
/// This is called at app startup to show a friendly message if Claude Code
/// isn't installed, guiding users to install it before they can use Claudia.
#[tauri::command]
pub async fn check_claude_code_installed() -> ClaudeCodeStatus {
    cmd_debug_log("CLAUDE_CHECK", "Checking for Claude Code CLI installation");

    // First try to find the binary
    let claude_path = find_claude_binary();

    if let Some(path) = &claude_path {
        cmd_debug_log(
            "CLAUDE_CHECK",
            &format!("Found claude binary at: {:?}", path),
        );

        // Try to get the version
        let version = Command::new(path)
            .arg("--version")
            .output()
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    String::from_utf8(output.stdout)
                        .ok()
                        .map(|s| s.trim().to_string())
                } else {
                    None
                }
            });

        cmd_debug_log(
            "CLAUDE_CHECK",
            &format!("Claude Code version: {:?}", version),
        );

        ClaudeCodeStatus {
            installed: true,
            version,
            path: Some(path.to_string_lossy().to_string()),
        }
    } else {
        cmd_debug_log("CLAUDE_CHECK", "Claude Code CLI not found");

        ClaudeCodeStatus {
            installed: false,
            version: None,
            path: None,
        }
    }
}
