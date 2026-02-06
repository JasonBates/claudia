//! Session custom names management
//!
//! Manages user-defined custom names for sessions, stored separately from
//! Claude Code's session data to avoid modifying the CLI's data structures.
//!
//! Storage: ~/.config/claudia/session-names.json

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// Session names data structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SessionNames {
    /// Map of sessionId -> custom name
    names: HashMap<String, String>,
}

/// Get the path to the session names file
fn get_session_names_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("claudia")
        .join("session-names.json")
}

/// Load session names from disk
fn load_session_names() -> SessionNames {
    let path = get_session_names_path();

    if !path.exists() {
        return SessionNames::default();
    }

    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => SessionNames::default(),
    }
}

/// Save session names to disk
fn save_session_names(names: &SessionNames) -> Result<(), String> {
    let path = get_session_names_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let contents = serde_json::to_string_pretty(names)
        .map_err(|e| format!("Failed to serialize session names: {}", e))?;

    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write session names: {}", e))
}

/// Get all session custom names
#[tauri::command]
pub fn get_session_names() -> Result<HashMap<String, String>, String> {
    let names = load_session_names();
    Ok(names.names)
}

/// Set a custom name for a session
#[tauri::command]
pub fn set_session_name(session_id: String, name: String) -> Result<(), String> {
    let mut names = load_session_names();

    if name.trim().is_empty() {
        // Empty name means remove the custom name
        names.names.remove(&session_id);
    } else {
        names.names.insert(session_id, name.trim().to_string());
    }

    save_session_names(&names)
}

/// Delete a custom name for a session
#[tauri::command]
pub fn delete_session_name(session_id: String) -> Result<(), String> {
    let mut names = load_session_names();
    names.names.remove(&session_id);
    save_session_names(&names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_names_default() {
        let names = SessionNames::default();
        assert!(names.names.is_empty());
    }

    #[test]
    fn test_session_names_serialization() {
        let mut names = SessionNames::default();
        names.names.insert("session-123".to_string(), "My Custom Name".to_string());

        let json = serde_json::to_string(&names).unwrap();
        assert!(json.contains("session-123"));
        assert!(json.contains("My Custom Name"));

        let parsed: SessionNames = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.names.get("session-123"), Some(&"My Custom Name".to_string()));
    }
}
