//! Session lifecycle commands

use tauri::{ipc::Channel, State};
use tokio::time::{timeout, Duration};

use super::{cmd_debug_log, AppState};
use crate::claude_process::ClaudeProcess;
use crate::events::ClaudeEvent;

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

/// Clear the session by restarting the Claude process
///
/// This is the only way to actually clear context in stream-json mode,
/// as slash commands like /clear don't work when sent as message content.
/// See: https://github.com/anthropics/claude-code/issues/4184
#[tauri::command]
pub async fn clear_session(
    channel: Channel<ClaudeEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log("CLEAR", "clear_session called - restarting Claude process");

    // Get working directory before killing process
    let config = state.config.lock().await;
    let working_dir = config.working_dir();
    drop(config);

    // Kill existing process
    {
        let mut process_guard = state.process.lock().await;
        if process_guard.is_some() {
            cmd_debug_log("CLEAR", "Dropping existing process");
            *process_guard = None;
        }
    }

    // Small delay to ensure clean shutdown
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Spawn new Claude process
    let dir = working_dir.clone();
    let process = tokio::task::spawn_blocking(move || ClaudeProcess::spawn(&dir))
        .await
        .map_err(|e| {
            cmd_debug_log("CLEAR", &format!("Task join error: {}", e));
            format!("Task join error: {}", e)
        })??;

    cmd_debug_log("CLEAR", "New process spawned successfully");

    // Store the new process
    let process_arc = state.process.clone();
    {
        let mut process_guard = process_arc.lock().await;
        *process_guard = Some(process);
    }

    // Don't wait for ready - the bridge will be ready when needed
    // Just send the done event immediately so UI can update
    cmd_debug_log("CLEAR", "New process spawned, sending done event immediately");

    // Send done event - the bridge will be ready by the time user sends next message
    channel
        .send(ClaudeEvent::Done)
        .map_err(|e| e.to_string())?;

    cmd_debug_log("CLEAR", "Session cleared successfully");
    Ok(())
}
