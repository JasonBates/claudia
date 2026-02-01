//! New window commands

use std::process::Command;

use super::cmd_debug_log;

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
