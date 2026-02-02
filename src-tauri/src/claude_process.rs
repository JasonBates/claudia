use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::thread;
use tokio::sync::mpsc;

use crate::events::ClaudeEvent;

fn rust_debug_log(prefix: &str, msg: &str) {
    // Gate debug logging behind CLAUDIA_DEBUG=1 environment variable
    static DEBUG_ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    let enabled = *DEBUG_ENABLED.get_or_init(|| {
        std::env::var("CLAUDIA_DEBUG")
            .map(|v| v == "1")
            .unwrap_or(false)
    });

    if !enabled {
        return;
    }

    use std::io::Write as IoWrite;

    // Use app-private directory for secure logging (SEC-001)
    let log_path = get_secure_log_path();
    if let Some(path) = log_path {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .mode(0o600)
                .open(&path)
            {
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
                let _ = writeln!(file, "[{}] [{}] {}", timestamp, prefix, msg);
            }
        }
        #[cfg(not(unix))]
        {
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
                let _ = writeln!(file, "[{}] [{}] {}", timestamp, prefix, msg);
            }
        }
    }
    #[cfg(debug_assertions)]
    eprintln!("[{}] {}", prefix, msg);
}

/// Get secure log file path in app-private directory
fn get_secure_log_path() -> Option<PathBuf> {
    let base_dir = dirs::data_local_dir().or_else(dirs::data_dir)?;
    let log_dir = base_dir.join("com.jasonbates.claudia").join("logs");

    // Ensure directory exists with secure permissions
    if !log_dir.exists() {
        if std::fs::create_dir_all(&log_dir).is_err() {
            return None;
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o700);
        let _ = std::fs::set_permissions(&log_dir, perms);
    }

    Some(log_dir.join("claude-debug.log"))
}

// ============================================================================
// Split process types for independent locking (sender/receiver decoupling)
// ============================================================================

/// Sender half of the Claude process - handles writing to stdin.
/// Can be locked independently of the receiver, allowing control commands
/// (interrupt, permission response) to execute during streaming.
pub struct ClaudeSender {
    stdin: ChildStdin,
}

impl ClaudeSender {
    /// Send a message to Claude
    pub fn send_message(&mut self, message: &str) -> Result<(), String> {
        rust_debug_log(
            "SENDER",
            &format!("Sending: {}", message.chars().take(100).collect::<String>()),
        );

        // JSON-encode the message to preserve newlines
        let encoded = serde_json::json!({ "text": message });
        let prefixed = format!("__MSG__{}\n", encoded);

        self.stdin.write_all(prefixed.as_bytes()).map_err(|e| {
            rust_debug_log("SENDER", &format!("Write error: {}", e));
            format!("Write error: {}", e)
        })?;
        self.stdin
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;

        rust_debug_log("SENDER", "Message sent and flushed");
        Ok(())
    }

    /// Send an interrupt signal to Claude
    pub fn send_interrupt(&mut self) -> Result<(), String> {
        rust_debug_log("SENDER", "Sending interrupt signal");

        let interrupt_msg = r#"{"type":"interrupt"}"#;
        self.stdin
            .write_all(interrupt_msg.as_bytes())
            .map_err(|e| {
                rust_debug_log("SENDER", &format!("Write error: {}", e));
                format!("Write error: {}", e)
            })?;
        self.stdin
            .write_all(b"\n")
            .map_err(|e| format!("Write error: {}", e))?;
        self.stdin
            .flush()
            .map_err(|e| format!("Flush error: {}", e))?;

        rust_debug_log("SENDER", "Interrupt sent");
        Ok(())
    }
}

/// Receiver half of the Claude process - handles reading events from channel.
/// Can be locked independently of the sender for streaming.
pub struct ClaudeReceiver {
    event_rx: mpsc::Receiver<ClaudeEvent>,
}

impl ClaudeReceiver {
    /// Receive the next event from Claude (async)
    pub async fn recv_event(&mut self) -> Option<ClaudeEvent> {
        self.event_rx.recv().await
    }
}

/// Process lifecycle handle - manages the child process and reader thread.
/// Used for spawn/shutdown operations.
pub struct ProcessHandle {
    child: Child,
    reader_handle: Option<thread::JoinHandle<()>>,
}

impl ProcessHandle {
    /// Gracefully shutdown the process
    pub fn shutdown(&mut self) {
        rust_debug_log("HANDLE", "Beginning process shutdown");

        // Kill the child process - this closes stdout which causes reader to exit
        if let Err(e) = self.child.kill() {
            if e.kind() != std::io::ErrorKind::NotFound {
                rust_debug_log("HANDLE", &format!("Kill error (may be ok): {}", e));
            }
        } else {
            rust_debug_log("HANDLE", "Child process killed");
        }

        // Wait for child to fully terminate
        match self.child.wait() {
            Ok(status) => rust_debug_log("HANDLE", &format!("Child exited: {:?}", status)),
            Err(e) => rust_debug_log("HANDLE", &format!("Wait error: {}", e)),
        }

        // Join the reader thread
        if let Some(handle) = self.reader_handle.take() {
            rust_debug_log("HANDLE", "Joining reader thread...");
            match handle.join() {
                Ok(_) => rust_debug_log("HANDLE", "Reader thread joined"),
                Err(_) => rust_debug_log("HANDLE", "Reader thread panicked"),
            }
        }

        rust_debug_log("HANDLE", "Shutdown complete");
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        rust_debug_log("DROP", "ProcessHandle being dropped");
        self.shutdown();
    }
}

/// Spawn a new Claude process and return split sender/receiver/handle.
/// This is the new factory function that enables independent locking.
pub fn spawn_claude_process(
    working_dir: &Path,
    app_session_id: &str,
) -> Result<(ClaudeSender, ClaudeReceiver, ProcessHandle), String> {
    spawn_claude_process_with_resume(working_dir, None, app_session_id)
}

/// Spawn a Claude process with optional resume, returning split components.
pub fn spawn_claude_process_with_resume(
    working_dir: &Path,
    resume_session_id: Option<&str>,
    app_session_id: &str,
) -> Result<(ClaudeSender, ClaudeReceiver, ProcessHandle), String> {
    rust_debug_log(
        "SPAWN",
        &format!("Starting spawn in dir: {:?}", working_dir),
    );
    rust_debug_log(
        "SPAWN",
        &format!(
            "App session ID: {}",
            &app_session_id[..8.min(app_session_id.len())]
        ),
    );
    if let Some(session_id) = resume_session_id {
        rust_debug_log("SPAWN", &format!("Resuming session: {}", session_id));
    }

    let node_path = find_node_binary().map_err(|e| {
        rust_debug_log("SPAWN_ERROR", &format!("Node binary not found: {}", e));
        e
    })?;

    let bridge_path = get_bridge_script_path().map_err(|e| {
        rust_debug_log("SPAWN_ERROR", &format!("Bridge script not found: {}", e));
        e
    })?;

    // Build command
    let mut cmd = Command::new(&node_path);
    cmd.arg("--no-warnings")
        .arg(&bridge_path)
        .current_dir(working_dir)
        .env("NODE_OPTIONS", "--no-warnings")
        .env("FORCE_COLOR", "0")
        .env("CLAUDIA_SESSION_ID", app_session_id)
        .env(
            "CLAUDIA_DEBUG",
            std::env::var("CLAUDIA_DEBUG").unwrap_or_default(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    if let Some(session_id) = resume_session_id {
        cmd.env("CLAUDE_RESUME_SESSION", session_id);
    }

    let mut child = cmd.spawn().map_err(|e| {
        rust_debug_log("SPAWN_ERROR", &format!("Failed: {}", e));
        format!("Failed to spawn bridge: {}", e)
    })?;

    rust_debug_log("SPAWN", "Bridge process spawned successfully");

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    // Bounded channel for events - prevents unbounded memory growth if receiver stalls.
    // 10000 capacity is large enough for normal streaming but prevents OOM.
    // If full, reader blocks which back-pressures stdout (correct behavior).
    let (tx, rx) = mpsc::channel::<ClaudeEvent>(10000);

    // Spawn reader thread
    let reader_handle = thread::spawn(move || {
        read_output_bounded(stdout, tx);
    });

    let sender = ClaudeSender { stdin };
    let receiver = ClaudeReceiver { event_rx: rx };
    let handle = ProcessHandle {
        child,
        reader_handle: Some(reader_handle),
    };

    Ok((sender, receiver, handle))
}

fn find_node_binary() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    rust_debug_log("NODE", &format!("Looking for node, home={:?}", home));

    // Check nvm versions first (most common for macOS dev)
    let nvm_dir = home.join(".nvm/versions/node");
    rust_debug_log(
        "NODE",
        &format!(
            "Checking nvm dir: {:?} exists={}",
            nvm_dir,
            nvm_dir.exists()
        ),
    );

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
                rust_debug_log(
                    "NODE",
                    &format!(
                        "Checking nvm node: {:?} exists={}",
                        node_path,
                        node_path.exists()
                    ),
                );
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
        rust_debug_log(
            "NODE",
            &format!("Checking: {:?} exists={}", path, path.exists()),
        );
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
            rust_debug_log(
                "BRIDGE",
                &format!("Checking bundled: {:?} canonical={:?}", bundled, canonical),
            );

            if bundled.exists() {
                rust_debug_log("BRIDGE", &format!("Using bundled: {:?}", bundled));
                return Ok(bundled);
            }

            // Also check direct Resources path
            let direct = parent.join("../Resources/sdk-bridge-v2.mjs");
            rust_debug_log(
                "BRIDGE",
                &format!("Checking direct: {:?} exists={}", direct, direct.exists()),
            );
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

    rust_debug_log(
        "BRIDGE",
        &format!(
            "Checking dev path: {:?} exists={}",
            dev_path,
            dev_path.exists()
        ),
    );

    if dev_path.exists() {
        rust_debug_log("BRIDGE", &format!("Using dev: {:?}", dev_path));
        return Ok(dev_path);
    }

    rust_debug_log(
        "BRIDGE",
        "ERROR: Could not find sdk-bridge-v2.mjs anywhere!",
    );
    Err("Could not find sdk-bridge-v2.mjs script".to_string())
}

/// Read output using bounded channel - blocks if channel is full.
/// Used by the split sender/receiver architecture.
/// If receiver stalls, this will back-pressure to stdout (correct behavior).
fn read_output_bounded(stdout: ChildStdout, tx: mpsc::Sender<ClaudeEvent>) {
    rust_debug_log("READER", "Starting read_output_bounded loop");

    let reader = BufReader::with_capacity(1024, stdout);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                rust_debug_log("ERROR", &format!("Read error: {}", e));
                break;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        // Truncate safely at char boundary for logging
        let truncated: String = line.chars().take(200).collect();
        rust_debug_log("RAW_LINE", &truncated);

        // Parse JSON output from the bridge
        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(json) => {
                let msg_type = json
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                rust_debug_log("JSON_PARSED", &format!("type={}", msg_type));

                if let Some(event) = parse_bridge_message(&json) {
                    rust_debug_log("EVENT_CREATED", &format!("{:?}", event));
                    // blocking_send blocks if channel is full (back-pressure)
                    if tx.blocking_send(event).is_err() {
                        rust_debug_log("CHANNEL_ERROR", "Receiver dropped");
                        break;
                    }
                    rust_debug_log("CHANNEL_SEND", "OK");
                }
            }
            Err(e) => {
                rust_debug_log(
                    "JSON_ERROR",
                    &format!(
                        "Parse error: {} - line: {}",
                        e,
                        &line[..line.len().min(100)]
                    ),
                );
            }
        }
    }
    rust_debug_log("READER", "Loop ended");
}

fn parse_bridge_message(json: &serde_json::Value) -> Option<ClaudeEvent> {
    let msg_type = json.get("type")?.as_str()?;

    match msg_type {
        "status" => {
            let message = json
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let is_compaction = json.get("isCompaction").and_then(|v| v.as_bool());
            let pre_tokens = json.get("preTokens").and_then(|v| v.as_u64());
            let post_tokens = json.get("postTokens").and_then(|v| v.as_u64());
            Some(ClaudeEvent::Status {
                message,
                is_compaction,
                pre_tokens,
                post_tokens,
            })
        }

        "ready" => {
            let session_id = json
                .get("sessionId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let model = json
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tools = json.get("tools").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            Some(ClaudeEvent::Ready {
                session_id,
                model,
                tools,
            })
        }

        "processing" => {
            let prompt = json
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(ClaudeEvent::Processing { prompt })
        }

        "text_delta" => {
            let text = json
                .get("text")
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
            let index = json.get("index").and_then(|v| v.as_u64()).map(|v| v as u32);
            Some(ClaudeEvent::ThinkingStart { index })
        }

        "thinking_delta" => {
            let thinking = json
                .get("thinking")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(ClaudeEvent::ThinkingDelta { thinking })
        }

        "tool_start" => {
            let id = json
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = json
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let parent_tool_use_id = json
                .get("parent_tool_use_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(ClaudeEvent::ToolStart {
                id,
                name,
                parent_tool_use_id,
            })
        }

        "tool_input" => {
            let json_str = json
                .get("json")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(ClaudeEvent::ToolInput { json: json_str })
        }

        "tool_pending" => Some(ClaudeEvent::ToolPending),

        "permission_request" => {
            let request_id = json
                .get("requestId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tool_name = json
                .get("toolName")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let tool_input = json.get("toolInput").cloned();
            let description = json
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(ClaudeEvent::PermissionRequest {
                request_id,
                tool_name,
                tool_input,
                description,
            })
        }

        "ask_user_question" => {
            let request_id = json
                .get("requestId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let questions = json
                .get("questions")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]));
            rust_debug_log("ASK_USER_QUESTION", &format!("request_id={}", request_id));
            Some(ClaudeEvent::AskUserQuestion {
                request_id,
                questions,
            })
        }

        "tool_result" => {
            let tool_use_id = json
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let stdout = json
                .get("stdout")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let stderr = json
                .get("stderr")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let is_error = json
                .get("isError")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Some(ClaudeEvent::ToolResult {
                tool_use_id,
                stdout,
                stderr,
                is_error,
            })
        }

        "block_end" => Some(ClaudeEvent::BlockEnd),

        "result" => {
            let content = json
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let cost = json.get("cost").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let duration = json.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
            let turns = json.get("turns").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let is_error = json
                .get("isError")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let input_tokens = json
                .get("inputTokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let output_tokens = json
                .get("outputTokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cache_read = json.get("cacheRead").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_write = json.get("cacheWrite").and_then(|v| v.as_u64()).unwrap_or(0);
            Some(ClaudeEvent::Result {
                content,
                cost,
                duration,
                turns,
                is_error,
                input_tokens,
                output_tokens,
                cache_read,
                cache_write,
            })
        }

        "done" => Some(ClaudeEvent::Done),

        "interrupted" => Some(ClaudeEvent::Interrupted),

        "closed" => {
            let code = json.get("code").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            Some(ClaudeEvent::Closed { code })
        }

        "error" => {
            let message = json
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            Some(ClaudeEvent::Error { message })
        }

        "context_update" => {
            // Real-time context size from message_start event
            let input_tokens = json
                .get("inputTokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let raw_input_tokens = json
                .get("rawInputTokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cache_read = json.get("cacheRead").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_write = json.get("cacheWrite").and_then(|v| v.as_u64()).unwrap_or(0);
            rust_debug_log(
                "CONTEXT_UPDATE",
                &format!(
                    "total={}, raw={}, cache_read={}, cache_write={}",
                    input_tokens, raw_input_tokens, cache_read, cache_write
                ),
            );
            Some(ClaudeEvent::ContextUpdate {
                input_tokens,
                raw_input_tokens,
                cache_read,
                cache_write,
            })
        }

        "subagent_start" => {
            let id = json
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let agent_type = json
                .get("agentType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let description = json
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let prompt = json
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            rust_debug_log("SUBAGENT_START", &format!("id={}, type={}", id, agent_type));
            Some(ClaudeEvent::SubagentStart {
                id,
                agent_type,
                description,
                prompt,
            })
        }

        "subagent_progress" => {
            let subagent_id = json
                .get("subagentId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tool_name = json
                .get("toolName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tool_detail = json
                .get("toolDetail")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tool_count = json.get("toolCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            rust_debug_log(
                "SUBAGENT_PROGRESS",
                &format!(
                    "id={}, tool={}, detail={}, count={}",
                    subagent_id, tool_name, tool_detail, tool_count
                ),
            );
            Some(ClaudeEvent::SubagentProgress {
                subagent_id,
                tool_name,
                tool_detail,
                tool_count,
            })
        }

        "subagent_end" => {
            let id = json
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let agent_type = json
                .get("agentType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let duration = json.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
            let tool_count = json.get("toolCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let result = json
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            rust_debug_log(
                "SUBAGENT_END",
                &format!(
                    "id={}, type={}, duration={}ms, tools={}",
                    id, agent_type, duration, tool_count
                ),
            );
            Some(ClaudeEvent::SubagentEnd {
                id,
                agent_type,
                duration,
                tool_count,
                result,
            })
        }

        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Helper to call parse_bridge_message
    fn parse(json: serde_json::Value) -> Option<ClaudeEvent> {
        parse_bridge_message(&json)
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
        if let Some(ClaudeEvent::ToolStart {
            id,
            name,
            parent_tool_use_id,
        }) = event
        {
            assert_eq!(id, "tool_123");
            assert_eq!(name, "Read");
            assert!(parent_tool_use_id.is_none());
        } else {
            panic!("Expected ToolStart event");
        }
    }

    #[test]
    fn parse_tool_start_with_parent() {
        let event = parse(json!({
            "type": "tool_start",
            "id": "tool_456",
            "name": "Glob",
            "parent_tool_use_id": "tool_123"
        }));
        if let Some(ClaudeEvent::ToolStart {
            id,
            name,
            parent_tool_use_id,
        }) = event
        {
            assert_eq!(id, "tool_456");
            assert_eq!(name, "Glob");
            assert_eq!(parent_tool_use_id, Some("tool_123".to_string()));
        } else {
            panic!("Expected ToolStart event");
        }
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
        if let Some(ClaudeEvent::ToolResult {
            tool_use_id,
            stdout,
            stderr,
            is_error,
        }) = event
        {
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
        if let Some(ClaudeEvent::ToolResult {
            tool_use_id,
            stdout,
            stderr,
            is_error,
        }) = event
        {
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
        if let Some(ClaudeEvent::ToolResult {
            is_error, stderr, ..
        }) = event
        {
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
            content,
            cost,
            duration,
            turns,
            is_error,
            input_tokens,
            output_tokens,
            cache_read,
            cache_write,
        }) = event
        {
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
        if let Some(ClaudeEvent::Status {
            message,
            is_compaction,
            pre_tokens,
            post_tokens,
        }) = event
        {
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
        if let Some(ClaudeEvent::Status {
            message,
            is_compaction,
            pre_tokens,
            post_tokens,
        }) = event
        {
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
        if let Some(ClaudeEvent::Ready {
            session_id,
            model,
            tools,
        }) = event
        {
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
        if let Some(ClaudeEvent::PermissionRequest {
            request_id,
            tool_name,
            tool_input,
            description,
        }) = event
        {
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
        assert!(matches!(event, Some(ClaudeEvent::Closed { code: 0 })));
    }

    #[test]
    fn parse_closed_with_error_code() {
        let event = parse(json!({
            "type": "closed",
            "code": 1
        }));
        assert!(matches!(event, Some(ClaudeEvent::Closed { code: 1 })));
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

    // ==================== subagent events ====================

    #[test]
    fn parse_subagent_start() {
        let event = parse(json!({
            "type": "subagent_start",
            "id": "tool_123",
            "agentType": "Explore",
            "description": "Find error handling code",
            "prompt": "Search the codebase for..."
        }));
        if let Some(ClaudeEvent::SubagentStart {
            id,
            agent_type,
            description,
            prompt,
        }) = event
        {
            assert_eq!(id, "tool_123");
            assert_eq!(agent_type, "Explore");
            assert_eq!(description, "Find error handling code");
            assert!(prompt.starts_with("Search"));
        } else {
            panic!("Expected SubagentStart event");
        }
    }

    #[test]
    fn parse_subagent_progress() {
        let event = parse(json!({
            "type": "subagent_progress",
            "subagentId": "tool_123",
            "toolName": "Glob",
            "toolCount": 3
        }));
        if let Some(ClaudeEvent::SubagentProgress {
            subagent_id,
            tool_name,
            tool_count,
            ..
        }) = event
        {
            assert_eq!(subagent_id, "tool_123");
            assert_eq!(tool_name, "Glob");
            assert_eq!(tool_count, 3);
        } else {
            panic!("Expected SubagentProgress event");
        }
    }

    #[test]
    fn parse_subagent_end() {
        let event = parse(json!({
            "type": "subagent_end",
            "id": "tool_123",
            "agentType": "Explore",
            "duration": 5234,
            "toolCount": 7,
            "result": "Found 5 files containing error handling..."
        }));
        if let Some(ClaudeEvent::SubagentEnd {
            id,
            agent_type,
            duration,
            tool_count,
            result,
        }) = event
        {
            assert_eq!(id, "tool_123");
            assert_eq!(agent_type, "Explore");
            assert_eq!(duration, 5234);
            assert_eq!(tool_count, 7);
            assert!(result.starts_with("Found"));
        } else {
            panic!("Expected SubagentEnd event");
        }
    }
}
