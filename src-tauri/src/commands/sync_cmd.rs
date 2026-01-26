//! CCMS sync commands for syncing ~/.claude/ between machines

use super::cmd_debug_log;
use crate::sync::{self, SyncResult};

/// Pull latest ~/.claude/ from remote machine
/// Called on app startup to get latest session data
#[tauri::command]
pub async fn sync_pull() -> Result<SyncResult, String> {
    cmd_debug_log("SYNC", "sync_pull called");

    let result = tokio::task::spawn_blocking(sync::ccms_pull)
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    cmd_debug_log(
        "SYNC",
        &format!("sync_pull result: success={}", result.success),
    );
    Ok(result)
}

/// Push local ~/.claude/ to remote machine
/// Called periodically during work and on app close
#[tauri::command]
pub async fn sync_push() -> Result<SyncResult, String> {
    cmd_debug_log("SYNC", "sync_push called");

    let result = tokio::task::spawn_blocking(sync::ccms_push)
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    cmd_debug_log(
        "SYNC",
        &format!("sync_push result: success={}", result.success),
    );
    Ok(result)
}

/// Get sync status (dry-run showing what would change)
#[tauri::command]
pub async fn sync_status() -> Result<SyncResult, String> {
    cmd_debug_log("SYNC", "sync_status called");

    let result = tokio::task::spawn_blocking(sync::ccms_status)
        .await
        .map_err(|e| format!("Task join error: {}", e))?;

    Ok(result)
}

/// Check if sync is available (ccms installed and configured)
#[tauri::command]
pub fn is_sync_available() -> bool {
    sync::is_ccms_configured()
}
