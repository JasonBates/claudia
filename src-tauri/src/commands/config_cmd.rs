//! Configuration management commands

use tauri::State;

use super::AppState;
use crate::config::Config;

/// Get the current configuration (loads from appropriate path based on launch_dir)
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    // Load fresh from disk to pick up any external changes
    let working_dir = &state.launch_dir;
    Config::load(Some(working_dir))
}

/// Save a new configuration
/// If save_locally is true, saves to {launch_dir}/.claudia/config.json
/// Otherwise saves to the current config location (local if exists, else global)
#[tauri::command]
pub async fn save_config(
    config: Config,
    save_locally: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let working_dir = &state.launch_dir;

    if save_locally {
        config.save_local(working_dir)?;
    } else {
        config.save(Some(working_dir))?;
    }

    // Update in-memory cache
    let mut config_guard = state.config.lock().await;
    *config_guard = config;
    Ok(())
}

/// Check if a local config exists for the current directory
#[tauri::command]
pub async fn has_local_config(state: State<'_, AppState>) -> Result<bool, String> {
    let local_path = Config::local_path(&state.launch_dir);
    Ok(local_path.exists())
}
