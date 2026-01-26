//! Session listing commands
//!
//! Reads Claude Code's sessions-index.json to list available sessions.
//! This is much faster than parsing JSONL files directly since Claude Code
//! maintains the index with all metadata pre-computed.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use super::cmd_debug_log;

/// A session entry from Claude Code's sessions-index.json
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionEntry {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "fullPath")]
    pub full_path: String,
    #[serde(rename = "fileMtime")]
    pub file_mtime: u64,
    #[serde(rename = "firstPrompt")]
    pub first_prompt: String,
    #[serde(rename = "messageCount")]
    pub message_count: u32,
    pub created: String,
    pub modified: String,
    #[serde(rename = "gitBranch")]
    pub git_branch: String,
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(rename = "isSidechain")]
    pub is_sidechain: bool,
}

/// The sessions-index.json file structure
#[derive(Clone, Debug, Deserialize)]
struct SessionsIndex {
    #[allow(dead_code)]
    version: u32,
    entries: Vec<SessionEntry>,
    #[allow(dead_code)]
    #[serde(rename = "originalPath")]
    original_path: String,
}

/// Convert a working directory path to Claude's project directory name format.
/// Example: "/Users/jasonbates/code/repos/claude-terminal" -> "-Users-jasonbates-code-repos-claude-terminal"
fn path_to_project_dir(path: &str) -> String {
    path.replace('/', "-")
}

/// Get the Claude projects directory (~/.claude/projects)
fn get_claude_projects_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Could not find home directory".to_string())
        .map(|home| home.join(".claude").join("projects"))
}

/// List sessions for a given working directory
#[tauri::command]
pub async fn list_sessions(working_dir: String) -> Result<Vec<SessionEntry>, String> {
    cmd_debug_log("SESSION_LIST", &format!("list_sessions called for: {}", working_dir));

    let result = tokio::task::spawn_blocking(move || {
        list_sessions_sync(&working_dir)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    cmd_debug_log("SESSION_LIST", &format!("Found {} sessions", result.len()));
    Ok(result)
}

/// Synchronous implementation of session listing
fn list_sessions_sync(working_dir: &str) -> Result<Vec<SessionEntry>, String> {
    let projects_dir = get_claude_projects_dir()?;
    let project_dir_name = path_to_project_dir(working_dir);
    let index_path = projects_dir.join(&project_dir_name).join("sessions-index.json");

    cmd_debug_log("SESSION_LIST", &format!("Looking for index at: {:?}", index_path));

    // If the index file doesn't exist, return empty list (not an error)
    if !index_path.exists() {
        cmd_debug_log("SESSION_LIST", "No sessions-index.json found, returning empty list");
        return Ok(Vec::new());
    }

    // Read and parse the index file
    let content = fs::read_to_string(&index_path)
        .map_err(|e| format!("Failed to read sessions index: {}", e))?;

    let index: SessionsIndex = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse sessions index: {}", e))?;

    // Filter out sidechains (agent sessions) and sort by modified date (newest first)
    let mut sessions: Vec<SessionEntry> = index
        .entries
        .into_iter()
        .filter(|entry| !entry.is_sidechain)
        .collect();

    // Sort by modified date descending (newest first)
    sessions.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(sessions)
}

/// Delete a session by removing its JSONL file
/// Note: This also requires updating the sessions-index.json, which Claude Code
/// may regenerate on next launch anyway.
#[tauri::command]
pub async fn delete_session(session_id: String, working_dir: String) -> Result<(), String> {
    cmd_debug_log("SESSION_DELETE", &format!("Deleting session: {}", session_id));

    tokio::task::spawn_blocking(move || {
        delete_session_sync(&session_id, &working_dir)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Synchronous implementation of session deletion
fn delete_session_sync(session_id: &str, working_dir: &str) -> Result<(), String> {
    let projects_dir = get_claude_projects_dir()?;
    let project_dir_name = path_to_project_dir(working_dir);
    let project_dir = projects_dir.join(&project_dir_name);

    // Find and delete the session file
    let session_file = project_dir.join(format!("{}.jsonl", session_id));

    if session_file.exists() {
        fs::remove_file(&session_file)
            .map_err(|e| format!("Failed to delete session file: {}", e))?;
        cmd_debug_log("SESSION_DELETE", &format!("Deleted: {:?}", session_file));
    } else {
        cmd_debug_log("SESSION_DELETE", &format!("Session file not found: {:?}", session_file));
        return Err(format!("Session file not found: {}", session_id));
    }

    // Also delete any associated tool results directory
    let tool_results_dir = project_dir.join(session_id);
    if tool_results_dir.exists() && tool_results_dir.is_dir() {
        fs::remove_dir_all(&tool_results_dir)
            .map_err(|e| format!("Failed to delete tool results directory: {}", e))?;
        cmd_debug_log("SESSION_DELETE", &format!("Deleted tool results: {:?}", tool_results_dir));
    }

    // Update the sessions-index.json to remove the deleted session
    let index_path = project_dir.join("sessions-index.json");
    if index_path.exists() {
        let content = fs::read_to_string(&index_path)
            .map_err(|e| format!("Failed to read sessions index: {}", e))?;

        let mut index: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse sessions index: {}", e))?;

        // Remove the entry from the entries array
        if let Some(entries) = index.get_mut("entries").and_then(|e| e.as_array_mut()) {
            entries.retain(|entry| {
                entry.get("sessionId")
                    .and_then(|id| id.as_str())
                    .map(|id| id != session_id)
                    .unwrap_or(true)
            });
        }

        // Write back the updated index
        let updated_content = serde_json::to_string_pretty(&index)
            .map_err(|e| format!("Failed to serialize sessions index: {}", e))?;

        fs::write(&index_path, updated_content)
            .map_err(|e| format!("Failed to write sessions index: {}", e))?;

        cmd_debug_log("SESSION_DELETE", "Updated sessions-index.json");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_to_project_dir() {
        assert_eq!(
            path_to_project_dir("/Users/jasonbates"),
            "-Users-jasonbates"
        );
        assert_eq!(
            path_to_project_dir("/Users/jasonbates/code/repos/claude-terminal"),
            "-Users-jasonbates-code-repos-claude-terminal"
        );
    }
}
