//! New window commands

use std::process::Command;

use super::cmd_debug_log;

/// Open a new Claudia window with the specified directory
///
/// Uses macOS `open -n -a Claudia --args <directory>` to spawn a new app instance.
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

    // Spawn new Claudia instance using macOS open command
    // -n flag opens a new instance even if already running
    let result = Command::new("open")
        .args(["-n", "-a", "Claudia", "--args", &directory])
        .spawn();

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
