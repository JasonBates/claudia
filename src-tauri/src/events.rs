use serde::Serialize;

/// Events sent from Rust backend to frontend via Tauri channels
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClaudeEvent {
    /// Bridge status message
    Status { message: String },

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

    /// Tool invocation started
    ToolStart { id: String, name: String },

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

    /// Tool execution result
    ToolResult {
        stdout: Option<String>,
        stderr: Option<String>,
        is_error: bool,
    },

    /// Content block ended
    BlockEnd,

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

    /// Process closed
    Closed { code: i32 },

    /// Error occurred
    Error { message: String },
}
