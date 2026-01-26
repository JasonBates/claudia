//! Configuration management commands

use tauri::State;

use super::AppState;
use crate::config::Config;

/// Get the current configuration
#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

/// Save a new configuration
#[tauri::command]
pub async fn save_config(config: Config, state: State<'_, AppState>) -> Result<(), String> {
    let mut config_guard = state.config.lock().await;
    config.save()?;
    *config_guard = config;
    Ok(())
}
