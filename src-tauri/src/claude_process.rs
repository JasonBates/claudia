use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::fs::OpenOptions;
use tokio::sync::mpsc;

use crate::events::ClaudeEvent;

fn rust_debug_log(prefix: &str, msg: &str) {
    use std::io::Write as IoWrite;
    let log_path = std::env::temp_dir().join("claude-rust-debug.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] [{}] {}", timestamp, prefix, msg);
    }
    eprintln!("[{}] {}", prefix, msg);
}

pub struct ClaudeProcess {
    stdin: Arc<Mutex<ChildStdin>>,
    event_rx: mpsc::Receiver<ClaudeEvent>,
    /// The child process - kept for cleanup on drop
    child: Child,
    /// Reader thread handle - joined on drop to ensure clean shutdown
    reader_handle: Option<thread::JoinHandle<()>>,
}

fn find_node_binary() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    rust_debug_log("NODE", &format!("Looking for node, home={:?}", home));

    // Check nvm versions first (most common for macOS dev)
    let nvm_dir = home.join(".nvm/versions/node");
    rust_debug_log("NODE", &format!("Checking nvm dir: {:?} exists={}", nvm_dir, nvm_dir.exists()));

    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            rust_debug_log("NODE", &format!("Found nvm versions: {:?}", versions));

            if let Some(latest) = versions.last() {
                let node_path = latest.join("bin/node");
                rust_debug_log("NODE", &format!("Checking nvm node: {:?} exists={}", node_path, node_path.exists()));
                if node_path.exists() {
                    rust_debug_log("NODE", &format!("Using nvm node: {:?}", node_path));
                    return Ok(node_path);
                }
            }
        }
    }

    // Check common absolute paths (no PATH dependency!)
    let candidates = [
        home.join(".local/bin/node"),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];

    for path in &candidates {
        rust_debug_log("NODE", &format!("Checking: {:?} exists={}", path, path.exists()));
        if path.exists() {
            rust_debug_log("NODE", &format!("Using: {:?}", path));
            return Ok(path.clone());
        }
    }

    // Don't fall back to PATH - return error instead
    rust_debug_log("NODE", "ERROR: Could not find node binary anywhere!");
    Err("Could not find node binary. Install Node.js via nvm or Homebrew.".to_string())
}

fn get_bridge_script_path() -> Result<PathBuf, String> {
    rust_debug_log("BRIDGE", "Looking for sdk-bridge-v2.mjs");

    // Priority 1: Bundled in app (production) - check this FIRST
    if let Ok(exe) = std::env::current_exe() {
        rust_debug_log("BRIDGE", &format!("Current exe: {:?}", exe));

        // Tauri bundles with _up_ prefix due to ../ in resource path
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("../Resources/_up_/sdk-bridge-v2.mjs");
            let canonical = bundled.canonicalize().ok();
            rust_debug_log("BRIDGE", &format!("Checking bundled: {:?} canonical={:?}", bundled, canonical));

            if bundled.exists() {
                rust_debug_log("BRIDGE", &format!("Using bundled: {:?}", bundled));
                return Ok(bundled);
            }

            // Also check direct Resources path
            let direct = parent.join("../Resources/sdk-bridge-v2.mjs");
            rust_debug_log("BRIDGE", &format!("Checking direct: {:?} exists={}", direct, direct.exists()));
            if direct.exists() {
                rust_debug_log("BRIDGE", &format!("Using direct: {:?}", direct));
                return Ok(direct);
            }
        }
    }

    // Priority 2: Dev mode (compile-time path from CARGO_MANIFEST_DIR)
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sdk-bridge-v2.mjs"))
        .unwrap_or_default();

    rust_debug_log("BRIDGE", &format!("Checking dev path: {:?} exists={}", dev_path, dev_path.exists()));

    if dev_path.exists() {
        rust_debug_log("BRIDGE", &format!("Using dev: {:?}", dev_path));
        return Ok(dev_path);
    }

    rust_debug_log("BRIDGE", "ERROR: Could not find sdk-bridge-v2.mjs anywhere!");
    Err("Could not find sdk-bridge-v2.mjs script".to_string())
}

impl ClaudeProcess {
    /// Spawn a new Claude process
    pub fn spawn(working_dir: &Path) -> Result<Self, String> {
        Self::spawn_with_resume(working_dir, None)
    }

    /// Spawn a Claude process, optionally resuming a previous session
    pub fn spawn_with_resume(working_dir: &Path, resume_session_id: Option<&str>) -> Result<Self, String> {
        rust_debug_log("SPAWN", &format!("Starting spawn in dir: {:?}", working_dir));
        if let Some(session_id) = resume_session_id {
            rust_debug_log("SPAWN", &format!("Resuming session: {}", session_id));
        }

        let node_path = find_node_binary().map_err(|e| {
            rust_debug_log("SPAWN_ERROR", &format!("Node binary not found: {}", e));
            e
        })?;
        rust_debug_log("SPAWN", &format!("Node path: {:?}", node_path));

        let bridge_path = get_bridge_script_path().map_err(|e| {
            rust_debug_log("SPAWN_ERROR", &format!("Bridge script not found: {}", e));
            e
        })?;
        rust_debug_log("SPAWN", &format!("Bridge path: {:?}", bridge_path));

        // Build command with optional resume session
        let mut cmd = Command::new(&node_path);
        cmd.arg("--no-warnings")
            .arg(&bridge_path)
            .current_dir(working_dir)
            .env("NODE_OPTIONS", "--no-warnings")
            .env("FORCE_COLOR", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Pass resume session ID via environment variable
        if let Some(session_id) = resume_session_id {
            cmd.env("CLAUDE_RESUME_SESSION", session_id);
        }

        // Spawn the Node.js bridge script
        let mut child = cmd.spawn()
            .map_err(|e| {
                rust_debug_log("SPAWN_ERROR", &format!("Failed: {}", e));
                format!("Failed to spawn bridge: {}", e)
            })?;

        rust_debug_log("SPAWN", "Bridge process spawned successfully");

        let stdin = child.stdin.take()
            .ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take()
            .ok_or("Failed to get stdout")?;

        let stdin = Arc::new(Mutex::new(stdin));

        // Channel for events
        let (tx, rx) = mpsc::channel::<ClaudeEvent>(100);

        // Spawn reader thread for stdout
        let reader_handle = thread::spawn(move || {
            Self::read_output(stdout, tx);
        });

        Ok(Self {
            stdin,
            event_rx: rx,
            child,
            reader_handle: Some(reader_handle),
        })
    }

    fn read_output(stdout: ChildStdout, tx: mpsc::Sender<ClaudeEvent>) {
        // Clear log on start
        let log_path = std::env::temp_dir().join("claude-rust-debug.log");
        let _ = std::fs::write(&log_path, format!("=== Rust reader started at {} ===\n", chrono::Local::now()));

        rust_debug_log("READER", "Starting read_output loop");

        // Use small buffer to reduce latency
        let reader = BufReader::with_capacity(64, stdout);

        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    rust_debug_log("ERROR", &format!("Read error: {}", e));
                    break;
                }
            };

            if line.trim().is_empty() {
                rust_debug_log("SKIP", "Empty line");
                continue;
            }

            // Truncate safely at char boundary for logging
            let truncated: String = line.chars().take(200).collect();
            rust_debug_log("RAW_LINE", &truncated);

            // Parse JSON output from the bridge
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(json) => {
                    let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
                    rust_debug_log("JSON_PARSED", &format!("type={}", msg_type));

                    if let Some(event) = Self::parse_bridge_message(&json) {
                        rust_debug_log("EVENT_CREATED", &format!("{:?}", event));
                        match tx.blocking_send(event) {
                            Ok(_) => rust_debug_log("CHANNEL_SEND", "OK"),
                            Err(e) => {
                                rust_debug_log("CHANNEL_ERROR", &format!("Send failed: {}", e));
                                break;
                            }
                        }
                    } else {
                        rust_debug_log("PARSE_FAIL", &format!("Could not parse type: {}", msg_type));
                    }
                }
                Err(e) => {
                    rust_debug_log("JSON_ERROR", &format!("Parse error: {} - line: {}", e, &line[..line.len().min(100)]));
                }
            }
        }
        rust_debug_log("READER", "Loop ended");
    }

    fn parse_bridge_message(json: &serde_json::Value) -> Option<ClaudeEvent> {
        let msg_type = json.get("type")?.as_str()?;

        match msg_type {
            "status" => {
                let message = json.get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let is_compaction = json.get("isCompaction")
                    .and_then(|v| v.as_bool());
                let pre_tokens = json.get("preTokens")
                    .and_then(|v| v.as_u64());
                let post_tokens = json.get("postTokens")
                    .and_then(|v| v.as_u64());
                Some(ClaudeEvent::Status { message, is_compaction, pre_tokens, post_tokens })
            }

            "ready" => {
                let session_id = json.get("sessionId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let model = json.get("model")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let tools = json.get("tools")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                Some(ClaudeEvent::Ready { session_id, model, tools })
            }

            "processing" => {
                let prompt = json.get("prompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(ClaudeEvent::Processing { prompt })
            }

            "text_delta" => {
                let text = json.get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if !text.is_empty() {
                    Some(ClaudeEvent::TextDelta { text })
                } else {
                    None
                }
            }

            "thinking_start" => {
                let index = json.get("index")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32);
                Some(ClaudeEvent::ThinkingStart { index })
            }

            "thinking_delta" => {
                let thinking = json.get("thinking")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(ClaudeEvent::ThinkingDelta { thinking })
            }

            "tool_start" => {
                let id = json.get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = json.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(ClaudeEvent::ToolStart { id, name })
            }

            "tool_input" => {
                let json_str = json.get("json")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(ClaudeEvent::ToolInput { json: json_str })
            }

            "tool_pending" => {
                Some(ClaudeEvent::ToolPending)
            }

            "permission_request" => {
                let request_id = json.get("requestId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let tool_name = json.get("toolName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let tool_input = json.get("toolInput").cloned();
                let description = json.get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(ClaudeEvent::PermissionRequest { request_id, tool_name, tool_input, description })
            }

            "tool_result" => {
                let tool_use_id = json.get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let stdout = json.get("stdout")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let stderr = json.get("stderr")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let is_error = json.get("isError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Some(ClaudeEvent::ToolResult { tool_use_id, stdout, stderr, is_error })
            }

            "block_end" => {
                Some(ClaudeEvent::BlockEnd)
            }

            "result" => {
                let content = json.get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let cost = json.get("cost")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let duration = json.get("duration")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let turns = json.get("turns")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                let is_error = json.get("isError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let input_tokens = json.get("inputTokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let output_tokens = json.get("outputTokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let cache_read = json.get("cacheRead")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let cache_write = json.get("cacheWrite")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                Some(ClaudeEvent::Result { content, cost, duration, turns, is_error, input_tokens, output_tokens, cache_read, cache_write })
            }

            "done" => {
                Some(ClaudeEvent::Done)
            }

            "closed" => {
                let code = json.get("code")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                Some(ClaudeEvent::Closed { code })
            }

            "error" => {
                let message = json.get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string();
                Some(ClaudeEvent::Error { message })
            }

            "context_update" => {
                // Real-time context size from message_start event
                let input_tokens = json.get("inputTokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let raw_input_tokens = json.get("rawInputTokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let cache_read = json.get("cacheRead")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let cache_write = json.get("cacheWrite")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                rust_debug_log("CONTEXT_UPDATE", &format!("total={}, raw={}, cache_read={}, cache_write={}",
                    input_tokens, raw_input_tokens, cache_read, cache_write));
                Some(ClaudeEvent::ContextUpdate { input_tokens, raw_input_tokens, cache_read, cache_write })
            }

            _ => None,
        }
    }

    pub fn send_message(&mut self, message: &str) -> Result<(), String> {
        rust_debug_log("SEND_MSG", &format!("Sending message: {}", &message[..message.len().min(100)]));

        let mut stdin = self.stdin.lock().map_err(|e| {
            rust_debug_log("SEND_MSG", &format!("Lock error: {}", e));
            format!("Lock error: {}", e)
        })?;

        // Send plain text prompt - the bridge handles JSON encoding
        stdin
            .write_all(message.as_bytes())
            .map_err(|e| {
                rust_debug_log("SEND_MSG", &format!("Write error: {}", e));
                format!("Write error: {}", e)
            })?;
        stdin
            .write_all(b"\n")
            .map_err(|e| format!("Write error: {}", e))?;
        stdin
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;

        rust_debug_log("SEND_MSG", "Message sent and flushed");
        Ok(())
    }

    pub async fn recv_event(&mut self) -> Option<ClaudeEvent> {
        self.event_rx.recv().await
    }

    pub fn send_interrupt(&mut self) -> Result<(), String> {
        // For the bridge, we could send a special message or use signals
        // For now, this is a placeholder
        Ok(())
    }

    /// Gracefully shutdown the process
    /// Called by Drop, but can also be called manually
    pub fn shutdown(&mut self) {
        rust_debug_log("SHUTDOWN", "Beginning process shutdown");

        // Kill the child process - this closes stdout which causes reader to exit
        if let Err(e) = self.child.kill() {
            // ESRCH (No such process) is fine - process already exited
            if e.kind() != std::io::ErrorKind::NotFound {
                rust_debug_log("SHUTDOWN", &format!("Kill error (may be ok): {}", e));
            }
        } else {
            rust_debug_log("SHUTDOWN", "Child process killed");
        }

        // Wait for child to fully terminate
        match self.child.wait() {
            Ok(status) => rust_debug_log("SHUTDOWN", &format!("Child exited with: {:?}", status)),
            Err(e) => rust_debug_log("SHUTDOWN", &format!("Wait error: {}", e)),
        }

        // Join the reader thread (should exit quickly now that stdout is closed)
        if let Some(handle) = self.reader_handle.take() {
            rust_debug_log("SHUTDOWN", "Joining reader thread...");
            match handle.join() {
                Ok(_) => rust_debug_log("SHUTDOWN", "Reader thread joined"),
                Err(_) => rust_debug_log("SHUTDOWN", "Reader thread panicked"),
            }
        }

        rust_debug_log("SHUTDOWN", "Process shutdown complete");
    }
}

impl Drop for ClaudeProcess {
    fn drop(&mut self) {
        rust_debug_log("DROP", "ClaudeProcess being dropped, initiating shutdown");
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Helper to call parse_bridge_message
    fn parse(json: serde_json::Value) -> Option<ClaudeEvent> {
        ClaudeProcess::parse_bridge_message(&json)
    }

    // ==================== text_delta ====================

    #[test]
    fn parse_text_delta_normal() {
        let event = parse(json!({
            "type": "text_delta",
            "text": "Hello, world!"
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::TextDelta { text }) if text == "Hello, world!"
        ));
    }

    #[test]
    fn parse_text_delta_empty_returns_none() {
        // Empty text deltas are filtered out
        let event = parse(json!({
            "type": "text_delta",
            "text": ""
        }));
        assert!(event.is_none());
    }

    // ==================== tool_start ====================

    #[test]
    fn parse_tool_start() {
        let event = parse(json!({
            "type": "tool_start",
            "id": "tool_123",
            "name": "Read"
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::ToolStart { id, name })
            if id == "tool_123" && name == "Read"
        ));
    }

    // ==================== tool_input ====================

    #[test]
    fn parse_tool_input() {
        let event = parse(json!({
            "type": "tool_input",
            "json": "{\"file_path\":\"/test.txt\"}"
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::ToolInput { json })
            if json == "{\"file_path\":\"/test.txt\"}"
        ));
    }

    // ==================== tool_pending ====================

    #[test]
    fn parse_tool_pending() {
        let event = parse(json!({ "type": "tool_pending" }));
        assert!(matches!(event, Some(ClaudeEvent::ToolPending)));
    }

    // ==================== tool_result ====================

    #[test]
    fn parse_tool_result_with_all_fields() {
        let event = parse(json!({
            "type": "tool_result",
            "tool_use_id": "tool_123",
            "stdout": "file contents",
            "stderr": "some warning",
            "isError": false
        }));
        if let Some(ClaudeEvent::ToolResult { tool_use_id, stdout, stderr, is_error }) = event {
            assert_eq!(tool_use_id, Some("tool_123".to_string()));
            assert_eq!(stdout, Some("file contents".to_string()));
            assert_eq!(stderr, Some("some warning".to_string()));
            assert!(!is_error);
        } else {
            panic!("Expected ToolResult event");
        }
    }

    #[test]
    fn parse_tool_result_minimal() {
        let event = parse(json!({
            "type": "tool_result"
        }));
        if let Some(ClaudeEvent::ToolResult { tool_use_id, stdout, stderr, is_error }) = event {
            assert!(tool_use_id.is_none());
            assert!(stdout.is_none());
            assert!(stderr.is_none());
            assert!(!is_error); // defaults to false
        } else {
            panic!("Expected ToolResult event");
        }
    }

    #[test]
    fn parse_tool_result_error() {
        let event = parse(json!({
            "type": "tool_result",
            "stderr": "Command failed",
            "isError": true
        }));
        if let Some(ClaudeEvent::ToolResult { is_error, stderr, .. }) = event {
            assert!(is_error);
            assert_eq!(stderr, Some("Command failed".to_string()));
        } else {
            panic!("Expected ToolResult event");
        }
    }

    // ==================== context_update ====================

    #[test]
    fn parse_context_update() {
        let event = parse(json!({
            "type": "context_update",
            "inputTokens": 50000,
            "rawInputTokens": 10000,
            "cacheRead": 35000,
            "cacheWrite": 5000
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::ContextUpdate {
                input_tokens: 50000,
                raw_input_tokens: 10000,
                cache_read: 35000,
                cache_write: 5000
            })
        ));
    }

    // ==================== result ====================

    #[test]
    fn parse_result_with_all_fields() {
        let event = parse(json!({
            "type": "result",
            "content": "Response text",
            "cost": 0.025,
            "duration": 1500,
            "turns": 3,
            "isError": false,
            "inputTokens": 1000,
            "outputTokens": 500,
            "cacheRead": 800,
            "cacheWrite": 200
        }));
        if let Some(ClaudeEvent::Result {
            content, cost, duration, turns, is_error,
            input_tokens, output_tokens, cache_read, cache_write
        }) = event {
            assert_eq!(content, "Response text");
            assert!((cost - 0.025).abs() < 0.001);
            assert_eq!(duration, 1500);
            assert_eq!(turns, 3);
            assert!(!is_error);
            assert_eq!(input_tokens, 1000);
            assert_eq!(output_tokens, 500);
            assert_eq!(cache_read, 800);
            assert_eq!(cache_write, 200);
        } else {
            panic!("Expected Result event");
        }
    }

    // ==================== status ====================

    #[test]
    fn parse_status_simple() {
        let event = parse(json!({
            "type": "status",
            "message": "Processing..."
        }));
        if let Some(ClaudeEvent::Status { message, is_compaction, pre_tokens, post_tokens }) = event {
            assert_eq!(message, "Processing...");
            assert!(is_compaction.is_none());
            assert!(pre_tokens.is_none());
            assert!(post_tokens.is_none());
        } else {
            panic!("Expected Status event");
        }
    }

    #[test]
    fn parse_status_with_compaction() {
        let event = parse(json!({
            "type": "status",
            "message": "Compacted conversation",
            "isCompaction": true,
            "preTokens": 150000,
            "postTokens": 45000
        }));
        if let Some(ClaudeEvent::Status { message, is_compaction, pre_tokens, post_tokens }) = event {
            assert_eq!(message, "Compacted conversation");
            assert_eq!(is_compaction, Some(true));
            assert_eq!(pre_tokens, Some(150000));
            assert_eq!(post_tokens, Some(45000));
        } else {
            panic!("Expected Status event");
        }
    }

    // ==================== ready ====================

    #[test]
    fn parse_ready() {
        let event = parse(json!({
            "type": "ready",
            "sessionId": "sess_abc123",
            "model": "claude-opus-4-5-20251101",
            "tools": 42
        }));
        if let Some(ClaudeEvent::Ready { session_id, model, tools }) = event {
            assert_eq!(session_id, "sess_abc123");
            assert_eq!(model, "claude-opus-4-5-20251101");
            assert_eq!(tools, 42);
        } else {
            panic!("Expected Ready event");
        }
    }

    // ==================== processing ====================

    #[test]
    fn parse_processing() {
        let event = parse(json!({
            "type": "processing",
            "prompt": "User query here"
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::Processing { prompt }) if prompt == "User query here"
        ));
    }

    // ==================== thinking ====================

    #[test]
    fn parse_thinking_start_with_index() {
        let event = parse(json!({
            "type": "thinking_start",
            "index": 0
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::ThinkingStart { index: Some(0) })
        ));
    }

    #[test]
    fn parse_thinking_start_without_index() {
        let event = parse(json!({ "type": "thinking_start" }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::ThinkingStart { index: None })
        ));
    }

    #[test]
    fn parse_thinking_delta() {
        let event = parse(json!({
            "type": "thinking_delta",
            "thinking": "Let me analyze this..."
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::ThinkingDelta { thinking })
            if thinking == "Let me analyze this..."
        ));
    }

    // ==================== permission_request ====================

    #[test]
    fn parse_permission_request() {
        let event = parse(json!({
            "type": "permission_request",
            "requestId": "req_xyz",
            "toolName": "Bash",
            "toolInput": { "command": "ls -la" },
            "description": "Run shell command"
        }));
        if let Some(ClaudeEvent::PermissionRequest { request_id, tool_name, tool_input, description }) = event {
            assert_eq!(request_id, "req_xyz");
            assert_eq!(tool_name, "Bash");
            assert!(tool_input.is_some());
            assert_eq!(description, "Run shell command");
        } else {
            panic!("Expected PermissionRequest event");
        }
    }

    // ==================== block_end ====================

    #[test]
    fn parse_block_end() {
        let event = parse(json!({ "type": "block_end" }));
        assert!(matches!(event, Some(ClaudeEvent::BlockEnd)));
    }

    // ==================== done ====================

    #[test]
    fn parse_done() {
        let event = parse(json!({ "type": "done" }));
        assert!(matches!(event, Some(ClaudeEvent::Done)));
    }

    // ==================== closed ====================

    #[test]
    fn parse_closed() {
        let event = parse(json!({
            "type": "closed",
            "code": 0
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::Closed { code: 0 })
        ));
    }

    #[test]
    fn parse_closed_with_error_code() {
        let event = parse(json!({
            "type": "closed",
            "code": 1
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::Closed { code: 1 })
        ));
    }

    // ==================== error ====================

    #[test]
    fn parse_error() {
        let event = parse(json!({
            "type": "error",
            "message": "Something went wrong"
        }));
        assert!(matches!(
            event,
            Some(ClaudeEvent::Error { message })
            if message == "Something went wrong"
        ));
    }

    // ==================== unknown type ====================

    #[test]
    fn parse_unknown_type_returns_none() {
        let event = parse(json!({
            "type": "unknown_future_event",
            "data": "something"
        }));
        assert!(event.is_none());
    }

    #[test]
    fn parse_missing_type_returns_none() {
        let event = parse(json!({
            "message": "no type field"
        }));
        assert!(event.is_none());
    }
}
