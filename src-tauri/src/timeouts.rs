//! Timeout and idle count constants for Claude response handling
//!
//! The streaming event loop uses an adaptive timeout strategy:
//! 1. **Initial phase**: Short timeouts (500ms) to detect if Claude is responding
//! 2. **Streaming phase**: Medium timeouts (2s) once content starts arriving
//! 3. **Extended phase**: Long timeouts (5s) during tool execution or compaction
//!
//! Each phase also has a max idle count - the number of consecutive timeouts
//! before we assume the response is complete.

use std::time::Duration;

/// Initial timeout while waiting for first response (500ms)
/// Claude can take several seconds to start, so we poll frequently
pub const TIMEOUT_INITIAL_MS: u64 = 500;

/// Timeout once streaming has started (2s)
/// Longer pauses are expected during tool calls or thinking
pub const TIMEOUT_STREAMING_MS: u64 = 2000;

/// Extended timeout for long operations (5s)
/// Used during tool execution on server (WebSearch, etc.) and context compaction
pub const TIMEOUT_EXTENDED_MS: u64 = 5000;

/// Max idle count before first content (60 × 500ms = 30s)
/// Wait up to 30 seconds for Claude to begin responding
pub const MAX_IDLE_INITIAL: u32 = 60;

/// Max idle count during streaming (3 × 2s = 6s)
/// If no content for 6 seconds during active streaming, assume done
pub const MAX_IDLE_STREAMING: u32 = 3;

/// Max idle count during tool execution (24 × 5s = 120s = 2 min)
/// Server-side tools like WebSearch can take a while
pub const MAX_IDLE_TOOL_PENDING: u32 = 24;

/// Max idle count during compaction (30 × 5s = 150s = 2.5 min)
/// Context compaction for large conversations can take 60+ seconds
pub const MAX_IDLE_COMPACTING: u32 = 30;

// Helper functions for use with ResponseState pattern

/// Get the timeout duration for the initial phase
pub fn initial_timeout() -> Duration {
    Duration::from_millis(TIMEOUT_INITIAL_MS)
}

/// Get the timeout duration for the streaming phase
pub fn streaming_timeout() -> Duration {
    Duration::from_millis(TIMEOUT_STREAMING_MS)
}

/// Get the extended timeout duration for long operations
pub fn extended_timeout() -> Duration {
    Duration::from_millis(TIMEOUT_EXTENDED_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_timeout_is_500ms() {
        assert_eq!(TIMEOUT_INITIAL_MS, 500);
        assert_eq!(initial_timeout(), Duration::from_millis(500));
    }

    #[test]
    fn test_streaming_timeout_is_2s() {
        assert_eq!(TIMEOUT_STREAMING_MS, 2000);
        assert_eq!(streaming_timeout(), Duration::from_secs(2));
    }

    #[test]
    fn test_extended_timeout_is_5s() {
        assert_eq!(TIMEOUT_EXTENDED_MS, 5000);
        assert_eq!(extended_timeout(), Duration::from_secs(5));
    }

    #[test]
    fn test_initial_wait_is_30s() {
        // 60 polls × 500ms = 30 seconds
        let total_wait_ms = MAX_IDLE_INITIAL as u64 * TIMEOUT_INITIAL_MS;
        assert_eq!(total_wait_ms, 30_000);
    }

    #[test]
    fn test_streaming_wait_is_6s() {
        // 3 polls × 2000ms = 6 seconds
        let total_wait_ms = MAX_IDLE_STREAMING as u64 * TIMEOUT_STREAMING_MS;
        assert_eq!(total_wait_ms, 6_000);
    }

    #[test]
    fn test_tool_pending_wait_is_2min() {
        // 24 polls × 5000ms = 120 seconds = 2 minutes
        let total_wait_ms = MAX_IDLE_TOOL_PENDING as u64 * TIMEOUT_EXTENDED_MS;
        assert_eq!(total_wait_ms, 120_000);
    }

    #[test]
    fn test_compaction_wait_is_2_5min() {
        // 30 polls × 5000ms = 150 seconds = 2.5 minutes
        let total_wait_ms = MAX_IDLE_COMPACTING as u64 * TIMEOUT_EXTENDED_MS;
        assert_eq!(total_wait_ms, 150_000);
    }
}
