//! Permission request handling commands
//!
//! Security: Uses secure IPC with:
//! - App-private directory (0700 permissions)
//! - Files with 0600 permissions
//! - Atomic writes (temp file + rename)
//! - HMAC authentication to prevent spoofing
//! - Owner/permission verification before reads

use tauri::State;

use super::secure_ipc::{
    get_permission_request_path, get_permission_response_path, read_signed_message,
    write_signed_message,
};
use super::{cmd_debug_log, AppState};

/// Truncate session_id safely for logging (handles non-ASCII)
fn safe_session_prefix(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

/// Check for pending permission request from hook
/// This is an atomic "take" operation - it reads and deletes the file
/// Uses secure IPC with HMAC verification
#[tauri::command]
pub async fn poll_permission_request(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let request_path = match get_permission_request_path(&state.session_id) {
        Ok(path) => path,
        Err(e) => {
            cmd_debug_log("PERMISSION", &format!("Failed to get request path: {}", e));
            return Ok(None);
        }
    };

    if request_path.exists() {
        match read_signed_message(&request_path, &state.session_secret) {
            Ok(json) => {
                // Delete the file immediately to prevent duplicate processing
                let _ = std::fs::remove_file(&request_path);

                cmd_debug_log(
                    "PERMISSION",
                    &format!(
                        "Found and took permission request (session {}): {:?}",
                        safe_session_prefix(&state.session_id),
                        json
                    ),
                );
                Ok(Some(json))
            }
            Err(e) => {
                // Delete the file even on error to prevent repeated failures
                let _ = std::fs::remove_file(&request_path);

                cmd_debug_log(
                    "PERMISSION",
                    &format!(
                        "Failed to read/verify permission request: {} (file deleted)",
                        e
                    ),
                );
                Ok(None)
            }
        }
    } else {
        Ok(None)
    }
}

/// Respond to permission request (write response file for hook to read)
/// Uses secure IPC with HMAC signing and atomic writes
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
            safe_session_prefix(&state.session_id),
            allow,
            message
        ),
    );

    let response_path = get_permission_response_path(&state.session_id)?;

    let response = serde_json::json!({
        "allow": allow,
        "message": message,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });

    write_signed_message(&response_path, &response, &state.session_secret)?;

    Ok(())
}

/// Send permission response via the Claude process
/// Uses sender lock only - does not block on streaming receiver
#[tauri::command]
pub async fn send_permission_response(
    request_id: String,
    allow: bool,
    remember: bool,
    tool_input: Option<serde_json::Value>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log(
        "PERMISSION",
        &format!(
            "Sending control_response: request_id={}, allow={}, remember={}, message={:?}",
            request_id, allow, remember, message
        ),
    );

    // Use sender lock - independent of streaming receiver lock
    let mut sender_guard = state.sender.lock().await;
    let sender = sender_guard.as_mut().ok_or("No active session")?;

    // Send as control_response JSON that the bridge will forward to Claude CLI
    let msg = serde_json::json!({
        "type": "control_response",
        "request_id": request_id,
        "allow": allow,
        "remember": remember,
        "tool_input": tool_input.unwrap_or(serde_json::json!({})),
        "message": message
    });

    sender.send_message(&msg.to_string())?;
    Ok(())
}

/// Get the session ID for this app instance
/// Used to coordinate permission file paths with the bridge/MCP server
#[tauri::command]
pub async fn get_session_id(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.session_id.clone())
}

/// Send response to AskUserQuestion tool via the Claude process
/// Uses sender lock only - does not block on streaming receiver
#[tauri::command]
pub async fn send_question_response(
    request_id: String,
    questions: serde_json::Value,
    answers: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log(
        "QUESTION",
        &format!(
            "Sending question_response: request_id={}, answers={:?}",
            request_id, answers
        ),
    );

    // Use sender lock - independent of streaming receiver lock
    let mut sender_guard = state.sender.lock().await;
    let sender = sender_guard.as_mut().ok_or("No active session")?;

    // Send as question_response JSON that the bridge will forward to Claude CLI
    let msg = serde_json::json!({
        "type": "question_response",
        "request_id": request_id,
        "questions": questions,
        "answers": answers
    });

    sender.send_message(&msg.to_string())?;
    Ok(())
}

/// Cancel AskUserQuestion tool (send deny response so Claude can continue)
/// Uses sender lock only - does not block on streaming receiver
#[tauri::command]
pub async fn send_question_cancel(
    request_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    cmd_debug_log(
        "QUESTION",
        &format!("Sending question_cancel: request_id={}", request_id),
    );

    // Use sender lock - independent of streaming receiver lock
    let mut sender_guard = state.sender.lock().await;
    let sender = sender_guard.as_mut().ok_or("No active session")?;

    // Send as question_cancel JSON that the bridge will forward as a deny response
    let msg = serde_json::json!({
        "type": "question_cancel",
        "request_id": request_id
    });

    sender.send_message(&msg.to_string())?;
    Ok(())
}
