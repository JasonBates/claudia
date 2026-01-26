//! Tauri command handlers for the Claude Terminal application
//!
//! Commands are organized into feature-based modules:
//! - `session` - Session lifecycle (start, stop, interrupt)
//! - `messaging` - Message sending and event streaming
//! - `config_cmd` - Configuration management
//! - `permission` - Permission request handling
//! - `sync_cmd` - CCMS sync operations
//! - `streaming_cmd` - External command streaming

pub mod config_cmd;
pub mod messaging;
pub mod permission;
pub mod session;
pub mod streaming_cmd;
pub mod sync_cmd;

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::claude_process::ClaudeProcess;
use crate::config::Config;

// Note: Commands are accessed via their submodules directly (e.g., commands::session::start_session)
// rather than being re-exported here, because Tauri's generate_handler! macro
// needs the __cmd__ functions to be accessible at the original module level.

/// Shared application state managed by Tauri
pub struct AppState {
    /// The active Claude process (if any)
    pub process: Arc<Mutex<Option<ClaudeProcess>>>,
    /// Application configuration
    pub config: Arc<Mutex<Config>>,
    /// Directory from which the app was launched
    pub launch_dir: String,
}

impl AppState {
    /// Create new AppState with optional CLI-provided directory
    pub fn new(cli_dir: Option<String>) -> Self {
        let config = Config::load().unwrap_or_default();
        // Use CLI directory if provided, otherwise fall back to current_dir
        let launch_dir = cli_dir
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|p| p.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| ".".to_string());
        Self {
            process: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(config)),
            launch_dir,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(None)
    }
}

/// Debug logging helper for command handlers
pub(crate) fn cmd_debug_log(prefix: &str, msg: &str) {
    use std::fs::OpenOptions;
    use std::io::Write;

    let log_path = std::env::temp_dir().join("claude-commands-debug.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] [{}] {}", timestamp, prefix, msg);
    }
    eprintln!("[CMD:{}] {}", prefix, msg);
}
