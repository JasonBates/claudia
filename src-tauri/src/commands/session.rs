//! Session lifecycle commands

use tauri::{ipc::Channel, State};
use tokio::time::Duration;

use super::{cmd_debug_log, AppState};
use crate::claude_process::{spawn_claude_process, spawn_claude_process_with_resume};
use crate::events::ClaudeEvent;

/// Get the directory from which the app was launched
#[tauri::command]
pub fn get_launch_dir(state: State<'_, AppState>) -> String {
    state.launch_dir.clone()
}

/// Check if sandbox mode is enabled in the config
#[tauri::command]
pub async fn is_sandbox_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    let config = state.config.lock().await;
    Ok(config.sandbox_enabled)
}

/// Start a new Claude session
/// Uses the split sender/receiver/handle architecture for responsive control commands
#[tauri::command]
pub async fn start_session(
    working_dir: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    cmd_debug_log(
        "SESSION",
        &format!("start_session called, working_dir: {:?}", working_dir),
    );

    // Clear all existing state atomically
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;

        if sender_guard.is_some() {
            cmd_debug_log("SESSION", "Dropping existing process");
        }
        *sender_guard = None;
        *receiver_guard = None;
        *handle_guard = None;
    }

    // Determine working directory
    let config = state.config.lock().await;
    let dir = working_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| config.working_dir());
    drop(config); // Release config lock before blocking task

    let dir_string = dir.to_string_lossy().to_string();
    cmd_debug_log("SESSION", &format!("Using directory: {:?}", dir));

    // Clone session_id for the blocking task
    let app_session_id = state.session_id.clone();

    // Spawn new Claude process with split sender/receiver/handle
    let (sender, receiver, handle) =
        tokio::task::spawn_blocking(move || spawn_claude_process(&dir, &app_session_id))
            .await
            .map_err(|e| {
                cmd_debug_log("SESSION", &format!("Task join error: {}", e));
                format!("Task join error: {}", e)
            })??;

    cmd_debug_log("SESSION", "Process spawned successfully");

    // Store the split components
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;
        *sender_guard = Some(sender);
        *receiver_guard = Some(receiver);
        *handle_guard = Some(handle);
    }

    Ok(dir_string)
}

/// Stop the current Claude session
/// Uses split locks - sender for interrupt, handle for shutdown
#[tauri::command]
pub async fn stop_session(state: State<'_, AppState>) -> Result<(), String> {
    // Try to send interrupt via sender (graceful stop)
    {
        let mut sender_guard = state.sender.lock().await;
        if let Some(sender) = sender_guard.as_mut() {
            let _ = sender.send_interrupt();
        }
    }

    // Clear all state atomically
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;

        *sender_guard = None;
        *receiver_guard = None;
        *handle_guard = None; // ProcessHandle::drop will call shutdown()
    }

    Ok(())
}

/// Send an interrupt signal to the current session
/// Uses sender lock only - does not block on streaming receiver
#[tauri::command]
pub async fn send_interrupt(state: State<'_, AppState>) -> Result<(), String> {
    // Use sender lock - independent of streaming receiver lock
    let mut sender_guard = state.sender.lock().await;

    if let Some(sender) = sender_guard.as_mut() {
        sender.send_interrupt()?;
    }

    Ok(())
}

/// Check if a session is currently active
#[tauri::command]
pub async fn is_session_active(state: State<'_, AppState>) -> Result<bool, String> {
    let sender_guard = state.sender.lock().await;
    Ok(sender_guard.is_some())
}

/// Resume a previous session by its ID
///
/// This restarts the Claude process with the --resume flag
/// Uses the split sender/receiver/handle architecture
#[tauri::command]
pub async fn resume_session(
    session_id: String,
    channel: Channel<ClaudeEvent>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    cmd_debug_log(
        "RESUME",
        &format!("resume_session called with: {}", session_id),
    );

    // Use the launch directory
    let working_dir = std::path::PathBuf::from(&state.launch_dir);
    let dir_string = working_dir.to_string_lossy().to_string();

    // Clear all existing state atomically
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;

        if sender_guard.is_some() {
            cmd_debug_log("RESUME", "Dropping existing process");
        }
        *sender_guard = None;
        *receiver_guard = None;
        *handle_guard = None;
    }

    // Small delay to ensure clean shutdown
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Spawn new Claude process with resume flag
    let dir = working_dir.clone();
    let sid = session_id.clone();
    let app_session_id = state.session_id.clone();
    let (sender, receiver, handle) = tokio::task::spawn_blocking(move || {
        spawn_claude_process_with_resume(&dir, Some(&sid), &app_session_id)
    })
    .await
    .map_err(|e| {
        cmd_debug_log("RESUME", &format!("Task join error: {}", e));
        format!("Task join error: {}", e)
    })??;

    cmd_debug_log("RESUME", "Process spawned with resume flag");

    // Store the split components
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;
        *sender_guard = Some(sender);
        *receiver_guard = Some(receiver);
        *handle_guard = Some(handle);
    }

    // Send done event
    channel.send(ClaudeEvent::Done).map_err(|e| e.to_string())?;

    cmd_debug_log("RESUME", &format!("Session resumed: {}", session_id));
    Ok(dir_string)
}

/// Clear the session by restarting the Claude process
///
/// This is the only way to actually clear context in stream-json mode,
/// as slash commands like /clear don't work when sent as message content.
/// See: https://github.com/anthropics/claude-code/issues/4184
/// Uses the split sender/receiver/handle architecture
#[tauri::command]
pub async fn clear_session(
    channel: Channel<ClaudeEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log("CLEAR", "clear_session called - restarting Claude process");

    // Use the launch directory (from CLI args or current_dir at startup)
    let working_dir = std::path::PathBuf::from(&state.launch_dir);

    // Clear all existing state atomically
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;

        if sender_guard.is_some() {
            cmd_debug_log("CLEAR", "Dropping existing process");
        }
        *sender_guard = None;
        *receiver_guard = None;
        *handle_guard = None;
    }

    // Small delay to ensure clean shutdown
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Spawn new Claude process
    let dir = working_dir.clone();
    let app_session_id = state.session_id.clone();
    let (sender, receiver, handle) =
        tokio::task::spawn_blocking(move || spawn_claude_process(&dir, &app_session_id))
            .await
            .map_err(|e| {
                cmd_debug_log("CLEAR", &format!("Task join error: {}", e));
                format!("Task join error: {}", e)
            })??;

    cmd_debug_log("CLEAR", "New process spawned successfully");

    // Store the split components
    {
        let mut sender_guard = state.sender.lock().await;
        let mut receiver_guard = state.receiver.lock().await;
        let mut handle_guard = state.process_handle.lock().await;
        *sender_guard = Some(sender);
        *receiver_guard = Some(receiver);
        *handle_guard = Some(handle);
    }

    // Don't wait for ready - the bridge will be ready when needed
    // Just send the done event immediately so UI can update
    cmd_debug_log(
        "CLEAR",
        "New process spawned, sending done event immediately",
    );

    // Send done event - the bridge will be ready by the time user sends next message
    channel.send(ClaudeEvent::Done).map_err(|e| e.to_string())?;

    cmd_debug_log("CLEAR", "Session cleared successfully");
    Ok(())
}
