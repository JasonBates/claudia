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
use config::Config;
use tauri::Manager;
use tauri_plugin_cli::CliExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_cli::init())
        .setup(|app| {
            // Parse CLI arguments to get optional directory
            let cli_dir = app
                .cli()
                .matches()
                .ok()
                .and_then(|matches| {
                    matches
                        .args
                        .get("directory")
                        .and_then(|arg| arg.value.as_str().map(|s| s.to_string()))
                });

            // Create and manage AppState with CLI directory
            let state = AppState::new(cli_dir.clone());
            app.manage(state);

            // Apply saved window size from config
            if let Some(window) = app.get_webview_window("main") {
                let launch_dir = cli_dir.or_else(|| {
                    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
                });
                if let Ok(config) = Config::load(launch_dir.as_deref()) {
                    if let (Some(width), Some(height)) = (config.window_width, config.window_height) {
                        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                            width,
                            height,
                        }));
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Session commands
            commands::session::start_session,
            commands::session::stop_session,
            commands::session::send_interrupt,
            commands::session::is_session_active,
            commands::session::get_launch_dir,
            commands::session::clear_session,
            commands::session::resume_session,
            // Messaging
            commands::messaging::send_message,
            // Configuration
            commands::config_cmd::get_config,
            commands::config_cmd::save_config,
            commands::config_cmd::has_local_config,
            commands::config_cmd::save_window_size,
            // Permissions
            commands::permission::send_permission_response,
            commands::permission::poll_permission_request,
            commands::permission::respond_to_permission,
            commands::permission::get_session_id,
            // Sync commands (CCMS integration)
            commands::sync_cmd::sync_pull,
            commands::sync_cmd::sync_push,
            commands::sync_cmd::sync_status,
            commands::sync_cmd::is_sync_available,
            // Streaming command runner
            commands::streaming_cmd::run_streaming_command,
            // Session listing (for sidebar)
            commands::session_list::list_sessions,
            commands::session_list::delete_session,
            commands::session_list::get_session_history,
            // Appearance commands
            commands::appearance_cmd::list_color_schemes,
            commands::appearance_cmd::get_scheme_colors,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
