//! Response state machine for the Claude event loop
//!
//! Replaces the boolean flags (got_first_content, tool_pending, compacting)
//! with a single enum that makes the state explicit and testable.
//!
//! # State Transitions
//!
//! ```text
//!                    ┌────────────────────────────────────┐
//!                    │                                    │
//!                    v                                    │
//!     ┌──────────────────────┐   TextDelta/ToolStart      │
//!     │   AwaitingResponse   │ ─────────────────────────► │
//!     └──────────────────────┘                            │
//!                    │                                    │
//!                    │ ToolPending                        │
//!                    v                                    │
//!     ┌──────────────────────┐                            │
//!     │      ToolPending     │ ◄──────────────────────────┤
//!     └──────────────────────┘                            │
//!                    │                                    │
//!                    │ ToolResult/TextDelta               │
//!                    v                                    │
//!     ┌──────────────────────┐   Status("Compacting")     │
//!     │      Streaming       │ ──────────────────────────►│
//!     └──────────────────────┘                            │
//!                    ^                                    │
//!                    │ Status(is_compaction=true)         │
//!                    │                                    │
//!     ┌──────────────────────┐                            │
//!     │      Compacting      │ ◄──────────────────────────┘
//!     └──────────────────────┘
//! ```

use std::time::Duration;

use crate::events::ClaudeEvent;
use crate::timeouts::{
    extended_timeout, initial_timeout, streaming_timeout, MAX_IDLE_COMPACTING, MAX_IDLE_INITIAL,
    MAX_IDLE_STREAMING, MAX_IDLE_TOOL_PENDING,
};

/// The current state of response handling in the event loop
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ResponseState {
    /// Waiting for first content from Claude
    /// Uses short polling (500ms) with long total wait (30s)
    #[default]
    AwaitingResponse,

    /// Actively receiving content from Claude
    /// Uses medium timeouts (2s) with short idle tolerance (6s)
    Streaming,

    /// Waiting for server-side tool execution (WebSearch, etc.)
    /// Uses extended timeouts (5s) with 2 minute tolerance
    ToolPending,

    /// Waiting for context compaction to complete
    /// Uses extended timeouts (5s) with 2.5 minute tolerance
    Compacting,
}

impl ResponseState {
    /// Get the timeout duration for this state
    pub fn timeout(&self) -> Duration {
        match self {
            ResponseState::AwaitingResponse => initial_timeout(),
            ResponseState::Streaming => streaming_timeout(),
            ResponseState::ToolPending => extended_timeout(),
            ResponseState::Compacting => extended_timeout(),
        }
    }

    /// Get the maximum idle count before assuming response is done
    pub fn max_idle(&self) -> u32 {
        match self {
            ResponseState::AwaitingResponse => MAX_IDLE_INITIAL,
            ResponseState::Streaming => MAX_IDLE_STREAMING,
            ResponseState::ToolPending => MAX_IDLE_TOOL_PENDING,
            ResponseState::Compacting => MAX_IDLE_COMPACTING,
        }
    }

    /// Compute the next state based on the received event
    ///
    /// Returns the new state. Note: transitions are not always to a different state.
    pub fn transition(&self, event: &ClaudeEvent) -> Self {
        match event {
            // ToolPending event: switch to tool pending state
            ClaudeEvent::ToolPending => ResponseState::ToolPending,

            // TextDelta or ToolStart: we have content, switch to streaming
            ClaudeEvent::TextDelta { .. } | ClaudeEvent::ToolStart { .. } => {
                ResponseState::Streaming
            }

            // ToolResult: tool finished, back to streaming
            ClaudeEvent::ToolResult { .. } => ResponseState::Streaming,

            // Status events: check for compaction state changes
            ClaudeEvent::Status {
                message,
                is_compaction,
                ..
            } => {
                if message.contains("Compacting") {
                    ResponseState::Compacting
                } else if is_compaction.unwrap_or(false) || message.contains("Compacted") {
                    // Compaction finished, back to streaming (or awaiting if no content yet)
                    match self {
                        ResponseState::AwaitingResponse => ResponseState::AwaitingResponse,
                        _ => ResponseState::Streaming,
                    }
                } else {
                    // Other status messages don't change state
                    *self
                }
            }

            // Other events don't change state
            _ => *self,
        }
    }

    /// Check if this state indicates active content reception
    pub fn is_streaming(&self) -> bool {
        matches!(self, ResponseState::Streaming)
    }

    /// Check if this state is waiting for a long operation
    pub fn is_extended_wait(&self) -> bool {
        matches!(self, ResponseState::ToolPending | ResponseState::Compacting)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== Timeout tests ====================

    #[test]
    fn test_awaiting_response_timeout_is_500ms() {
        let state = ResponseState::AwaitingResponse;
        assert_eq!(state.timeout(), Duration::from_millis(500));
    }

    #[test]
    fn test_streaming_timeout_is_2s() {
        let state = ResponseState::Streaming;
        assert_eq!(state.timeout(), Duration::from_secs(2));
    }

    #[test]
    fn test_tool_pending_timeout_is_5s() {
        let state = ResponseState::ToolPending;
        assert_eq!(state.timeout(), Duration::from_secs(5));
    }

    #[test]
    fn test_compacting_timeout_is_5s() {
        let state = ResponseState::Compacting;
        assert_eq!(state.timeout(), Duration::from_secs(5));
    }

    // ==================== Max idle tests ====================

    #[test]
    fn test_awaiting_max_idle_is_60() {
        let state = ResponseState::AwaitingResponse;
        assert_eq!(state.max_idle(), 60);
    }

    #[test]
    fn test_streaming_max_idle_is_3() {
        let state = ResponseState::Streaming;
        assert_eq!(state.max_idle(), 3);
    }

    #[test]
    fn test_tool_pending_max_idle_is_24() {
        let state = ResponseState::ToolPending;
        assert_eq!(state.max_idle(), 24);
    }

    #[test]
    fn test_compacting_max_idle_is_30() {
        let state = ResponseState::Compacting;
        assert_eq!(state.max_idle(), 30);
    }

    // ==================== State transition tests ====================

    #[test]
    fn test_text_delta_transitions_to_streaming() {
        let state = ResponseState::AwaitingResponse;
        let event = ClaudeEvent::TextDelta {
            text: "hello".to_string(),
        };
        assert_eq!(state.transition(&event), ResponseState::Streaming);
    }

    #[test]
    fn test_tool_start_transitions_to_streaming() {
        let state = ResponseState::AwaitingResponse;
        let event = ClaudeEvent::ToolStart {
            id: "123".to_string(),
            name: "Bash".to_string(),
        };
        assert_eq!(state.transition(&event), ResponseState::Streaming);
    }

    #[test]
    fn test_tool_pending_transitions_to_tool_pending() {
        let state = ResponseState::Streaming;
        let event = ClaudeEvent::ToolPending;
        assert_eq!(state.transition(&event), ResponseState::ToolPending);
    }

    #[test]
    fn test_tool_result_transitions_to_streaming() {
        let state = ResponseState::ToolPending;
        let event = ClaudeEvent::ToolResult {
            tool_use_id: Some("123".to_string()),
            stdout: Some("output".to_string()),
            stderr: None,
            is_error: false,
        };
        assert_eq!(state.transition(&event), ResponseState::Streaming);
    }

    #[test]
    fn test_compacting_status_transitions_to_compacting() {
        let state = ResponseState::Streaming;
        let event = ClaudeEvent::Status {
            message: "Compacting conversation...".to_string(),
            is_compaction: None,
            pre_tokens: None,
            post_tokens: None,
        };
        assert_eq!(state.transition(&event), ResponseState::Compacting);
    }

    #[test]
    fn test_compacted_status_transitions_back_to_streaming() {
        let state = ResponseState::Compacting;
        let event = ClaudeEvent::Status {
            message: "Compacted conversation".to_string(),
            is_compaction: Some(true),
            pre_tokens: Some(100000),
            post_tokens: Some(30000),
        };
        assert_eq!(state.transition(&event), ResponseState::Streaming);
    }

    #[test]
    fn test_done_event_does_not_change_state() {
        let state = ResponseState::Streaming;
        let event = ClaudeEvent::Done;
        assert_eq!(state.transition(&event), ResponseState::Streaming);
    }

    // ==================== Helper method tests ====================

    #[test]
    fn test_is_streaming() {
        assert!(!ResponseState::AwaitingResponse.is_streaming());
        assert!(ResponseState::Streaming.is_streaming());
        assert!(!ResponseState::ToolPending.is_streaming());
        assert!(!ResponseState::Compacting.is_streaming());
    }

    #[test]
    fn test_is_extended_wait() {
        assert!(!ResponseState::AwaitingResponse.is_extended_wait());
        assert!(!ResponseState::Streaming.is_extended_wait());
        assert!(ResponseState::ToolPending.is_extended_wait());
        assert!(ResponseState::Compacting.is_extended_wait());
    }

    #[test]
    fn test_default_is_awaiting_response() {
        assert_eq!(ResponseState::default(), ResponseState::AwaitingResponse);
    }
}
