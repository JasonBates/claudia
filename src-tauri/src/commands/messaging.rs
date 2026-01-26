//! Message sending and event streaming

use tauri::{ipc::Channel, State};
use tokio::time::{timeout, Duration};

use super::{cmd_debug_log, AppState};
use crate::claude_process::ClaudeProcess;
use crate::events::ClaudeEvent;

/// Send a message to Claude and stream the response
#[tauri::command]
pub async fn send_message(
    message: String,
    channel: Channel<ClaudeEvent>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Clear command log
    let log_path = std::env::temp_dir().join("claude-commands-debug.log");
    let _ = std::fs::write(
        &log_path,
        format!("=== send_message started at {} ===\n", chrono::Local::now()),
    );

    cmd_debug_log(
        "SEND",
        &format!("Message: {}", &message[..message.len().min(50)]),
    );

    // Stream responses - clone Arc for streaming loop
    let process_arc = state.process.clone();

    // Drain any stale events from previous response before sending new message
    // BUT forward Status events - they're important feedback (e.g., "Compacted")
    {
        let mut process_guard = process_arc.lock().await;
        if let Some(process) = process_guard.as_mut() {
            cmd_debug_log("DRAIN", "Draining stale events...");
            let mut drained = 0;
            let mut forwarded = 0;
            while let Ok(Some(event)) =
                timeout(Duration::from_millis(10), process.recv_event()).await
            {
                // Forward Status events to frontend instead of draining
                if matches!(&event, ClaudeEvent::Status { .. }) {
                    cmd_debug_log("DRAIN", &format!("Forwarding Status: {:?}", event));
                    let _ = channel.send(event);
                    forwarded += 1;
                } else {
                    cmd_debug_log("DRAIN", &format!("Drained: {:?}", event));
                    drained += 1;
                }
            }
            if drained > 0 || forwarded > 0 {
                cmd_debug_log(
                    "DRAIN",
                    &format!(
                        "Drained {} events, forwarded {} Status events",
                        drained, forwarded
                    ),
                );
            }
        }
    }

    // Send message (brief lock)
    {
        let mut process_guard = state.process.lock().await;
        let process = process_guard
            .as_mut()
            .ok_or("No active session. Call start_session first.")?;

        cmd_debug_log("SEND", "Got process, sending message");
        process.send_message(&message)?;
        cmd_debug_log("SEND", "Message sent to process");
    }

    // Read events with timeout to detect end of response
    // Note: Claude can take several seconds to start streaming, especially on first request
    let mut idle_count = 0;
    let max_idle = 60; // Wait up to 30 seconds (60 x 500ms) for initial response
    let mut event_count = 0;
    let mut got_first_content = false;
    let mut tool_pending = false; // Track if a tool is executing on server (e.g., WebSearch)
    let mut compacting = false; // Track if compaction is in progress (can take 60+ seconds)

    cmd_debug_log("LOOP", "Starting event receive loop");

    loop {
        let mut process_guard = process_arc.lock().await;
        let process: &mut ClaudeProcess = match process_guard.as_mut() {
            Some(p) => p,
            None => {
                cmd_debug_log("LOOP", "Process is None, breaking");
                break;
            }
        };

        // Use longer timeout when tool/compaction is executing
        // Compaction can take 60+ seconds for large contexts
        let current_timeout = if compacting || tool_pending {
            5000
        } else if got_first_content {
            2000
        } else {
            500
        };
        let current_max_idle = if compacting {
            30
        } else if tool_pending {
            24
        } else if got_first_content {
            3
        } else {
            max_idle
        }; // 2.5 min for compaction

        // Try to receive with timeout
        match timeout(
            Duration::from_millis(current_timeout),
            process.recv_event(),
        )
        .await
        {
            Ok(Some(event)) => {
                event_count += 1;
                idle_count = 0;

                // Track if we've received actual content (text or tool use)
                if matches!(
                    event,
                    ClaudeEvent::TextDelta { .. } | ClaudeEvent::ToolStart { .. }
                ) {
                    got_first_content = true;
                }

                // Track tool pending state
                if matches!(event, ClaudeEvent::ToolPending) {
                    tool_pending = true;
                    cmd_debug_log("TOOL", "Tool pending - waiting for server execution");
                }
                // Tool result or new text means tool finished
                if let ClaudeEvent::ToolResult {
                    ref tool_use_id,
                    ref stdout,
                    ..
                } = event
                {
                    let stdout_len = stdout.as_ref().map(|s| s.len()).unwrap_or(0);
                    cmd_debug_log(
                        "TOOL_RESULT",
                        &format!(
                            "Received tool_use_id={:?}, stdout_len={}",
                            tool_use_id, stdout_len
                        ),
                    );
                    if tool_pending {
                        cmd_debug_log("TOOL", "Tool completed");
                    }
                    tool_pending = false;
                }
                if matches!(event, ClaudeEvent::TextDelta { .. }) {
                    if tool_pending {
                        cmd_debug_log("TOOL", "Tool completed (via text)");
                    }
                    tool_pending = false;
                }

                // Track compaction state (can take 60+ seconds)
                if let ClaudeEvent::Status {
                    ref message,
                    ref is_compaction,
                    ..
                } = event
                {
                    if message.contains("Compacting") {
                        compacting = true;
                        cmd_debug_log("COMPACT", "Compaction started - using extended timeout");
                    }
                    if is_compaction.unwrap_or(false) || message.contains("Compacted") {
                        compacting = false;
                        cmd_debug_log("COMPACT", "Compaction completed");
                    }
                }

                cmd_debug_log("EVENT", &format!("#{} Received: {:?}", event_count, event));

                // Check if this is a "done" signal
                let is_done = matches!(event, ClaudeEvent::Done);

                match channel.send(event) {
                    Ok(_) => cmd_debug_log("CHANNEL", &format!("#{} Sent to frontend", event_count)),
                    Err(e) => {
                        cmd_debug_log(
                            "CHANNEL_ERROR",
                            &format!("#{} Send failed: {}", event_count, e),
                        );
                        return Err(e.to_string());
                    }
                }

                if is_done {
                    cmd_debug_log("LOOP", "Got Done event, collecting trailing events...");
                    // Collect any trailing events that arrived just before/after Done
                    // (Status events from /compact can arrive within ms of Done)
                    drop(process_guard); // Release lock for trailing event collection
                    let mut trailing_count = 0;
                    for _ in 0..5 {
                        let mut pg = process_arc.lock().await;
                        if let Some(p) = pg.as_mut() {
                            match timeout(Duration::from_millis(20), p.recv_event()).await {
                                Ok(Some(trailing_event)) => {
                                    trailing_count += 1;
                                    cmd_debug_log(
                                        "TRAILING",
                                        &format!("#{} {:?}", trailing_count, trailing_event),
                                    );
                                    let _ = channel.send(trailing_event);
                                }
                                _ => break,
                            }
                        }
                    }
                    if trailing_count > 0 {
                        cmd_debug_log(
                            "LOOP",
                            &format!("Collected {} trailing events", trailing_count),
                        );
                    }
                    cmd_debug_log("LOOP", "Breaking after Done");
                    break;
                }
            }
            Ok(None) => {
                // Channel closed, process ended
                cmd_debug_log("LOOP", "Channel returned None (closed)");
                channel
                    .send(ClaudeEvent::Done)
                    .map_err(|e| e.to_string())?;
                break;
            }
            Err(_) => {
                // Timeout - might be end of response
                idle_count += 1;
                cmd_debug_log(
                    "TIMEOUT",
                    &format!(
                        "Idle count: {}/{} (got_content: {}, tool_pending: {})",
                        idle_count, current_max_idle, got_first_content, tool_pending
                    ),
                );
                if idle_count >= current_max_idle {
                    // Likely done responding
                    cmd_debug_log("LOOP", "Max idle reached, sending Done");
                    channel
                        .send(ClaudeEvent::Done)
                        .map_err(|e| e.to_string())?;
                    break;
                }
            }
        }
    }

    cmd_debug_log("DONE", &format!("Total events received: {}", event_count));
    Ok(())
}
