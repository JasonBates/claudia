//! Tauri command handlers for the Claude Terminal application
//!
//! Commands are organized into feature-based modules:
//! - `session` - Session lifecycle (start, stop, interrupt)
//! - `messaging` - Message sending and event streaming
//! - `config_cmd` - Configuration management
//! - `permission` - Permission request handling
//! - `streaming_cmd` - External command streaming

pub mod appearance_cmd;
pub mod config_cmd;
pub mod directory_cmd;
pub mod messaging;
pub mod permission;
pub mod secure_ipc;
pub mod session;
pub mod session_list;
pub mod streaming_cmd;

use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::claude_process::{ClaudeReceiver, ClaudeSender, ProcessHandle};
use crate::config::Config;

// Note: Commands are accessed via their submodules directly (e.g., commands::session::start_session)
// rather than being re-exported here, because Tauri's generate_handler! macro
// needs the __cmd__ functions to be accessible at the original module level.

/// Shared application state managed by Tauri
pub struct AppState {
    /// Sender for writing to Claude (messages, interrupts, permission responses)
    /// Can be locked independently of receiver for responsive control commands
    pub sender: Arc<Mutex<Option<ClaudeSender>>>,

    /// Receiver for reading events from Claude (streaming responses)
    /// Can be locked independently of sender to not block writes
    pub receiver: Arc<Mutex<Option<ClaudeReceiver>>>,

    /// Process lifecycle handle (spawn, shutdown)
    /// Separate from sender/receiver for clean lifecycle management
    pub process_handle: Arc<Mutex<Option<ProcessHandle>>>,

    /// Application configuration
    pub config: Arc<Mutex<Config>>,
    /// Directory from which the app was launched
    pub launch_dir: String,
    /// Unique session ID for this app instance (used for multi-instance safety)
    pub session_id: String,
    /// Monotonic counter to detect superseded requests (prevents concurrent event loop hangs)
    pub request_generation: AtomicU64,
}

impl AppState {
    /// Create new AppState with optional CLI-provided directory
    pub fn new(cli_dir: Option<String>) -> Self {
        // Use CLI directory if provided, otherwise default to home directory
        // This ensures a predictable experience when launched from desktop/Finder
        let launch_dir = cli_dir
            .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()))
            .unwrap_or_else(|| {
                // Last resort fallback to current_dir
                std::env::current_dir()
                    .ok()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| ".".to_string())
            });

        // Load config using launch_dir to check for local config first
        let config = Config::load(Some(&launch_dir)).unwrap_or_default();

        // Generate unique session ID for multi-instance safety
        // This ensures permission files don't collide between app windows
        let session_id = uuid::Uuid::new_v4().to_string();

        Self {
            sender: Arc::new(Mutex::new(None)),
            receiver: Arc::new(Mutex::new(None)),
            process_handle: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(config)),
            launch_dir,
            session_id,
            request_generation: AtomicU64::new(0),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(None)
    }
}

/// Debug logging helper for command handlers
/// Gated behind CLAUDIA_DEBUG=1 environment variable
pub(crate) fn cmd_debug_log(prefix: &str, msg: &str) {
    static DEBUG_ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let enabled = *DEBUG_ENABLED.get_or_init(|| {
        std::env::var("CLAUDIA_DEBUG")
            .map(|v| v == "1")
            .unwrap_or(false)
    });

    if !enabled {
        return;
    }

    use std::fs::OpenOptions;
    use std::io::Write;

    let log_path = std::env::temp_dir().join("claude-commands-debug.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] [{}] {}", timestamp, prefix, msg);
    }
    #[cfg(debug_assertions)]
    eprintln!("[CMD:{}] {}", prefix, msg);
}
