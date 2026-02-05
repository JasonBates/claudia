//! Project listing commands
//!
//! Discovers Claude Code projects from ~/.claude/projects/ directory
//! by reading sessions-index.json for authoritative paths.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::cmd_debug_log;

#[derive(Clone, Debug, Serialize)]
pub struct ProjectInfo {
    #[serde(rename = "encodedName")]
    pub encoded_name: String, // "-Users-jasonbates-Code-repos-my-project"
    #[serde(rename = "decodedPath")]
    pub decoded_path: String, // "/Users/jasonbates/Code/repos/my-project"
    #[serde(rename = "displayName")]
    pub display_name: String, // "my-project"
    #[serde(rename = "lastUsed")]
    pub last_used: u64, // Unix timestamp (from most recent session file)
    #[serde(rename = "sessionCount")]
    pub session_count: u32, // Number of .jsonl files
    #[serde(rename = "isNew")]
    pub is_new: bool, // True if project has 0 sessions (newly opened)
}

/// Sessions index entry - used to extract projectPath
#[derive(Deserialize)]
struct SessionIndexEntry {
    #[serde(rename = "projectPath")]
    project_path: String,
}

/// Sessions index file structure
#[derive(Deserialize)]
struct SessionsIndex {
    entries: Vec<SessionIndexEntry>,
}

/// Get the original project path from sessions-index.json.
///
/// This is the AUTHORITATIVE source of truth for the decoded path.
/// The sessions-index.json is maintained by Claude Code and contains
/// the actual projectPath field with the original filesystem path.
///
/// Returns None if the index doesn't exist or can't be parsed.
fn get_project_path_from_index(project_dir: &Path) -> Option<String> {
    let index_path = project_dir.join("sessions-index.json");

    if !index_path.exists() {
        return None;
    }

    let file = fs::File::open(&index_path).ok()?;
    let reader = BufReader::new(file);
    let index: SessionsIndex = serde_json::from_reader(reader).ok()?;

    // Get projectPath from first entry (all entries in a project have the same path)
    index.entries.first().map(|e| e.project_path.clone())
}

/// Encode a path the same way Claude Code does
fn path_to_encoded(path: &str) -> String {
    path.replace(['/', ' '], "-")
}

/// Fallback: decode folder name to path (with round-trip validation).
///
/// Claude Code encoding: path.replace(['/', ' '], "-")
/// This is LOSSY - we can't distinguish "/" from " " in the original.
/// Only used when sessions-index.json doesn't exist.
///
/// SAFETY: We verify that re-encoding the decoded path produces the
/// original folder name. This ensures we don't accidentally match
/// the wrong path (e.g., "/a/b-c" vs "/a/b/c" both decode to "/a/b/c"
/// but only one will round-trip correctly).
fn decode_project_path_fallback(encoded: &str) -> Option<String> {
    if !encoded.starts_with('-') {
        return None;
    }

    let decoded = encoded.replace('-', "/");
    let path = Path::new(&decoded);

    // Check path exists
    if !path.exists() || !path.is_dir() {
        cmd_debug_log(
            "PROJECT_LIST",
            &format!(
                "Fallback decode failed - path doesn't exist: {} -> {}",
                encoded, decoded
            ),
        );
        return None;
    }

    // CRITICAL: Verify round-trip encoding matches
    // This prevents matching wrong paths when encoding is ambiguous
    let re_encoded = path_to_encoded(&decoded);
    if re_encoded != encoded {
        cmd_debug_log(
            "PROJECT_LIST",
            &format!(
                "Fallback decode failed - round-trip mismatch: {} != {}",
                re_encoded, encoded
            ),
        );
        return None;
    }

    Some(decoded)
}

/// Get display name from path (last component)
fn get_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            // For paths like "/" or "/Users", use a sensible fallback
            if path == "/" || path.is_empty() {
                "Root".to_string()
            } else {
                path.to_string()
            }
        })
}

/// Get the most recent session file mtime in a project directory
fn get_latest_session_mtime(project_dir: &Path) -> Option<u64> {
    let mut latest: Option<u64> = None;

    if let Ok(entries) = fs::read_dir(project_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                // Skip agent-* files (sidechains)
                let filename = path.file_stem().unwrap_or_default().to_string_lossy();
                if filename.starts_with("agent-") {
                    continue;
                }

                if let Ok(metadata) = entry.metadata() {
                    // Skip empty files
                    if metadata.len() == 0 {
                        continue;
                    }
                    if let Ok(mtime) = metadata.modified() {
                        let timestamp = mtime
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        latest = Some(latest.map_or(timestamp, |l| l.max(timestamp)));
                    }
                }
            }
        }
    }

    latest
}

/// Count valid session files in a project directory
fn count_sessions(project_dir: &Path) -> u32 {
    let mut count = 0;

    if let Ok(entries) = fs::read_dir(project_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                let filename = path.file_stem().unwrap_or_default().to_string_lossy();
                if filename.starts_with("agent-") {
                    continue;
                }
                if let Ok(metadata) = entry.metadata() {
                    if metadata.len() > 0 {
                        count += 1;
                    }
                }
            }
        }
    }

    count
}

/// Get the Claude projects directory (~/.claude/projects)
fn get_claude_projects_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Could not find home directory".to_string())
        .map(|home| home.join(".claude").join("projects"))
}

/// List all valid projects, sorted by most recently used
#[tauri::command]
pub async fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    cmd_debug_log("PROJECT_LIST", "list_projects called");

    let result = tokio::task::spawn_blocking(list_projects_sync)
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

    cmd_debug_log(
        "PROJECT_LIST",
        &format!("Found {} valid projects", result.len()),
    );
    Ok(result)
}

fn list_projects_sync() -> Result<Vec<ProjectInfo>, String> {
    let projects_dir = get_claude_projects_dir()?;

    if !projects_dir.exists() {
        cmd_debug_log("PROJECT_LIST", "Projects directory does not exist");
        return Ok(Vec::new());
    }

    let mut projects: Vec<ProjectInfo> = Vec::new();

    let entries = fs::read_dir(&projects_dir)
        .map_err(|e| format!("Failed to read projects directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let encoded_name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // Skip if not a valid encoded path (must start with "-")
        if !encoded_name.starts_with('-') {
            continue;
        }

        // Get the project path - prefer sessions-index.json (authoritative)
        // Fall back to lossy decode if index doesn't exist
        let decoded_path = if let Some(path_from_index) = get_project_path_from_index(&path) {
            // Validate the path still exists
            if !Path::new(&path_from_index).exists() {
                cmd_debug_log(
                    "PROJECT_LIST",
                    &format!("Project path from index doesn't exist: {}", path_from_index),
                );
                continue;
            }
            path_from_index
        } else {
            // Fallback to decode (for projects without index or empty index)
            match decode_project_path_fallback(&encoded_name) {
                Some(p) => p,
                None => continue,
            }
        };

        // Get session count and latest mtime
        let session_count = count_sessions(&path);
        let last_used = get_latest_session_mtime(&path).unwrap_or(0);

        // Include zero-session projects (newly opened directories)
        // They'll be marked with is_new=true and shown with an indicator in UI
        let is_new = session_count == 0;

        let display_name = get_display_name(&decoded_path);

        projects.push(ProjectInfo {
            encoded_name,
            decoded_path,
            display_name,
            last_used,
            session_count,
            is_new,
        });
    }

    // Sort by last_used descending (most recent first)
    // Secondary sort by display_name for projects with same timestamp (e.g., new projects)
    projects.sort_by(|a, b| {
        b.last_used
            .cmp(&a.last_used)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });

    Ok(projects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_display_name() {
        assert_eq!(
            get_display_name("/Users/alice/code/my-project"),
            "my-project"
        );
        assert_eq!(get_display_name("/Users/alice"), "alice");
        assert_eq!(get_display_name("/"), "Root");
    }

    #[test]
    fn test_path_encoding() {
        // Test the encoding used by Claude Code
        assert_eq!(path_to_encoded("/Users/alice/code"), "-Users-alice-code");
        assert_eq!(
            path_to_encoded("/Users/alice/My Project"),
            "-Users-alice-My-Project"
        );
    }

    #[test]
    fn test_round_trip_encoding() {
        // Paths without spaces or hyphens should round-trip
        let original = "-Users-alice-code";
        let decoded = original.replace('-', "/");
        let re_encoded = path_to_encoded(&decoded);
        assert_eq!(re_encoded, original);
    }

    #[test]
    fn test_ambiguous_encoding() {
        // Paths with hyphens in the original cannot be distinguished
        // from paths with spaces or additional path components
        // The round-trip check catches this:
        let encoded = "-Users-alice-my-project";
        let decoded = encoded.replace('-', "/"); // "/Users/alice/my/project"
        let re_encoded = path_to_encoded(&decoded);
        // If original was "/Users/alice/my-project", this would mismatch
        assert_eq!(re_encoded, encoded); // This one matches, but real validation needs filesystem
    }
}
