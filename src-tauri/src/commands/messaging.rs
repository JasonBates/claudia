//! Message sending and event streaming

use tauri::{ipc::Channel, State};
use tokio::time::{timeout, Duration};

use super::{cmd_debug_log, AppState};
use crate::claude_process::ClaudeProcess;
use crate::events::ClaudeEvent;

// =============================================================================
// Timeout Configuration
// =============================================================================
// These constants control how long we wait for events in different phases.
// The event loop uses adaptive timeouts to balance responsiveness with patience.

/// Timeout for subagents (Task tool) and compaction (10 seconds)
const TIMEOUT_SUBAGENT_MS: u64 = 10000;
/// Timeout for regular tool execution (5 seconds)
const TIMEOUT_TOOL_EXEC_MS: u64 = 5000;
/// Timeout when streaming content (2 seconds between chunks)
const TIMEOUT_STREAMING_MS: u64 = 2000;
/// Timeout when waiting for first content (500ms polling)
const TIMEOUT_WAITING_MS: u64 = 500;
/// Timeout when waiting for user permission response (5 seconds polling)
/// User may need time to read and decide on permission dialogs
const TIMEOUT_PERMISSION_MS: u64 = 5000;

/// Max idle count during compaction (~5 minutes at 10s intervals)
const MAX_IDLE_COMPACTION: u32 = 30;
/// Max idle count for subagents (~5 minutes at 10s intervals)
/// Task agents can take several minutes for codebase analysis
const MAX_IDLE_SUBAGENT: u32 = 30;
/// Max idle count for regular tools (~2 minutes at 5s intervals)
const MAX_IDLE_TOOLS: u32 = 24;
/// Max idle count while streaming (~6 seconds at 2s intervals)
const MAX_IDLE_STREAMING: u32 = 3;
/// Max idle count waiting for first content (~30 seconds at 500ms intervals)
const MAX_IDLE_INITIAL: u32 = 60;
/// Max idle count waiting for permission response (~5 minutes at 5s intervals)
/// User may need significant time to review permission requests
const MAX_IDLE_PERMISSION: u32 = 60;

/// Calculate adaptive timeout and max idle count based on current state.
///
/// Returns (timeout_ms, max_idle_count) tuple.
///
/// # State Priority (highest to lowest)
/// 1. Compacting - longest timeout, context compaction can take 60+ seconds
/// 2. Permission pending - long timeout, user needs time to review and respond
/// 3. Subagent pending - long timeout, Task agents can take several minutes
/// 4. Tools pending - medium-long timeout, regular tool execution
/// 5. Got first content - short timeout, streaming should be continuous
/// 6. Waiting for response - medium timeout, initial response can take time
pub fn calculate_timeouts(
    compacting: bool,
    permission_pending: bool,
    subagent_pending: bool,
    tools_pending: bool,
    got_first_content: bool,
) -> (u64, u32) {
    let timeout_ms = if compacting {
        TIMEOUT_SUBAGENT_MS
    } else if permission_pending {
        TIMEOUT_PERMISSION_MS
    } else if subagent_pending {
        TIMEOUT_SUBAGENT_MS
    } else if tools_pending {
        TIMEOUT_TOOL_EXEC_MS
    } else if got_first_content {
        TIMEOUT_STREAMING_MS
    } else {
        TIMEOUT_WAITING_MS
    };

    let max_idle = if compacting {
        MAX_IDLE_COMPACTION
    } else if permission_pending {
        MAX_IDLE_PERMISSION
    } else if subagent_pending {
        MAX_IDLE_SUBAGENT
    } else if tools_pending {
        MAX_IDLE_TOOLS
    } else if got_first_content {
        MAX_IDLE_STREAMING
    } else {
        MAX_IDLE_INITIAL
    };

    (timeout_ms, max_idle)
}

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
    // Forward Status events - they're important feedback (e.g., "Compacted")
    // If we find a Closed event, the bridge died after previous response - restart it
    let mut needs_restart = false;
    {
        let mut process_guard = process_arc.lock().await;
        if let Some(process) = process_guard.as_mut() {
            cmd_debug_log("DRAIN", "Draining stale events...");
            let mut drained = 0;
            let mut forwarded = 0;
            while let Ok(Some(event)) =
                timeout(Duration::from_millis(10), process.recv_event()).await
            {
                // Forward Status and Ready events to frontend instead of draining
                // Ready contains session metadata (sessionId, model) needed for resume
                if matches!(&event, ClaudeEvent::Status { .. } | ClaudeEvent::Ready { .. }) {
                    cmd_debug_log("DRAIN", &format!("Forwarding event: {:?}", event));
                    let _ = channel.send(event);
                    forwarded += 1;
                } else {
                    if matches!(&event, ClaudeEvent::Closed { .. }) {
                        cmd_debug_log(
                            "DRAIN",
                            "Bridge died after previous response - will restart",
                        );
                        needs_restart = true;
                    }
                    cmd_debug_log("DRAIN", &format!("Drained: {:?}", event));
                    drained += 1;
                }
            }
            if drained > 0 || forwarded > 0 {
                cmd_debug_log(
                    "DRAIN",
                    &format!(
                        "Drained {} events, forwarded {} events",
                        drained, forwarded
                    ),
                );
            }
            if needs_restart {
                *process_guard = None;
            }
        }
    }

    // Restart session if bridge died (Closed event found during drain)
    if needs_restart {
        cmd_debug_log("RESTART", "Restarting session before sending message");
        let working_dir = std::path::PathBuf::from(&state.launch_dir);
        let app_session_id = state.session_id.clone();

        let new_process = tokio::task::spawn_blocking(move || {
            ClaudeProcess::spawn(&working_dir, &app_session_id)
        })
        .await
        .map_err(|e| format!("Restart task error: {}", e))??;

        {
            let mut process_guard = process_arc.lock().await;
            *process_guard = Some(new_process);
        }

        // Wait for Ready event before sending message (bridge has warmup sequence)
        cmd_debug_log("RESTART", "Waiting for bridge to be ready...");
        let mut ready_received = false;
        for _ in 0..60 {
            // 30 second timeout (60 * 500ms)
            let mut process_guard = process_arc.lock().await;
            if let Some(process) = process_guard.as_mut() {
                match timeout(Duration::from_millis(500), process.recv_event()).await {
                    Ok(Some(event)) => {
                        cmd_debug_log("RESTART", &format!("Event during warmup: {:?}", event));
                        if matches!(&event, ClaudeEvent::Ready { .. }) {
                            ready_received = true;
                            let _ = channel.send(event);
                            break;
                        }
                        // Forward other events (like Status) to frontend
                        let _ = channel.send(event);
                    }
                    Ok(None) => {
                        cmd_debug_log("RESTART", "Channel closed during warmup");
                        break;
                    }
                    Err(_) => {
                        // Timeout, keep waiting
                    }
                }
            }
        }
        if ready_received {
            cmd_debug_log("RESTART", "Bridge ready, continuing with message");
        } else {
            cmd_debug_log("RESTART", "Timeout waiting for Ready, proceeding anyway");
        }
    }

    // Send message (brief lock)
    {
        let mut process_guard = state.process.lock().await;
        let process = process_guard.as_mut().ok_or("No active session")?;

        cmd_debug_log("SEND", "Got process, sending message");
        process.send_message(&message)?;
        cmd_debug_log("SEND", "Message sent to process");
    }

    // Read events with timeout to detect end of response
    // Note: Claude can take several seconds to start streaming, especially on first request
    let mut idle_count = 0;
    let mut event_count = 0;
    let mut got_first_content = false;
    let mut pending_tool_count: usize = 0; // Count of regular tools awaiting results
    let mut pending_subagent_count: usize = 0; // Count of Task (subagent) tools - these get longer timeouts
    let mut pending_permission_count: usize = 0; // Count of permissions awaiting user response
    let mut subagent_tool_ids: std::collections::HashSet<String> = std::collections::HashSet::new(); // Track which tool IDs are subagents
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

        // Calculate adaptive timeout based on current state
        let tools_pending = pending_tool_count > 0;
        let subagent_pending = pending_subagent_count > 0;
        let permission_pending = pending_permission_count > 0;
        let (current_timeout, current_max_idle) = calculate_timeouts(
            compacting,
            permission_pending,
            subagent_pending,
            tools_pending,
            got_first_content,
        );

        // Try to receive with timeout
        match timeout(Duration::from_millis(current_timeout), process.recv_event()).await {
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

                // Track pending tools count for parallel tool support
                // Increment on ToolStart, decrement on ToolResult (only with tool_use_id to avoid duplicates)
                // Task tools (subagents) are tracked separately for longer timeouts
                if let ClaudeEvent::ToolStart {
                    ref id, ref name, ..
                } = event
                {
                    if name == "Task" {
                        pending_subagent_count += 1;
                        subagent_tool_ids.insert(id.clone());
                        cmd_debug_log(
                            "TOOL",
                            &format!(
                                "Subagent started (id={}) - pending: {} subagents, {} tools",
                                id, pending_subagent_count, pending_tool_count
                            ),
                        );
                    } else {
                        pending_tool_count += 1;
                        cmd_debug_log(
                            "TOOL",
                            &format!(
                                "Tool '{}' started (id={}) - pending: {} subagents, {} tools",
                                name, id, pending_subagent_count, pending_tool_count
                            ),
                        );
                    }
                }

                // Tool result decrements count (only if it has a tool_use_id - duplicates don't have one)
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
                    // Tool result means permission was granted (if any pending)
                    if pending_permission_count > 0 {
                        pending_permission_count -= 1;
                        cmd_debug_log(
                            "PERMISSION",
                            &format!("Permission resolved - pending: {} permissions", pending_permission_count),
                        );
                    }
                    // Only decrement for results with tool_use_id (not duplicates)
                    if let Some(ref id) = tool_use_id {
                        if subagent_tool_ids.remove(id) {
                            // This was a subagent
                            pending_subagent_count = pending_subagent_count.saturating_sub(1);
                            cmd_debug_log(
                                "TOOL",
                                &format!(
                                    "Subagent completed (id={}) - pending: {} subagents, {} tools, {} permissions",
                                    id, pending_subagent_count, pending_tool_count, pending_permission_count
                                ),
                            );
                        } else if pending_tool_count > 0 {
                            // Regular tool
                            pending_tool_count -= 1;
                            cmd_debug_log(
                                "TOOL",
                                &format!(
                                    "Tool completed (id={}) - pending: {} subagents, {} tools, {} permissions",
                                    id, pending_subagent_count, pending_tool_count, pending_permission_count
                                ),
                            );
                        }
                    }
                }

                // Text after tools means all tools are done
                if matches!(event, ClaudeEvent::TextDelta { .. })
                    && (pending_tool_count > 0 || pending_subagent_count > 0)
                {
                    cmd_debug_log(
                        "TOOL",
                        &format!(
                            "All tools completed (via text) - was pending: {} subagents, {} tools",
                            pending_subagent_count, pending_tool_count
                        ),
                    );
                    pending_tool_count = 0;
                    pending_subagent_count = 0;
                    subagent_tool_ids.clear();
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

                // Check if this is a "done" signal (Done or Interrupted both end the response)
                let is_done = matches!(event, ClaudeEvent::Done | ClaudeEvent::Interrupted);

                // Check if this is a permission request - we need to release the lock after sending
                let is_permission_request = matches!(event, ClaudeEvent::PermissionRequest { .. });

                match channel.send(event) {
                    Ok(_) => {
                        cmd_debug_log("CHANNEL", &format!("#{} Sent to frontend", event_count))
                    }
                    Err(e) => {
                        cmd_debug_log(
                            "CHANNEL_ERROR",
                            &format!("#{} Send failed: {}", event_count, e),
                        );
                        return Err(e.to_string());
                    }
                }

                // For permission requests, track pending count and release lock to allow response
                // The frontend needs to call send_permission_response which acquires the same lock
                if is_permission_request {
                    pending_permission_count += 1;
                    cmd_debug_log(
                        "PERMISSION_YIELD",
                        &format!(
                            "Permission requested - pending: {} permissions, releasing lock...",
                            pending_permission_count
                        ),
                    );
                    drop(process_guard);
                    // Give frontend time to process and send the response
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    tokio::task::yield_now().await;
                    // Continue to next iteration which will re-acquire the lock
                    continue;
                }

                if is_done {
                    cmd_debug_log(
                        "LOOP",
                        "Got Done/Interrupted event, collecting trailing events...",
                    );
                    // Collect any trailing events that arrived just before/after Done
                    // (Status events from /compact can arrive within ms of Done)
                    // Note: If Closed arrives here, the drain phase of next send_message will handle restart
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

                    cmd_debug_log("LOOP", "Breaking after Done/Interrupted");
                    break;
                }
            }
            Ok(None) => {
                // Channel closed, process ended
                cmd_debug_log("LOOP", "Channel returned None (closed)");
                channel.send(ClaudeEvent::Done).map_err(|e| e.to_string())?;
                break;
            }
            Err(_) => {
                // Timeout - might be end of response
                idle_count += 1;
                cmd_debug_log(
                    "TIMEOUT",
                    &format!(
                        "Idle count: {}/{} (got_content: {}, subagents: {}, tools: {})",
                        idle_count,
                        current_max_idle,
                        got_first_content,
                        pending_subagent_count,
                        pending_tool_count
                    ),
                );
                if idle_count >= current_max_idle {
                    // Likely done responding
                    cmd_debug_log("LOOP", "Max idle reached, sending Done");
                    channel.send(ClaudeEvent::Done).map_err(|e| e.to_string())?;
                    break;
                }
            }
        }
    }

    cmd_debug_log("DONE", &format!("Total events received: {}", event_count));
    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // calculate_timeouts - State Priority Tests
    // -------------------------------------------------------------------------

    #[test]
    fn timeout_compaction_takes_highest_priority() {
        // Compaction should use longest timeout even when other flags are set
        // Args: compacting, subagent_pending, tools_pending, got_first_content
        let (timeout, max_idle) = calculate_timeouts(true, true, true, true);
        assert_eq!(timeout, TIMEOUT_SUBAGENT_MS);
        assert_eq!(max_idle, MAX_IDLE_COMPACTION);
    }

    #[test]
    fn timeout_subagent_takes_second_priority() {
        // Subagent pending should use long timeout when not compacting
        let (timeout, max_idle) = calculate_timeouts(false, true, true, true);
        assert_eq!(timeout, TIMEOUT_SUBAGENT_MS);
        assert_eq!(max_idle, MAX_IDLE_SUBAGENT);
    }

    #[test]
    fn timeout_tools_pending_third_priority() {
        // Regular tools use medium-long timeout
        let (timeout, max_idle) = calculate_timeouts(false, false, true, true);
        assert_eq!(timeout, TIMEOUT_TOOL_EXEC_MS);
        assert_eq!(max_idle, MAX_IDLE_TOOLS);
    }

    #[test]
    fn timeout_streaming_fourth_priority() {
        // Streaming mode when no tools or compaction
        let (timeout, max_idle) = calculate_timeouts(false, false, false, true);
        assert_eq!(timeout, TIMEOUT_STREAMING_MS);
        assert_eq!(max_idle, MAX_IDLE_STREAMING);
    }

    #[test]
    fn timeout_waiting_lowest_priority() {
        // Waiting for first content - default state
        let (timeout, max_idle) = calculate_timeouts(false, false, false, false);
        assert_eq!(timeout, TIMEOUT_WAITING_MS);
        assert_eq!(max_idle, MAX_IDLE_INITIAL);
    }

    // -------------------------------------------------------------------------
    // calculate_timeouts - Edge Cases & Combinations
    // -------------------------------------------------------------------------

    #[test]
    fn timeout_compaction_without_content() {
        // Compaction can happen before any content received
        let (timeout, max_idle) = calculate_timeouts(true, false, false, false);
        assert_eq!(timeout, TIMEOUT_SUBAGENT_MS);
        assert_eq!(max_idle, MAX_IDLE_COMPACTION);
    }

    #[test]
    fn timeout_subagent_without_content() {
        // Subagent can start before text content
        let (timeout, max_idle) = calculate_timeouts(false, true, false, false);
        assert_eq!(timeout, TIMEOUT_SUBAGENT_MS);
        assert_eq!(max_idle, MAX_IDLE_SUBAGENT);
    }

    #[test]
    fn timeout_tools_without_content() {
        // Tools can start before text content (e.g., planning mode)
        let (timeout, max_idle) = calculate_timeouts(false, false, true, false);
        assert_eq!(timeout, TIMEOUT_TOOL_EXEC_MS);
        assert_eq!(max_idle, MAX_IDLE_TOOLS);
    }

    // -------------------------------------------------------------------------
    // calculate_timeouts - Timeout Value Verification
    // -------------------------------------------------------------------------

    #[test]
    fn timeout_values_are_reasonable() {
        // Sanity checks on the actual timeout values
        assert!(
            TIMEOUT_SUBAGENT_MS >= 5000,
            "Subagent execution needs >= 5s timeout"
        );
        assert!(
            TIMEOUT_TOOL_EXEC_MS >= 5000,
            "Tool execution needs >= 5s timeout"
        );
        assert!(
            TIMEOUT_STREAMING_MS >= 1000,
            "Streaming needs >= 1s timeout"
        );
        assert!(TIMEOUT_WAITING_MS >= 100, "Waiting needs >= 100ms polling");
        assert!(
            TIMEOUT_SUBAGENT_MS >= TIMEOUT_TOOL_EXEC_MS,
            "Subagent timeout >= tool timeout"
        );
        assert!(
            TIMEOUT_TOOL_EXEC_MS > TIMEOUT_STREAMING_MS,
            "Tool timeout > streaming"
        );
        assert!(
            TIMEOUT_STREAMING_MS > TIMEOUT_WAITING_MS,
            "Streaming timeout > waiting"
        );
    }

    #[test]
    fn max_idle_provides_sufficient_wait_time() {
        // Verify total wait times are sufficient for each phase
        // Compaction: 30 * 10000ms = 300 seconds (5 minutes)
        let compaction_wait = MAX_IDLE_COMPACTION as u64 * TIMEOUT_SUBAGENT_MS;
        assert!(
            compaction_wait >= 120_000,
            "Compaction should wait >= 2 minutes"
        );

        // Subagent: 30 * 10000ms = 300 seconds (5 minutes)
        let subagent_wait = MAX_IDLE_SUBAGENT as u64 * TIMEOUT_SUBAGENT_MS;
        assert!(
            subagent_wait >= 120_000,
            "Subagent should wait >= 2 minutes"
        );

        // Tools: 24 * 5000ms = 120 seconds (2 minutes)
        let tools_wait = MAX_IDLE_TOOLS as u64 * TIMEOUT_TOOL_EXEC_MS;
        assert!(tools_wait >= 60_000, "Tools should wait >= 1 minute");

        // Streaming: 3 * 2000ms = 6 seconds
        let streaming_wait = MAX_IDLE_STREAMING as u64 * TIMEOUT_STREAMING_MS;
        assert!(
            streaming_wait >= 5_000,
            "Streaming should wait >= 5 seconds"
        );

        // Initial: 60 * 500ms = 30 seconds
        let initial_wait = MAX_IDLE_INITIAL as u64 * TIMEOUT_WAITING_MS;
        assert!(
            initial_wait >= 20_000,
            "Initial wait should be >= 20 seconds"
        );
    }

    // -------------------------------------------------------------------------
    // calculate_timeouts - Boundary Conditions
    // -------------------------------------------------------------------------

    #[test]
    fn timeout_all_flags_false() {
        let (timeout, max_idle) = calculate_timeouts(false, false, false, false);
        assert_eq!(timeout, 500);
        assert_eq!(max_idle, 60);
    }

    #[test]
    fn timeout_all_flags_true() {
        // Compaction takes priority over everything
        let (timeout, max_idle) = calculate_timeouts(true, true, true, true);
        assert_eq!(timeout, 10000);
        assert_eq!(max_idle, 30);
    }
}
