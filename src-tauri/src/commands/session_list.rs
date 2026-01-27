//! Session listing commands
//!
//! Scans JSONL session files directly to build the session list.
//! This is more reliable than sessions-index.json which is only updated by Claude Code CLI.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Convert a working directory path to Claude's project directory name format.
/// Example: "/Users/jasonbates/code/repos/claudia" -> "-Users-jasonbates-code-repos-claudia"
/// Example: "/Users/jasonbates/Obsidian/VAULTS/Trinity/000 Daily Notes" -> "-Users-jasonbates-Obsidian-VAULTS-Trinity-000-Daily-Notes"
fn path_to_project_dir(path: &str) -> String {
    path.replace('/', "-").replace(' ', "-")
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

/// Maximum number of sessions to display (for performance)
const MAX_SESSIONS: usize = 20;

/// Synchronous implementation of session listing
/// Scans JSONL files directly instead of relying on sessions-index.json
fn list_sessions_sync(working_dir: &str) -> Result<Vec<SessionEntry>, String> {
    let projects_dir = get_claude_projects_dir()?;
    let project_dir_name = path_to_project_dir(working_dir);
    let project_dir = projects_dir.join(&project_dir_name);

    cmd_debug_log(
        "SESSION_LIST",
        &format!("Scanning JSONL files in: {:?}", project_dir),
    );

    // If the project directory doesn't exist, return empty list
    if !project_dir.exists() {
        cmd_debug_log("SESSION_LIST", "Project directory not found, returning empty list");
        return Ok(Vec::new());
    }

    // Collect JSONL files with their modification times
    let mut files: Vec<(PathBuf, SystemTime)> = Vec::new();

    let entries = fs::read_dir(&project_dir)
        .map_err(|e| format!("Failed to read project directory: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();

        // Only process .jsonl files, skip agent-* files (sidechains)
        if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            let filename = path.file_stem().unwrap_or_default().to_string_lossy();
            if filename.starts_with("agent-") {
                continue;
            }

            if let Ok(metadata) = entry.metadata() {
                // Skip empty files (0 bytes) - these are placeholders
                if metadata.len() == 0 {
                    continue;
                }
                if let Ok(mtime) = metadata.modified() {
                    files.push((path, mtime));
                }
            }
        }
    }

    cmd_debug_log(
        "SESSION_LIST",
        &format!("Found {} JSONL files", files.len()),
    );

    // Sort by modification time descending (newest first)
    files.sort_by(|a, b| b.1.cmp(&a.1));

    // Only parse the MAX_SESSIONS most recent files
    let mut sessions: Vec<SessionEntry> = Vec::new();
    for (path, _) in files.into_iter().take(MAX_SESSIONS) {
        match parse_session_file(&path, working_dir) {
            Ok(session) => {
                // Filter out sidechains and empty sessions
                if !session.is_sidechain && session.message_count > 0 {
                    sessions.push(session);
                }
            }
            Err(e) => {
                cmd_debug_log(
                    "SESSION_LIST",
                    &format!("Skipping {:?}: {}", path, e),
                );
            }
        }
    }

    // Re-sort by parsed modified timestamp (more accurate than file mtime)
    sessions.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(sessions)
}

/// Parse a session JSONL file to extract metadata
fn parse_session_file(path: &Path, working_dir: &str) -> Result<SessionEntry, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;
    let metadata = file.metadata()
        .map_err(|e| format!("Failed to get metadata: {}", e))?;
    let reader = BufReader::new(file);

    // Read all lines (we need first, last, and count)
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    if lines.is_empty() {
        return Err("Empty file".to_string());
    }

    // Extract session ID from filename
    let session_id = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Parse lines to extract metadata
    let mut first_prompt = String::new();
    let mut created = String::new();
    let mut is_sidechain = false;
    let mut message_count: u32 = 0;

    for line in &lines {
        if let Ok(entry) = serde_json::from_str::<Value>(line) {
            // Check if sidechain (any line with isSidechain=true means it's a sidechain)
            if entry.get("isSidechain").and_then(|v| v.as_bool()).unwrap_or(false) {
                is_sidechain = true;
            }

            let entry_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");

            // Count user and assistant messages
            if entry_type == "user" || entry_type == "assistant" {
                message_count += 1;
            }

            // Get first user message for firstPrompt and created timestamp
            // Skip meta messages (isMeta: true) and slash commands (like /status)
            if entry_type == "user" && first_prompt.is_empty() {
                // Skip meta messages (like "Caveat: The messages below...")
                let is_meta = entry.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
                if is_meta {
                    continue;
                }

                let content = entry
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");

                // Skip noise messages that aren't meaningful session titles:
                // - Slash commands (like "/status" warmup)
                // - Claude's error responses to slash commands
                if content.starts_with('/') || content.starts_with("Unknown slash command") {
                    continue;
                }

                first_prompt = content.to_string();
                created = entry
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
            }
        }
    }

    // Get modified timestamp from last line
    let modified = lines
        .last()
        .and_then(|line| serde_json::from_str::<Value>(line).ok())
        .and_then(|entry| entry.get("timestamp").and_then(|t| t.as_str().map(String::from)))
        .unwrap_or_else(|| created.clone());

    // Get file modification time
    let file_mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(SessionEntry {
        session_id,
        full_path: path.to_string_lossy().to_string(),
        file_mtime,
        first_prompt,
        message_count,
        created,
        modified,
        git_branch: String::new(),
        project_path: working_dir.to_string(),
        is_sidechain,
    })
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

/// A message from the session history for display
#[derive(Clone, Debug, Serialize)]
pub struct HistoryMessage {
    pub id: String,
    pub role: String,
    pub content: String,
}

/// Get the message history for a session by reading its JSONL file
#[tauri::command]
pub async fn get_session_history(
    session_id: String,
    working_dir: String,
) -> Result<Vec<HistoryMessage>, String> {
    cmd_debug_log(
        "SESSION_HISTORY",
        &format!("Getting history for session: {}", session_id),
    );

    let result = tokio::task::spawn_blocking(move || {
        get_session_history_sync(&session_id, &working_dir)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    cmd_debug_log(
        "SESSION_HISTORY",
        &format!("Found {} messages", result.len()),
    );
    Ok(result)
}

/// Synchronous implementation of session history reading
fn get_session_history_sync(session_id: &str, working_dir: &str) -> Result<Vec<HistoryMessage>, String> {
    let projects_dir = get_claude_projects_dir()?;
    let project_dir_name = path_to_project_dir(working_dir);
    let session_file = projects_dir
        .join(&project_dir_name)
        .join(format!("{}.jsonl", session_id));

    cmd_debug_log(
        "SESSION_HISTORY",
        &format!("Reading session file: {:?}", session_file),
    );

    if !session_file.exists() {
        // Session file was deleted but still in index - return empty history
        cmd_debug_log(
            "SESSION_HISTORY",
            &format!("Session file not found: {:?}, returning empty history", session_file),
        );
        return Ok(Vec::new());
    }

    let file = fs::File::open(&session_file)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);

    let mut messages: Vec<HistoryMessage> = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read line: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }

        // Parse the JSON line
        let entry: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue, // Skip unparseable lines
        };

        // Only process "user" and "assistant" type entries
        let entry_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if entry_type != "user" && entry_type != "assistant" {
            continue;
        }

        // Skip noise messages (warmup commands and Claude SDK meta messages)
        if entry_type == "user" {
            // Skip meta messages (like "Caveat: The messages below...")
            let is_meta = entry.get("isMeta").and_then(|v| v.as_bool()).unwrap_or(false);
            if is_meta {
                continue;
            }

            // Check content for slash commands and error responses
            if let Some(content) = entry.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
            {
                if content.starts_with('/') || content.starts_with("Unknown slash command") {
                    continue;
                }
            }
        }

        // Get the message content
        let message = match entry.get("message") {
            Some(m) => m,
            None => continue,
        };

        let role = message
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string();

        // Skip if not user or assistant role
        if role != "user" && role != "assistant" {
            continue;
        }

        // Extract text content from the message
        let content = extract_text_content(message);
        if content.is_empty() {
            continue;
        }

        // Use uuid as message ID
        let id = entry
            .get("uuid")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string();

        // Avoid duplicate messages (Claude outputs multiple assistant entries for streaming)
        // Only keep messages with actual text content
        if !messages.iter().any(|m| m.id == id) {
            messages.push(HistoryMessage { id, role, content });
        }
    }

    Ok(messages)
}

/// Extract text content from a message
fn extract_text_content(message: &Value) -> String {
    let content = match message.get("content") {
        Some(c) => c,
        None => return String::new(),
    };

    // If content is a simple string
    if let Some(s) = content.as_str() {
        return s.to_string();
    }

    // If content is an array of content blocks
    if let Some(blocks) = content.as_array() {
        let text_parts: Vec<String> = blocks
            .iter()
            .filter_map(|block| {
                let block_type = block.get("type").and_then(|t| t.as_str())?;
                match block_type {
                    "text" => block.get("text").and_then(|t| t.as_str()).map(String::from),
                    _ => None, // Skip tool_use, thinking, tool_result, etc.
                }
            })
            .collect();

        return text_parts.join("\n");
    }

    String::new()
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
            path_to_project_dir("/Users/jasonbates/code/repos/claudia"),
            "-Users-jasonbates-code-repos-claudia"
        );
    }
}
