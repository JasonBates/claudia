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
    _child: Child,
    _reader_handle: thread::JoinHandle<()>,
}

fn find_node_binary() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;

    // Check nvm versions first (most common)
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<_> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                let node_path = latest.join("bin/node");
                if node_path.exists() {
                    return Ok(node_path);
                }
            }
        }
    }

    // Check common locations
    let candidates = vec![
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/opt/homebrew/bin/node"),
        home.join(".local/bin/node"),
    ];

    for path in &candidates {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // Fall back to hoping it's in PATH
    Ok(PathBuf::from("node"))
}

fn get_bridge_script_path() -> Result<PathBuf, String> {
    // The bridge script should be bundled with the app
    // For development, look relative to the project root
    let possible_paths = vec![
        // When running in dev mode - look in project root for sdk-bridge-v2.mjs
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|p| p.join("sdk-bridge-v2.mjs"))
            .unwrap_or_default(),
        // Fallback to old bridge name
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("claude-bridge.mjs"),
        // When bundled (Resources directory on macOS)
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.join("../Resources/sdk-bridge-v2.mjs")))
            .unwrap_or_default(),
    ];

    for path in &possible_paths {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    Err("Could not find sdk-bridge-v2.mjs script".to_string())
}

impl ClaudeProcess {
    pub fn spawn(working_dir: &Path) -> Result<Self, String> {
        rust_debug_log("SPAWN", &format!("Starting spawn in dir: {:?}", working_dir));

        let node_path = find_node_binary()?;
        rust_debug_log("SPAWN", &format!("Node path: {:?}", node_path));

        let bridge_path = get_bridge_script_path()?;
        rust_debug_log("SPAWN", &format!("Bridge path: {:?}", bridge_path));

        // Spawn the Node.js bridge script with unbuffered stdout
        let mut child = Command::new(&node_path)
            .arg("--no-warnings")
            .arg(&bridge_path)
            .current_dir(working_dir)
            .env("NODE_OPTIONS", "--no-warnings")
            .env("FORCE_COLOR", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
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
            _child: child,
            _reader_handle: reader_handle,
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
                Some(ClaudeEvent::Status { message })
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
                let stdout = json.get("stdout")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let stderr = json.get("stderr")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let is_error = json.get("isError")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Some(ClaudeEvent::ToolResult { stdout, stderr, is_error })
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
}
