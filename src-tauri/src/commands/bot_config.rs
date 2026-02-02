use crate::llm_reviewer::validate_api_key;
use std::fs;
use std::path::PathBuf;
use tauri::State;

use super::AppState;

/// Get the path to the .env file for the current working directory
fn get_env_path(working_dir: &str) -> PathBuf {
    PathBuf::from(working_dir).join(".env")
}

/// Read the Bot API key from .env file
/// Returns a masked version for display (e.g., "sk-ant-***...***")
#[tauri::command]
pub fn get_bot_api_key(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let env_path = get_env_path(&state.launch_dir);
    if !env_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env file: {}", e))?;

    // Parse .env file looking for ANTHROPIC_API_KEY
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with("ANTHROPIC_API_KEY=") {
            let key = line.strip_prefix("ANTHROPIC_API_KEY=").unwrap_or("");
            // Remove quotes if present
            let key = key.trim_matches('"').trim_matches('\'');
            if key.is_empty() {
                return Ok(None);
            }
            // Return masked version
            return Ok(Some(mask_api_key(key)));
        }
    }

    Ok(None)
}

/// Check if a Bot API key is configured (without returning the actual key)
#[tauri::command]
pub fn has_bot_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    let env_path = get_env_path(&state.launch_dir);
    if !env_path.exists() {
        return Ok(false);
    }

    let contents = fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env file: {}", e))?;

    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with("ANTHROPIC_API_KEY=") {
            let key = line.strip_prefix("ANTHROPIC_API_KEY=").unwrap_or("");
            let key = key.trim_matches('"').trim_matches('\'');
            return Ok(!key.is_empty());
        }
    }

    Ok(false)
}

/// Get the raw API key (for internal use only, not exposed to frontend)
pub fn get_raw_api_key(working_dir: &str) -> Option<String> {
    let env_path = get_env_path(working_dir);
    if !env_path.exists() {
        return None;
    }

    let contents = fs::read_to_string(&env_path).ok()?;

    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with("ANTHROPIC_API_KEY=") {
            let key = line.strip_prefix("ANTHROPIC_API_KEY=").unwrap_or("");
            let key = key.trim_matches('"').trim_matches('\'');
            if !key.is_empty() {
                return Some(key.to_string());
            }
        }
    }

    None
}

/// Set the Bot API key in .env file
#[tauri::command]
pub async fn set_bot_api_key(
    api_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let env_path = get_env_path(&state.launch_dir);

    // Read existing .env file or start fresh
    let mut lines: Vec<String> = if env_path.exists() {
        fs::read_to_string(&env_path)
            .map_err(|e| format!("Failed to read .env file: {}", e))?
            .lines()
            .map(|s| s.to_string())
            .collect()
    } else {
        Vec::new()
    };

    // Find and replace or add ANTHROPIC_API_KEY
    let key_line = format!("ANTHROPIC_API_KEY={}", api_key);
    let mut found = false;
    for line in &mut lines {
        if line.trim().starts_with("ANTHROPIC_API_KEY=") {
            *line = key_line.clone();
            found = true;
            break;
        }
    }

    if !found {
        lines.push(key_line);
    }

    // Write back to .env file
    let contents = lines.join("\n");
    fs::write(&env_path, contents)
        .map_err(|e| format!("Failed to write .env file: {}", e))?;

    Ok(())
}

/// Validate the Bot API key by making a test API call
#[tauri::command]
pub async fn validate_bot_api_key(state: State<'_, AppState>) -> Result<bool, String> {
    let api_key = get_raw_api_key(&state.launch_dir)
        .ok_or("No API key configured")?;

    validate_api_key(&api_key).await
}

/// Mask an API key for display
fn mask_api_key(key: &str) -> String {
    if key.len() <= 12 {
        return "*".repeat(key.len());
    }
    let prefix = &key[..8];
    let suffix = &key[key.len() - 4..];
    format!("{}...{}", prefix, suffix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mask_api_key_long() {
        let masked = mask_api_key("sk-ant-api03-abcdefghijklmnop");
        assert_eq!(masked, "sk-ant-a...mnop");
    }

    #[test]
    fn test_mask_api_key_short() {
        let masked = mask_api_key("short");
        assert_eq!(masked, "*****");
    }
}
