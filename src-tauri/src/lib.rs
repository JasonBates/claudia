mod claude_process;
mod commands;
mod config;
pub mod error;
mod events;
pub mod response_state;
mod streaming;
mod sync;
pub mod timeouts;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Session commands
            commands::session::start_session,
            commands::session::stop_session,
            commands::session::send_interrupt,
            commands::session::is_session_active,
            commands::session::get_launch_dir,
            // Messaging
            commands::messaging::send_message,
            // Configuration
            commands::config_cmd::get_config,
            commands::config_cmd::save_config,
            // Permissions
            commands::permission::send_permission_response,
            commands::permission::poll_permission_request,
            commands::permission::respond_to_permission,
            // Sync commands (CCMS integration)
            commands::sync_cmd::sync_pull,
            commands::sync_cmd::sync_push,
            commands::sync_cmd::sync_status,
            commands::sync_cmd::is_sync_available,
            // Streaming command runner
            commands::streaming_cmd::run_streaming_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
