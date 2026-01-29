//! Permission request handling commands

use tauri::State;

use super::{cmd_debug_log, AppState};

/// Permission file paths (hook-based permission system)
/// Uses session_id to prevent collisions between multiple app instances
fn get_permission_request_path(session_id: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("claudia-permission-request-{}.json", session_id))
}

fn get_permission_response_path(session_id: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("claudia-permission-response-{}.json", session_id))
}

/// Check for pending permission request from hook
/// This is an atomic "take" operation - it reads and deletes the file
#[tauri::command]
pub async fn poll_permission_request(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let request_path = get_permission_request_path(&state.session_id);

    if request_path.exists() {
        match std::fs::read_to_string(&request_path) {
            Ok(content) => {
                // Delete the file immediately to prevent duplicate processing
                let _ = std::fs::remove_file(&request_path);

                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        cmd_debug_log(
                            "PERMISSION",
                            &format!(
                                "Found and took permission request (session {}): {:?}",
                                &state.session_id[..8],
                                json
                            ),
                        );
                        Ok(Some(json))
                    }
                    Err(e) => {
                        cmd_debug_log(
                            "PERMISSION",
                            &format!("Failed to parse permission request: {}", e),
                        );
                        Ok(None)
                    }
                }
            }
            Err(e) => {
                cmd_debug_log(
                    "PERMISSION",
                    &format!("Failed to read permission request: {}", e),
                );
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
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log(
        "PERMISSION",
        &format!(
            "Writing permission response (session {}): allow={}, message={:?}",
            &state.session_id[..8],
            allow,
            message
        ),
    );

    let response_path = get_permission_response_path(&state.session_id);

    let response = serde_json::json!({
        "allow": allow,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    std::fs::write(
        &response_path,
        serde_json::to_string_pretty(&response).unwrap(),
    )
    .map_err(|e| format!("Failed to write permission response: {}", e))?;

    Ok(())
}

/// Send permission response via the Claude process
#[tauri::command]
pub async fn send_permission_response(
    request_id: String,
    allow: bool,
    remember: bool,
    tool_input: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log(
        "PERMISSION",
        &format!(
            "Sending control_response: request_id={}, allow={}, remember={}",
            request_id, allow, remember
        ),
    );

    let mut process_guard = state.process.lock().await;
    let process = process_guard.as_mut().ok_or("No active session")?;

    // Send as control_response JSON that the bridge will forward to Claude CLI
    // Include tool_input for the SDK's updatedInput field
    let msg = serde_json::json!({
        "type": "control_response",
        "request_id": request_id,
        "allow": allow,
        "remember": remember,
        "tool_input": tool_input.unwrap_or(serde_json::json!({}))
    });

    process.send_message(&msg.to_string())?;
    Ok(())
}

/// Get the session ID for this app instance
/// Used to coordinate permission file paths with the bridge/MCP server
#[tauri::command]
pub async fn get_session_id(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.session_id.clone())
}
