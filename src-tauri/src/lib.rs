mod claude_process;
mod commands;
mod config;
mod events;
mod sync;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::send_message,
            commands::stop_session,
            commands::send_interrupt,
            commands::get_config,
            commands::save_config,
            commands::is_session_active,
            commands::send_permission_response,
            commands::poll_permission_request,
            commands::respond_to_permission,
            commands::get_launch_dir,
            // Sync commands (CCMS integration)
            commands::sync_pull,
            commands::sync_push,
            commands::sync_status,
            commands::is_sync_available,
        ])
        .on_window_event(|_window, event| {
            // Sync on window close to ensure latest changes are pushed
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                eprintln!("[SYNC] Window closing, performing final sync push...");
                if sync::is_ccms_configured() {
                    let result = sync::ccms_push();
                    eprintln!("[SYNC] Final push result: success={}", result.success);
                    if let Some(err) = result.error {
                        eprintln!("[SYNC] Final push error: {}", err);
                    }
                } else {
                    eprintln!("[SYNC] ccms not configured, skipping final push");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
