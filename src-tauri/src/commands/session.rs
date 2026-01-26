//! Session lifecycle commands

use tauri::State;

use super::{cmd_debug_log, AppState};
use crate::claude_process::ClaudeProcess;

/// Get the directory from which the app was launched (if it's a git worktree)
#[tauri::command]
pub fn get_launch_dir(state: State<'_, AppState>) -> String {
    let launch_path = std::path::Path::new(&state.launch_dir);
    let git_dir = launch_path.join(".git");
    if git_dir.exists() {
        state.launch_dir.clone()
    } else {
        String::new()
    }
}

/// Start a new Claude session
#[tauri::command]
pub async fn start_session(
    working_dir: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    cmd_debug_log(
        "SESSION",
        &format!("start_session called, working_dir: {:?}", working_dir),
    );

    let mut process_guard = state.process.lock().await;

    // Drop existing process if any
    if process_guard.is_some() {
        cmd_debug_log("SESSION", "Dropping existing process");
        *process_guard = None;
    }

    // Determine working directory
    let config = state.config.lock().await;
    let dir = working_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| config.working_dir());

    let dir_string = dir.to_string_lossy().to_string();
    cmd_debug_log("SESSION", &format!("Using directory: {:?}", dir));

    // Spawn new Claude process (sync operation wrapped in blocking task)
    let process = tokio::task::spawn_blocking(move || ClaudeProcess::spawn(&dir))
        .await
        .map_err(|e| {
            cmd_debug_log("SESSION", &format!("Task join error: {}", e));
            format!("Task join error: {}", e)
        })??;

    cmd_debug_log("SESSION", "Process spawned successfully");
    *process_guard = Some(process);

    Ok(dir_string)
}

/// Stop the current Claude session
#[tauri::command]
pub async fn stop_session(state: State<'_, AppState>) -> Result<(), String> {
    let mut process_guard = state.process.lock().await;

    if let Some(mut process) = process_guard.take() {
        // Send interrupt to gracefully stop
        let _ = process.send_interrupt();
    }

    Ok(())
}

/// Send an interrupt signal to the current session
#[tauri::command]
pub async fn send_interrupt(state: State<'_, AppState>) -> Result<(), String> {
    let mut process_guard = state.process.lock().await;

    if let Some(process) = process_guard.as_mut() {
        process.send_interrupt()?;
    }

    Ok(())
}

/// Check if a session is currently active
#[tauri::command]
pub async fn is_session_active(state: State<'_, AppState>) -> Result<bool, String> {
    let process_guard = state.process.lock().await;
    Ok(process_guard.is_some())
}
