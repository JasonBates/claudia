//! Directory and window commands

use std::process::Command;

use super::cmd_debug_log;
use super::AppState;

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
