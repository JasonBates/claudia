use serde::Serialize;

/// Events sent from Rust backend to frontend via Tauri channels
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClaudeEvent {
    /// Bridge status message
    Status {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_compaction: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pre_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        post_tokens: Option<u64>,
    },

    /// Session ready with metadata
    Ready {
        session_id: String,
        model: String,
        tools: u32,
    },

    /// Processing user input
    Processing { prompt: String },

    /// Streaming text chunk (real-time)
    TextDelta { text: String },

    /// Thinking block started
    ThinkingStart { index: Option<u32> },

    /// Streaming thinking chunk
    ThinkingDelta { thinking: String },

    /// Tool invocation started
    ToolStart {
        id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },

    /// Subagent (Task tool) started
    SubagentStart {
        id: String,
        agent_type: String,
        description: String,
        prompt: String,
    },

    /// Subagent progress - nested tool execution
    SubagentProgress {
        subagent_id: String,
        tool_name: String,
        tool_detail: String,
        tool_count: u32,
    },

    /// Subagent completed
    SubagentEnd {
        id: String,
        agent_type: String,
        duration: u64,
        tool_count: u32,
        result: String,
    },

    /// Streaming tool input JSON
    ToolInput { json: String },

    /// Tool execution pending
    ToolPending,

    /// Permission request for tool use (control_request with can_use_tool)
    PermissionRequest {
        request_id: String,
        tool_name: String,
        tool_input: Option<serde_json::Value>,
        description: String,
    },

    /// Claude is asking the user questions (AskUserQuestion tool via control protocol)
    AskUserQuestion {
        request_id: String,
        questions: serde_json::Value,
    },

    /// Tool execution result
    ToolResult {
        tool_use_id: Option<String>,
        stdout: Option<String>,
        stderr: Option<String>,
        is_error: bool,
    },

    /// Content block ended
    BlockEnd,

    /// Real-time context size update (from message_start event)
    /// Fires at the START of each response with current token usage
    ContextUpdate {
        input_tokens: u64,
        raw_input_tokens: u64,
        cache_read: u64,
        cache_write: u64,
    },

    /// Final result with metadata
    Result {
        content: String,
        cost: f64,
        duration: u64,
        turns: u32,
        is_error: bool,
        input_tokens: u64,
        output_tokens: u64,
        cache_read: u64,
        cache_write: u64,
    },

    /// Response complete
    Done,

    /// Response was interrupted by user
    Interrupted,

    /// Process closed
    Closed { code: i32 },

    /// Error occurred
    Error { message: String },
}

/// Events for streaming command output (general-purpose)
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommandEvent {
    /// Command started
    Started { command_id: String, command: String },

    /// Line of stdout output
    Stdout { command_id: String, line: String },

    /// Line of stderr output
    Stderr { command_id: String, line: String },

    /// Command completed
    Completed {
        command_id: String,
        exit_code: i32,
        success: bool,
    },

    /// Command failed to start
    Error { command_id: String, message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== ClaudeEvent serialization ====================

    #[test]
    fn claude_event_serializes_with_snake_case_type() {
        let event = ClaudeEvent::TextDelta {
            text: "hello".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"text_delta\""));
        assert!(json.contains("\"text\":\"hello\""));
    }

    #[test]
    fn claude_event_status_skips_none_fields() {
        let event = ClaudeEvent::Status {
            message: "test".to_string(),
            is_compaction: None,
            pre_tokens: None,
            post_tokens: None,
        };
        let json = serde_json::to_string(&event).unwrap();

        // None fields should not appear in output
        assert!(!json.contains("is_compaction"));
        assert!(!json.contains("pre_tokens"));
        assert!(!json.contains("post_tokens"));
        assert!(json.contains("\"message\":\"test\""));
    }

    #[test]
    fn claude_event_status_includes_some_fields() {
        let event = ClaudeEvent::Status {
            message: "Compacted".to_string(),
            is_compaction: Some(true),
            pre_tokens: Some(100000),
            post_tokens: Some(30000),
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"is_compaction\":true"));
        assert!(json.contains("\"pre_tokens\":100000"));
        assert!(json.contains("\"post_tokens\":30000"));
    }

    #[test]
    fn claude_event_unit_variant_serializes_correctly() {
        let event = ClaudeEvent::Done;
        let json = serde_json::to_string(&event).unwrap();

        assert_eq!(json, "{\"type\":\"done\"}");
    }

    // ==================== CommandEvent serialization ====================

    #[test]
    fn command_event_started_serializes() {
        let event = CommandEvent::Started {
            command_id: "cmd_123".to_string(),
            command: "ls -la".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"started\""));
        assert!(json.contains("\"command_id\":\"cmd_123\""));
        assert!(json.contains("\"command\":\"ls -la\""));
    }

    #[test]
    fn command_event_completed_serializes() {
        let event = CommandEvent::Completed {
            command_id: "cmd_123".to_string(),
            exit_code: 0,
            success: true,
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"completed\""));
        assert!(json.contains("\"exit_code\":0"));
        assert!(json.contains("\"success\":true"));
    }

    // ==================== Subagent event serialization ====================

    #[test]
    fn subagent_start_serializes() {
        let event = ClaudeEvent::SubagentStart {
            id: "tool_123".to_string(),
            agent_type: "Explore".to_string(),
            description: "Find files".to_string(),
            prompt: "Search codebase".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"subagent_start\""));
        assert!(json.contains("\"id\":\"tool_123\""));
        assert!(json.contains("\"agent_type\":\"Explore\""));
    }

    #[test]
    fn subagent_progress_serializes() {
        let event = ClaudeEvent::SubagentProgress {
            subagent_id: "tool_123".to_string(),
            tool_name: "Glob".to_string(),
            tool_detail: "**/*.ts".to_string(),
            tool_count: 5,
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"subagent_progress\""));
        assert!(json.contains("\"subagent_id\":\"tool_123\""));
        assert!(json.contains("\"tool_name\":\"Glob\""));
        assert!(json.contains("\"tool_detail\":\"**/*.ts\""));
        assert!(json.contains("\"tool_count\":5"));
    }

    #[test]
    fn subagent_end_serializes() {
        let event = ClaudeEvent::SubagentEnd {
            id: "tool_123".to_string(),
            agent_type: "Explore".to_string(),
            duration: 5000,
            tool_count: 7,
            result: "Found files".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"subagent_end\""));
        assert!(json.contains("\"duration\":5000"));
        assert!(json.contains("\"tool_count\":7"));
    }

    #[test]
    fn tool_start_with_parent_serializes() {
        let event = ClaudeEvent::ToolStart {
            id: "tool_456".to_string(),
            name: "Glob".to_string(),
            parent_tool_use_id: Some("tool_123".to_string()),
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"tool_start\""));
        assert!(json.contains("\"parent_tool_use_id\":\"tool_123\""));
    }

    #[test]
    fn tool_start_without_parent_skips_field() {
        let event = ClaudeEvent::ToolStart {
            id: "tool_456".to_string(),
            name: "Glob".to_string(),
            parent_tool_use_id: None,
        };
        let json = serde_json::to_string(&event).unwrap();

        assert!(json.contains("\"type\":\"tool_start\""));
        // None field should be omitted
        assert!(!json.contains("parent_tool_use_id"));
    }
}
