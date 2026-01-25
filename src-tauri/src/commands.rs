use std::sync::Arc;
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
use tauri::{ipc::Channel, State};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::claude_process::ClaudeProcess;
use crate::config::Config;
use crate::events::ClaudeEvent;

fn cmd_debug_log(prefix: &str, msg: &str) {
    let log_path = std::env::temp_dir().join("claude-commands-debug.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] [{}] {}", timestamp, prefix, msg);
    }
    eprintln!("[CMD:{}] {}", prefix, msg);
}

pub struct AppState {
    pub process: Arc<Mutex<Option<ClaudeProcess>>>,
    pub config: Arc<Mutex<Config>>,
    pub launch_dir: String,
}

impl AppState {
    pub fn new() -> Self {
        let config = Config::load().unwrap_or_default();
        let launch_dir = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());
        Self {
            process: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(config)),
            launch_dir,
        }
    }
}

#[tauri::command]
pub fn get_launch_dir(state: State<'_, AppState>) -> String {
    state.launch_dir.clone()
}

#[tauri::command]
pub async fn start_session(
    working_dir: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    cmd_debug_log("SESSION", &format!("start_session called, working_dir: {:?}", working_dir));

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

#[tauri::command]
pub async fn send_message(
    message: String,
    channel: Channel<ClaudeEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Clear command log
    let log_path = std::env::temp_dir().join("claude-commands-debug.log");
    let _ = std::fs::write(&log_path, format!("=== send_message started at {} ===\n", chrono::Local::now()));

    cmd_debug_log("SEND", &format!("Message: {}", &message[..message.len().min(50)]));

    // Stream responses - clone Arc for streaming loop
    let process_arc = state.process.clone();

    // Drain any stale events from previous response before sending new message
    {
        let mut process_guard = process_arc.lock().await;
        if let Some(process) = process_guard.as_mut() {
            cmd_debug_log("DRAIN", "Draining stale events...");
            let mut drained = 0;
            loop {
                match timeout(Duration::from_millis(10), process.recv_event()).await {
                    Ok(Some(event)) => {
                        cmd_debug_log("DRAIN", &format!("Drained: {:?}", event));
                        drained += 1;
                    }
                    _ => break,
                }
            }
            if drained > 0 {
                cmd_debug_log("DRAIN", &format!("Drained {} stale events", drained));
            }
        }
    }

    // Send message (brief lock)
    {
        let mut process_guard = state.process.lock().await;
        let process = process_guard
            .as_mut()
            .ok_or("No active session. Call start_session first.")?;

        cmd_debug_log("SEND", "Got process, sending message");
        process.send_message(&message)?;
        cmd_debug_log("SEND", "Message sent to process");
    }

    // Read events with timeout to detect end of response
    // Note: Claude can take several seconds to start streaming, especially on first request
    let mut idle_count = 0;
    let max_idle = 60; // Wait up to 30 seconds (60 x 500ms) for initial response
    let mut event_count = 0;
    let mut got_first_content = false;
    let mut tool_pending = false; // Track if a tool is executing on server (e.g., WebSearch)

    cmd_debug_log("LOOP", "Starting event receive loop");

    loop {
        let mut process_guard = process_arc.lock().await;
        let process: &mut ClaudeProcess = match process_guard.as_mut() {
            Some(p) => p,
            None => {
                cmd_debug_log("LOOP", "Process is None, breaking");
                break;
            }
        };

        // Use longer timeout when tool is executing on server (WebSearch can take 10+ seconds)
        // Use shorter timeout once content is streaming (text comes fast)
        let current_timeout = if tool_pending { 5000 } else if got_first_content { 2000 } else { 500 };
        let current_max_idle = if tool_pending { 24 } else if got_first_content { 3 } else { max_idle }; // 2 min for tools

        // Try to receive with timeout
        match timeout(Duration::from_millis(current_timeout), process.recv_event()).await {
            Ok(Some(event)) => {
                event_count += 1;
                idle_count = 0;

                // Track if we've received actual content (text or tool use)
                if matches!(event, ClaudeEvent::TextDelta { .. } | ClaudeEvent::ToolStart { .. }) {
                    got_first_content = true;
                }

                // Track tool pending state
                if matches!(event, ClaudeEvent::ToolPending) {
                    tool_pending = true;
                    cmd_debug_log("TOOL", "Tool pending - waiting for server execution");
                }
                // Tool result or new text means tool finished
                if let ClaudeEvent::ToolResult { ref tool_use_id, ref stdout, .. } = event {
                    let stdout_len = stdout.as_ref().map(|s| s.len()).unwrap_or(0);
                    cmd_debug_log("TOOL_RESULT", &format!("Received tool_use_id={:?}, stdout_len={}", tool_use_id, stdout_len));
                    if tool_pending {
                        cmd_debug_log("TOOL", "Tool completed");
                    }
                    tool_pending = false;
                }
                if matches!(event, ClaudeEvent::TextDelta { .. }) {
                    if tool_pending {
                        cmd_debug_log("TOOL", "Tool completed (via text)");
                    }
                    tool_pending = false;
                }

                cmd_debug_log("EVENT", &format!("#{} Received: {:?}", event_count, event));

                // Check if this is a "done" signal
                let is_done = matches!(event, ClaudeEvent::Done);

                match channel.send(event) {
                    Ok(_) => cmd_debug_log("CHANNEL", &format!("#{} Sent to frontend", event_count)),
                    Err(e) => {
                        cmd_debug_log("CHANNEL_ERROR", &format!("#{} Send failed: {}", event_count, e));
                        return Err(e.to_string());
                    }
                }

                if is_done {
                    cmd_debug_log("LOOP", "Got Done event, breaking");
                    break;
                }
            }
            Ok(None) => {
                // Channel closed, process ended
                cmd_debug_log("LOOP", "Channel returned None (closed)");
                channel.send(ClaudeEvent::Done).map_err(|e| e.to_string())?;
                break;
            }
            Err(_) => {
                // Timeout - might be end of response
                idle_count += 1;
                cmd_debug_log("TIMEOUT", &format!("Idle count: {}/{} (got_content: {}, tool_pending: {})", idle_count, current_max_idle, got_first_content, tool_pending));
                if idle_count >= current_max_idle {
                    // Likely done responding
                    cmd_debug_log("LOOP", "Max idle reached, sending Done");
                    channel.send(ClaudeEvent::Done).map_err(|e| e.to_string())?;
                    break;
                }
            }
        }
    }

    cmd_debug_log("DONE", &format!("Total events received: {}", event_count));
    Ok(())
}

#[tauri::command]
pub async fn stop_session(state: State<'_, AppState>) -> Result<(), String> {
    let mut process_guard = state.process.lock().await;

    if let Some(mut process) = process_guard.take() {
        // Send interrupt to gracefully stop
        let _ = process.send_interrupt();
    }

    Ok(())
}

#[tauri::command]
pub async fn send_interrupt(state: State<'_, AppState>) -> Result<(), String> {
    let mut process_guard = state.process.lock().await;

    if let Some(process) = process_guard.as_mut() {
        process.send_interrupt()?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

#[tauri::command]
pub async fn save_config(config: Config, state: State<'_, AppState>) -> Result<(), String> {
    let mut config_guard = state.config.lock().await;
    config.save()?;
    *config_guard = config;
    Ok(())
}

#[tauri::command]
pub async fn is_session_active(state: State<'_, AppState>) -> Result<bool, String> {
    let process_guard = state.process.lock().await;
    Ok(process_guard.is_some())
}

/// Permission file paths (hook-based permission system)
fn get_permission_request_path() -> std::path::PathBuf {
    std::env::temp_dir().join("claude-terminal-permission-request.json")
}

fn get_permission_response_path() -> std::path::PathBuf {
    std::env::temp_dir().join("claude-terminal-permission-response.json")
}

/// Check for pending permission request from hook
/// This is an atomic "take" operation - it reads and deletes the file
#[tauri::command]
pub async fn poll_permission_request() -> Result<Option<serde_json::Value>, String> {
    let request_path = get_permission_request_path();

    if request_path.exists() {
        match std::fs::read_to_string(&request_path) {
            Ok(content) => {
                // Delete the file immediately to prevent duplicate processing
                let _ = std::fs::remove_file(&request_path);

                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        cmd_debug_log("PERMISSION", &format!("Found and took permission request: {:?}", json));
                        Ok(Some(json))
                    }
                    Err(e) => {
                        cmd_debug_log("PERMISSION", &format!("Failed to parse permission request: {}", e));
                        Ok(None)
                    }
                }
            }
            Err(e) => {
                cmd_debug_log("PERMISSION", &format!("Failed to read permission request: {}", e));
                Ok(None)
            }
        }
    } else {
        Ok(None)
    }
}

/// Respond to permission request (write response file for hook to read)
#[tauri::command]
pub async fn respond_to_permission(
    allow: bool,
    message: Option<String>,
) -> Result<(), String> {
    cmd_debug_log("PERMISSION", &format!("Writing permission response: allow={}, message={:?}", allow, message));

    let response_path = get_permission_response_path();

    let response = serde_json::json!({
        "allow": allow,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    std::fs::write(&response_path, serde_json::to_string_pretty(&response).unwrap())
        .map_err(|e| format!("Failed to write permission response: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn send_permission_response(
    request_id: String,
    allow: bool,
    remember: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log("PERMISSION", &format!("Sending control_response: request_id={}, allow={}, remember={}", request_id, allow, remember));

    let mut process_guard = state.process.lock().await;
    let process = process_guard
        .as_mut()
        .ok_or("No active session")?;

    // Send as control_response JSON that the bridge will forward to Claude CLI
    let msg = serde_json::json!({
        "type": "control_response",
        "request_id": request_id,
        "allow": allow,
        "remember": remember
    });

    process.send_message(&msg.to_string())?;
    Ok(())
}
