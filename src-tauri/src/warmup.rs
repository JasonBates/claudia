//! Warmup message identification and filtering
//!
//! Warmup messages are initialization messages that occur during session startup
//! before meaningful user engagement. This module provides a single source of truth
//! for identifying and filtering these messages.
//!
//! # What is a warmup message?
//!
//! - **isMeta messages**: System messages with `isMeta: true` (e.g., "Caveat: The messages below...")
//! - **Slash commands**: User messages starting with `/` (e.g., `/status`, `/help`)
//! - **Unknown command responses**: Responses to unrecognized commands
//! - **No response requested**: Claude's standard response during session drain/resume
//!
//! # Cleanup
//!
//! Sessions that contain only warmup messages can be deleted using `cleanup_warmup_session`.

use serde_json::Value;
use std::fs;
use std::path::Path;

use crate::commands::cmd_debug_log;

/// Response Claude gives during session drain/resume
pub const NO_RESPONSE_TEXT: &str = "No response requested.";

/// Check if user message content is warmup noise (not meaningful user input)
pub fn is_warmup_user_content(content: &str) -> bool {
    content.starts_with('/')
        || content.starts_with("Unknown slash command")
        || content.starts_with("Unknown skill:")
}

/// Check if assistant message content is warmup noise
pub fn is_warmup_assistant_content(content: &str) -> bool {
    content.trim() == NO_RESPONSE_TEXT
}

/// Check if a message should be considered meaningful (not warmup)
///
/// # Arguments
/// * `role` - "user" or "assistant"
/// * `content` - The message content
/// * `is_meta` - Whether the message has isMeta: true
pub fn is_meaningful_message(role: &str, content: &str, is_meta: bool) -> bool {
    match role {
        "user" => !is_meta && !is_warmup_user_content(content),
        "assistant" => !is_warmup_assistant_content(content),
        _ => false,
    }
}

/// Check if a JSONL entry should be skipped as a warmup message.
///
/// This is the main entry point for filtering warmup messages from session files.
/// It handles all warmup detection logic including isMeta checks and content patterns.
///
/// # Arguments
/// * `entry` - A parsed JSONL entry from a session file
/// * `entry_type` - The entry type ("user" or "assistant")
///
/// # Returns
/// * `true` if this entry should be skipped (is warmup)
/// * `false` if this entry should be included (is meaningful)
///
/// # Note
/// For user messages with array content (like tool results), this returns `false`
/// (don't skip) because we can't check the content patterns. The caller should
/// handle these cases appropriately.
pub fn should_skip_entry(entry: &Value, entry_type: &str) -> bool {
    if entry_type == "user" {
        // Check isMeta flag
        let is_meta = entry
            .get("isMeta")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if is_meta {
            return true;
        }

        // Check string content for warmup patterns
        // Array content (like tool results) is not checked - return false (don't skip)
        if let Some(content) = entry
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
        {
            return is_warmup_user_content(content);
        }

        // Array content or missing content - don't skip
        false
    } else {
        // Assistant messages are checked after content extraction in the caller
        // because we need the full extracted text, not just the raw JSON
        false
    }
}

/// Extract the string content from a user message entry, if it's a simple string.
///
/// Returns `None` if the content is an array (like tool results) or missing.
pub fn get_user_string_content(entry: &Value) -> Option<String> {
    entry
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(String::from)
}

/// Delete a warmup-only session and its associated files.
///
/// This removes:
/// - The session JSONL file
/// - Any associated tool results directory (same name as session ID)
/// - The entry from sessions-index.json (if it exists)
///
/// # Arguments
/// * `session_file` - Path to the session JSONL file
/// * `session_id` - The session ID (used for tool results dir and index cleanup)
/// * `project_dir` - The project directory containing the session
///
/// # Returns
/// * `true` if the session was successfully deleted
/// * `false` if deletion failed (file not found, permission error, etc.)
pub fn cleanup_warmup_session(session_file: &Path, session_id: &str, project_dir: &Path) -> bool {
    // Delete the session JSONL file
    if let Err(e) = fs::remove_file(session_file) {
        cmd_debug_log(
            "WARMUP_CLEANUP",
            &format!("Failed to delete session file {:?}: {}", session_file, e),
        );
        return false;
    }

    // Delete any associated tool results directory
    let tool_results_dir = project_dir.join(session_id);
    if tool_results_dir.exists() && tool_results_dir.is_dir() {
        let _ = fs::remove_dir_all(&tool_results_dir);
    }

    // Update sessions-index.json if it exists
    let index_path = project_dir.join("sessions-index.json");
    if index_path.exists() {
        if let Ok(content) = fs::read_to_string(&index_path) {
            if let Ok(mut index) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(entries) = index.get_mut("entries").and_then(|e| e.as_array_mut()) {
                    entries.retain(|entry| {
                        entry
                            .get("sessionId")
                            .and_then(|id| id.as_str())
                            .map(|id| id != session_id)
                            .unwrap_or(true)
                    });
                    if let Ok(updated) = serde_json::to_string_pretty(&index) {
                        let _ = fs::write(&index_path, updated);
                    }
                }
            }
        }
    }

    cmd_debug_log(
        "WARMUP_CLEANUP",
        &format!("Deleted warmup-only session: {}", session_id),
    );
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slash_commands_are_warmup() {
        assert!(is_warmup_user_content("/status"));
        assert!(is_warmup_user_content("/help"));
        assert!(is_warmup_user_content("/compact"));
    }

    #[test]
    fn test_unknown_skill_is_warmup() {
        assert!(is_warmup_user_content("Unknown slash command: /foo"));
        assert!(is_warmup_user_content("Unknown skill: bar"));
    }

    #[test]
    fn test_regular_content_not_warmup() {
        assert!(!is_warmup_user_content("Hello, how are you?"));
        assert!(!is_warmup_user_content("Fix the bug in main.rs"));
    }

    #[test]
    fn test_no_response_is_warmup() {
        assert!(is_warmup_assistant_content("No response requested."));
        assert!(is_warmup_assistant_content("  No response requested.  "));
    }

    #[test]
    fn test_regular_assistant_content_not_warmup() {
        assert!(!is_warmup_assistant_content("Here's the answer"));
        assert!(!is_warmup_assistant_content("I can help with that."));
    }

    #[test]
    fn test_is_meaningful_user_message() {
        assert!(is_meaningful_message("user", "Hello", false));
        assert!(is_meaningful_message("user", "Fix the bug", false));
    }

    #[test]
    fn test_slash_command_not_meaningful() {
        assert!(!is_meaningful_message("user", "/status", false));
        assert!(!is_meaningful_message("user", "/help", false));
    }

    #[test]
    fn test_meta_message_not_meaningful() {
        assert!(!is_meaningful_message("user", "Hello", true));
        assert!(!is_meaningful_message("user", "Any content", true));
    }

    #[test]
    fn test_is_meaningful_assistant_message() {
        assert!(is_meaningful_message("assistant", "Here's the answer", false));
        assert!(is_meaningful_message("assistant", "I can help", false));
    }

    #[test]
    fn test_no_response_assistant_not_meaningful() {
        assert!(!is_meaningful_message(
            "assistant",
            "No response requested.",
            false
        ));
    }

    #[test]
    fn test_unknown_role_not_meaningful() {
        assert!(!is_meaningful_message("system", "Content", false));
        assert!(!is_meaningful_message("tool", "Content", false));
    }

    #[test]
    fn test_should_skip_entry_meta_message() {
        let entry: Value = serde_json::json!({
            "type": "user",
            "isMeta": true,
            "message": {"content": "Caveat: The messages below..."}
        });
        assert!(should_skip_entry(&entry, "user"));
    }

    #[test]
    fn test_should_skip_entry_slash_command() {
        let entry: Value = serde_json::json!({
            "type": "user",
            "message": {"content": "/status"}
        });
        assert!(should_skip_entry(&entry, "user"));
    }

    #[test]
    fn test_should_skip_entry_regular_message() {
        let entry: Value = serde_json::json!({
            "type": "user",
            "message": {"content": "Hello, how are you?"}
        });
        assert!(!should_skip_entry(&entry, "user"));
    }

    #[test]
    fn test_should_skip_entry_array_content() {
        // Array content (like tool results) should NOT be skipped
        let entry: Value = serde_json::json!({
            "type": "user",
            "message": {"content": [{"type": "tool_result", "content": "result"}]}
        });
        assert!(!should_skip_entry(&entry, "user"));
    }

    #[test]
    fn test_should_skip_entry_assistant() {
        // Assistant messages are not checked by should_skip_entry
        // (they're checked after content extraction)
        let entry: Value = serde_json::json!({
            "type": "assistant",
            "message": {"content": "No response requested."}
        });
        assert!(!should_skip_entry(&entry, "assistant"));
    }

    #[test]
    fn test_get_user_string_content() {
        let entry: Value = serde_json::json!({
            "type": "user",
            "message": {"content": "Hello world"}
        });
        assert_eq!(get_user_string_content(&entry), Some("Hello world".to_string()));
    }

    #[test]
    fn test_get_user_string_content_array() {
        let entry: Value = serde_json::json!({
            "type": "user",
            "message": {"content": [{"type": "text", "text": "Hello"}]}
        });
        assert_eq!(get_user_string_content(&entry), None);
    }
}
