//! Typed errors for the Claude Terminal application
//!
//! Uses thiserror for derive macros that make error types that:
//! 1. Implement std::error::Error automatically
//! 2. Provide consistent, structured error messages
//! 3. Can be converted to/from other error types
//! 4. Serialize properly for Tauri's IPC layer

use thiserror::Error;

/// Main error type for Claude Terminal operations
#[derive(Error, Debug)]
pub enum ClaudeError {
    /// No active Claude session exists
    #[error("No active session. Call start_session first.")]
    NoActiveSession,

    /// Failed to spawn the Claude bridge process
    #[error("Failed to spawn bridge process: {0}")]
    ProcessSpawnFailed(#[from] std::io::Error),

    /// Tokio task join error (async task panicked or was cancelled)
    #[error("Task join error: {0}")]
    TaskJoinFailed(String),

    /// IPC channel error (failed to send event to frontend)
    #[error("Channel error: {0}")]
    ChannelError(String),

    /// JSON serialization/deserialization error
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    /// Configuration file error
    #[error("Config error: {0}")]
    ConfigError(String),

    /// Process communication error
    #[error("Process communication error: {0}")]
    ProcessCommunicationError(String),

    /// Permission response error
    #[error("Permission error: {0}")]
    PermissionError(String),

    /// Sync operation error
    #[error("Sync error: {0}")]
    SyncError(String),
}

/// Convert ClaudeError to String for Tauri commands
/// Tauri commands expect Result<T, String> or impl Into<InvokeError>
impl From<ClaudeError> for String {
    fn from(err: ClaudeError) -> Self {
        err.to_string()
    }
}

/// Helper trait for converting Result<T, E> to Result<T, ClaudeError>
pub trait ResultExt<T> {
    fn map_claude_err<F: FnOnce(String) -> ClaudeError>(self, f: F) -> Result<T, ClaudeError>;
}

impl<T, E: ToString> ResultExt<T> for Result<T, E> {
    fn map_claude_err<F: FnOnce(String) -> ClaudeError>(self, f: F) -> Result<T, ClaudeError> {
        self.map_err(|e| f(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_active_session_message() {
        let err = ClaudeError::NoActiveSession;
        assert_eq!(
            err.to_string(),
            "No active session. Call start_session first."
        );
    }

    #[test]
    fn test_process_spawn_error_conversion() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "node not found");
        let err: ClaudeError = io_err.into();
        assert!(err.to_string().contains("node not found"));
    }

    #[test]
    fn test_error_to_string_conversion() {
        let err = ClaudeError::NoActiveSession;
        let s: String = err.into();
        assert_eq!(s, "No active session. Call start_session first.");
    }

    #[test]
    fn test_channel_error() {
        let err = ClaudeError::ChannelError("receiver dropped".to_string());
        assert_eq!(err.to_string(), "Channel error: receiver dropped");
    }

    #[test]
    fn test_task_join_error() {
        let err = ClaudeError::TaskJoinFailed("task panicked".to_string());
        assert_eq!(err.to_string(), "Task join error: task panicked");
    }

    #[test]
    fn test_config_error() {
        let err = ClaudeError::ConfigError("invalid path".to_string());
        assert_eq!(err.to_string(), "Config error: invalid path");
    }

    #[test]
    fn test_sync_error() {
        let err = ClaudeError::SyncError("ccms not found".to_string());
        assert_eq!(err.to_string(), "Sync error: ccms not found");
    }
}
