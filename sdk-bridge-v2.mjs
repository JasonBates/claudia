#!/usr/bin/env node
/**
 * Claude Code Bridge with Real Streaming
 *
 * Uses CLI with --include-partial-messages for streaming text chunks.
 * Maintains persistent session via --input-format stream-json.
 *
 * Interrupt Handling:
 * - When user presses Escape, we receive {"type":"interrupt"}
 * - We close stdin to Claude (most reliable way to stop generation)
 * - Claude exits, and we IMMEDIATELY respawn (using setImmediate)
 * - The bridge stays running, so next message is fast
 */

import { spawn } from "child_process";
import * as readline from "readline";
import { writeFileSync, appendFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir, homedir } from "os";
import { fileURLToPath } from "url";

// Find binary in common locations (PATH not available in bundled app)
function findBinary(name) {
  const home = homedir();
  const candidates = [
    join(home, ".local/bin", name),
    join(home, ".nvm/versions/node/v22.16.0/bin", name),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return name; // fallback to PATH
}

// Get timezone (already descriptive: "Europe/London", "America/Chicago", etc.)
function getTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Format current date/time for prompt injection
function getDateTimePrefix() {
  const now = new Date();
  return now.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_FILE = join(tmpdir(), "claude-bridge-debug.log");

// Debug logging to file
function debugLog(prefix, data) {
  const timestamp = new Date().toISOString();
  const msg = `[${timestamp}] [${prefix}] ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n`;
  appendFileSync(LOG_FILE, msg);
}

// Clear log on start
writeFileSync(LOG_FILE, `=== Bridge started at ${new Date().toISOString()} ===\n`);

// Unbuffered stdout write
function sendEvent(type, data = {}) {
  const msg = JSON.stringify({ type, ...data }) + '\n';
  debugLog("SEND", { type, ...data });
  writeFileSync(1, msg);
}

async function main() {
  const inputRl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Claude CLI path and timezone (detected once at startup)
  const claudePath = findBinary("claude");
  const userTimezone = getTimezone();
  debugLog("TIMEZONE", userTimezone);
  debugLog("CLAUDE_PATH", claudePath);

  // State managed across respawns
  let claude = null;
  let claudeRl = null;
  let currentSessionId = null;
  let readySent = false;
  let isInterrupting = false;
  let pendingMessages = [];  // Queue messages during respawn
  let isWarmingUp = false;   // Suppress events during warmup
  let currentToolId = null;  // Track current tool ID for tool_result matching
  let currentToolName = null; // Track current tool name for subagent detection

  // Subagent tracking state
  let activeSubagents = new Map();  // tool_use_id -> subagentInfo
  // No stack - use Map ordering for oldest-first attribution
  let taskInputBuffer = "";         // Accumulate JSON for Task tool input parsing

  // Build Claude args - optionally resume a session
  function buildClaudeArgs(resumeSessionId = null) {
    const args = [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--model", "opus",
      "--verbose",
      // Permission handling via control_request events in the stream protocol
      // --permission-prompt-tool stdio enables the control protocol for tool permissions
      // See handlePermissionRequestEvent in event-handlers.ts
      "--permission-prompt-tool", "stdio",
      "--permission-mode", "default",
      "--settings", JSON.stringify({ alwaysThinkingEnabled: true }),
      "--append-system-prompt", `User's timezone: ${userTimezone}`
    ];

    // Resume session if provided (e.g., after interrupt)
    // Or from environment variable (e.g., app startup with --resume)
    const sessionToResume = resumeSessionId || process.env.CLAUDE_RESUME_SESSION;
    if (sessionToResume) {
      debugLog("RESUME", `Resuming session: ${sessionToResume}`);
      args.push("--resume", sessionToResume);
    }

    return args;
  }

  function handleStreamEvent(event, sessionId) {
    if (!event) return;

    // Suppress streaming events during warmup
    if (isWarmingUp) {
      debugLog("WARMUP", `Suppressing stream event: ${event.type}`);
      return;
    }

    debugLog("STREAM_EVENT", { type: event.type, delta: event.delta?.type, hasContentBlock: !!event.content_block });

    switch (event.type) {
      case "content_block_start":
        if (event.content_block?.type === "tool_use") {
          const toolId = event.content_block.id;
          const toolName = event.content_block.name;
          currentToolId = toolId;  // Track for tool_result matching
          currentToolName = toolName;  // Track for subagent detection

          // Detect Task (subagent) invocation
          if (toolName === "Task") {
            taskInputBuffer = "";  // Reset buffer for new Task
            activeSubagents.set(toolId, {
              id: toolId,
              startTime: Date.now(),
              nestedToolCount: 0,
              status: "starting",
              agentType: null,
              description: null,
              prompt: null
            });
            debugLog("SUBAGENT_DETECTED", { toolId, activeCount: activeSubagents.size });
            sendEvent("tool_start", {
              id: toolId,
              name: toolName,
              parent_tool_use_id: null
            });
          } else {
            // Non-Task tool - check if it's running inside a subagent context
            // Find the OLDEST active subagent in "running" status (input fully received)
            let parentSubagentId = null;
            let oldestStartTime = Infinity;
            for (const [id, info] of activeSubagents) {
              if (info.status === "running" && info.startTime < oldestStartTime) {
                oldestStartTime = info.startTime;
                parentSubagentId = id;
              }
            }

            if (parentSubagentId) {
              // Track nested tool within subagent
              const subagent = activeSubagents.get(parentSubagentId);
              subagent.nestedToolCount++;
              subagent.currentNestedToolId = toolId;  // Track for input capture
              sendEvent("subagent_progress", {
                subagentId: parentSubagentId,
                toolName: toolName,
                toolId: toolId,
                toolCount: subagent.nestedToolCount
              });
              debugLog("SUBAGENT_PROGRESS", {
                subagentId: parentSubagentId,
                toolName,
                toolCount: subagent.nestedToolCount
              });
            }

            sendEvent("tool_start", {
              id: toolId,
              name: toolName,
              parent_tool_use_id: parentSubagentId
            });
          }
        }
        // Handle thinking block start
        if (event.content_block?.type === "thinking") {
          sendEvent("thinking_start", { index: event.index });
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
          // Stream text chunk to UI
          sendEvent("text_delta", { text: event.delta.text });
        }
        if (event.delta?.type === "input_json_delta") {
          // Tool input streaming
          sendEvent("tool_input", { json: event.delta.partial_json });

          // Accumulate JSON for Task tools to extract subagent details
          if (currentToolName === "Task" && currentToolId) {
            const subagent = activeSubagents.get(currentToolId);
            if (subagent && subagent.status === "starting") {
              taskInputBuffer += event.delta.partial_json;
              // Try to parse accumulated JSON to extract subagent details
              try {
                const parsed = JSON.parse(taskInputBuffer);
                if (parsed.subagent_type) {
                  subagent.agentType = parsed.subagent_type;
                  subagent.description = parsed.description || "";
                  subagent.prompt = parsed.prompt || "";
                  subagent.status = "running";

                  sendEvent("subagent_start", {
                    id: currentToolId,
                    agentType: parsed.subagent_type,
                    description: parsed.description || "",
                    prompt: (parsed.prompt || "").slice(0, 200)
                  });
                  debugLog("SUBAGENT_START", {
                    id: currentToolId,
                    agentType: parsed.subagent_type,
                    description: parsed.description
                  });
                }
              } catch {
                // JSON incomplete, keep accumulating
              }
            }
          }
        }
        // Handle thinking delta
        if (event.delta?.type === "thinking_delta") {
          sendEvent("thinking_delta", { thinking: event.delta.thinking });
        }
        break;

      case "content_block_stop":
        sendEvent("block_end", {});
        break;

      case "message_delta":
        if (event.delta?.stop_reason === "tool_use") {
          sendEvent("tool_pending", {});
        }
        break;

      case "message_start":
        // Extract token usage from message_start - fires at START of each response
        // This gives us real-time context size before any streaming content
        if (event.message?.usage) {
          const usage = event.message.usage;
          // Context = input + cache_read + cache_creation
          // cache_creation = tokens being cached for first time (not yet in cache_read)
          // On subsequent requests, these move from cache_creation to cache_read
          const inputTokens = (usage.input_tokens || 0) +
                              (usage.cache_read_input_tokens || 0) +
                              (usage.cache_creation_input_tokens || 0);
          debugLog("MESSAGE_START_USAGE", {
            input_tokens: usage.input_tokens,
            cache_creation: usage.cache_creation_input_tokens,
            cache_read: usage.cache_read_input_tokens,
            total: inputTokens
          });
          sendEvent("context_update", {
            inputTokens: inputTokens,
            rawInputTokens: usage.input_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            cacheWrite: usage.cache_creation_input_tokens || 0
          });
        }
        break;
    }
  }

  // Spawn Claude CLI process - optionally resume a session
  function spawnClaude(resumeSessionId = null) {
    debugLog("SPAWN", resumeSessionId
      ? `Starting Claude process (resuming ${resumeSessionId.slice(0,8)}...)`
      : "Starting Claude process...");

    // Clean up old readline if exists
    if (claudeRl) {
      debugLog("SPAWN", "Closing old readline interface");
      claudeRl.close();
      claudeRl = null;
    }

    // Reset state for new process
    readySent = false;
    isInterrupting = false;

    claude = spawn(claudePath, buildClaudeArgs(resumeSessionId), {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MAX_THINKING_TOKENS: "10000"
      }
    });

    debugLog("SPAWN", `Claude PID: ${claude.pid}`);

    // Parse Claude's output
    claudeRl = readline.createInterface({ input: claude.stdout });

    claudeRl.on("line", (line) => {
      debugLog("CLAUDE_RAW", line.slice(0, 500));

      if (!line.trim()) return;

      try {
        const msg = JSON.parse(line);
        debugLog("CLAUDE_PARSED", { type: msg.type, subtype: msg.subtype, hasEvent: !!msg.event });

        switch (msg.type) {
          case "system":
            if (msg.subtype === "init" && !readySent) {
              // Store session ID for subsequent messages
              currentSessionId = msg.session_id;
              debugLog("SESSION_ID", currentSessionId);
              sendEvent("ready", {
                sessionId: msg.session_id,
                model: msg.model,
                tools: msg.tools?.length || 0
              });
              readySent = true;

              // Send any pending messages that were queued during respawn
              sendPendingMessages();
            } else if (msg.subtype === "hook_response" && !readySent) {
              // When resuming a session, Claude CLI doesn't send "init" - it sends hooks instead.
              // Extract session_id from the SessionStart hook response to send a ready event.
              if (msg.hook_event === "SessionStart" && msg.outcome === "success" && msg.session_id) {
                currentSessionId = msg.session_id;
                debugLog("SESSION_ID_FROM_HOOK", currentSessionId);
                sendEvent("ready", {
                  sessionId: msg.session_id,
                  model: "opus",  // Model info not available in hook response
                  tools: 0        // Tool count not available in hook response
                });
                readySent = true;

                // Send any pending messages
                sendPendingMessages();
              }
            } else if (msg.subtype === "status") {
              // Forward status updates (e.g., "compacting")
              if (msg.status) {
                sendEvent("status", { message: msg.status === "compacting" ? "Compacting conversation..." : msg.status });
              }
            } else if (msg.subtype === "compact_boundary") {
              // Compaction completed - send notification with token counts
              const metadata = msg.compact_metadata || {};
              debugLog("COMPACT_BOUNDARY", metadata);
              const preTokens = metadata.pre_tokens || 0;
              const postTokens = metadata.post_tokens || metadata.summary_tokens || 0;
              sendEvent("status", {
                message: "compaction_complete",
                isCompaction: true,
                preTokens: preTokens,
                postTokens: postTokens
              });
            }
            break;

          case "stream_event":
            handleStreamEvent(msg.event, msg.session_id);
            break;

          case "assistant":
            // Check for nested tool calls from subagents
            // Claude CLI provides parent_tool_use_id in the message to identify which subagent
            // spawned this tool call - use it for correct attribution
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              // Use parent_tool_use_id from message for correct subagent attribution
              const parentSubagentId = msg.parent_tool_use_id;

              for (const block of msg.message.content) {
                if (block.type === "tool_use") {
                  // Skip Task tools - they create new subagents, not nested tool calls
                  if (block.name === "Task") {
                    debugLog("SKIPPING_TASK_AS_NESTED", { toolId: block.id });
                    continue;
                  }

                  // Only track as nested if we have a valid parent subagent
                  if (parentSubagentId && activeSubagents.has(parentSubagentId)) {
                    const subagent = activeSubagents.get(parentSubagentId);
                    subagent.nestedToolCount++;

                    // Extract a short description from tool input
                    let toolDetail = "";
                    const input = block.input || {};
                    if (block.name === "Bash" && input.description) {
                      toolDetail = input.description;
                    } else if (block.name === "Bash" && input.command) {
                      toolDetail = input.command.slice(0, 50) + (input.command.length > 50 ? "..." : "");
                    } else if (block.name === "Glob" && input.pattern) {
                      toolDetail = input.pattern;
                    } else if (block.name === "Grep" && input.pattern) {
                      toolDetail = `"${input.pattern}"`;
                    } else if (block.name === "Read" && input.file_path) {
                      toolDetail = input.file_path.split("/").pop(); // Just filename
                    } else if (block.name === "Edit" && input.file_path) {
                      toolDetail = input.file_path.split("/").pop();
                    } else if (block.name === "Write" && input.file_path) {
                      toolDetail = input.file_path.split("/").pop();
                    } else if (block.name === "WebFetch" && input.url) {
                      toolDetail = new URL(input.url).hostname;
                    } else if (block.name === "WebSearch" && input.query) {
                      toolDetail = `"${input.query.slice(0, 40)}"`;
                    }

                    sendEvent("subagent_progress", {
                      subagentId: parentSubagentId,
                      toolName: block.name,
                      toolId: block.id,
                      toolDetail: toolDetail,
                      toolCount: subagent.nestedToolCount
                    });
                    debugLog("SUBAGENT_PROGRESS_FROM_ASSISTANT", {
                      subagentId: parentSubagentId,
                      toolName: block.name,
                      toolDetail: toolDetail,
                      toolCount: subagent.nestedToolCount
                    });
                  }
                }
              }
            }
            break;

          case "user":
            // Tool result embedded in user message (e.g., WebSearch results)
            debugLog("USER_MSG", { hasContent: !!msg.message?.content, isArray: Array.isArray(msg.message?.content) });
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              for (const item of msg.message.content) {
                debugLog("USER_CONTENT_ITEM", { type: item.type, hasContent: !!item.content });
                if (item.type === "tool_result") {
                  debugLog("TOOL_RESULT_FROM_USER", { toolUseId: item.tool_use_id, contentLength: item.content?.length });

                  // Check if this completes a subagent (Task tool)
                  const completedToolId = item.tool_use_id;
                  if (completedToolId && activeSubagents.has(completedToolId)) {
                    const subagent = activeSubagents.get(completedToolId);
                    subagent.status = "complete";
                    const duration = Date.now() - subagent.startTime;

                    sendEvent("subagent_end", {
                      id: completedToolId,
                      agentType: subagent.agentType || "unknown",
                      duration: duration,
                      toolCount: subagent.nestedToolCount,
                      result: (typeof item.content === 'string' ? item.content : JSON.stringify(item.content)).slice(0, 500)
                    });
                    debugLog("SUBAGENT_END_FROM_USER", {
                      id: completedToolId,
                      agentType: subagent.agentType,
                      duration,
                      toolCount: subagent.nestedToolCount
                    });

                    activeSubagents.delete(completedToolId);
                  }

                  sendEvent("tool_result", {
                    tool_use_id: item.tool_use_id,
                    stdout: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
                    stderr: "",
                    isError: item.is_error || false
                  });
                }
              }
            }
            // Legacy format
            if (msg.tool_use_result) {
              sendEvent("tool_result", {
                stdout: msg.tool_use_result.stdout?.slice(0, 500),
                stderr: msg.tool_use_result.stderr?.slice(0, 200),
                isError: msg.tool_use_result.is_error
              });
            }
            break;

          case "tool_result":
            // Standalone tool result - tool completed successfully
            // Use tool_use_id from message if available (more reliable for parallel tools)
            const completedToolId = msg.tool_use_id || currentToolId;
            debugLog("TOOL_RESULT_STANDALONE", { msgToolUseId: msg.tool_use_id, currentToolId, completedToolId });

            // Check if this completes a subagent (Task tool)
            if (activeSubagents.has(completedToolId)) {
              const subagent = activeSubagents.get(completedToolId);
              subagent.status = "complete";
              const duration = Date.now() - subagent.startTime;

              sendEvent("subagent_end", {
                id: completedToolId,
                agentType: subagent.agentType || "unknown",
                duration: duration,
                toolCount: subagent.nestedToolCount,
                result: (msg.content || msg.output || "").slice(0, 500)
              });
              debugLog("SUBAGENT_END", {
                id: completedToolId,
                agentType: subagent.agentType,
                duration,
                toolCount: subagent.nestedToolCount
              });

              activeSubagents.delete(completedToolId);
            }

            // Include currentToolId so frontend can match result to tool
            sendEvent("tool_result", {
              tool_use_id: completedToolId,
              stdout: msg.content || msg.output || "",
              stderr: msg.error || "",
              isError: !!msg.is_error
            });
            currentToolId = null;  // Clear after use
            currentToolName = null;  // Clear tool name
            break;

          case "control_request":
            // Handle permission requests via control protocol
            if (msg.request?.subtype === "can_use_tool") {
              const requestId = msg.request_id;
              const toolName = msg.request.tool_name || "unknown";
              const toolInput = msg.request.input || {};

              debugLog("CONTROL_REQUEST", { requestId, toolName, toolInput });

              sendEvent("permission_request", {
                requestId,
                toolName,
                toolInput,
                description: `Allow ${toolName}?`
              });
            }
            break;

          case "result":
            // Skip result/done during warmup (but end warmup)
            if (isWarmingUp) {
              debugLog("WARMUP", "Warmup complete, suppressing result event");
              isWarmingUp = false;
              break;
            }

            // Extract token usage
            const usage = msg.usage || {};
            // Context = input + cache_read + cache_creation (consistent with message_start)
            // Note: Frontend uses context_update for display, this is just for consistency
            const inputTokens = (usage.input_tokens || 0) +
                                (usage.cache_read_input_tokens || 0) +
                                (usage.cache_creation_input_tokens || 0);
            const outputTokens = usage.output_tokens || 0;

            // Note: Rust expects camelCase, then serializes to TypeScript as snake_case
            sendEvent("result", {
              content: msg.result?.slice(0, 1000),
              cost: msg.total_cost_usd,
              duration: msg.duration_ms,
              turns: msg.num_turns,
              isError: msg.is_error,
              inputTokens,
              outputTokens,
              cacheRead: usage.cache_read_input_tokens || 0,
              cacheWrite: usage.cache_creation_input_tokens || 0
            });
            sendEvent("done", {});
            break;
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    // Handle stderr
    claude.stderr.on("data", (data) => {
      const str = data.toString();
      debugLog("CLAUDE_STDERR", str.slice(0, 500));
      if (str.includes("error") || str.includes("Error")) {
        sendEvent("error", { message: str.slice(0, 500) });
      }
    });

    // Handle Claude process exit - IMMEDIATELY respawn if interrupted
    claude.on("close", (code) => {
      debugLog("CLAUDE_CLOSE", { code, isInterrupting, sessionId: currentSessionId });

      if (isInterrupting) {
        // Interrupted - respawn immediately, resuming the same session
        // This preserves conversation context after interrupt
        const sessionToResume = currentSessionId;
        debugLog("RESPAWN", `Respawning Claude with --resume ${sessionToResume?.slice(0,8)}...`);
        sendEvent("interrupted", {});
        setImmediate(() => {
          spawnClaude(sessionToResume);
        });
      } else {
        // Normal exit - close the bridge
        sendEvent("closed", { code });
        process.exit(code || 0);
      }
    });

    claude.on("error", (err) => {
      debugLog("CLAUDE_ERROR", err.message);
      sendEvent("error", { message: err.message });
    });
  }

  // Send pending messages that were queued during respawn
  function sendPendingMessages() {
    if (pendingMessages.length > 0) {
      debugLog("PENDING", `Sending ${pendingMessages.length} pending messages`);
      for (const msg of pendingMessages) {
        debugLog("PENDING_SEND", msg);
        claude.stdin.write(msg);
      }
      pendingMessages = [];
    }
  }

  // Send a user message to Claude
  // Supports both plain text and JSON-prefixed multimodal messages
  function sendUserMessage(content) {
    // Inject current date/time with each message
    const dateTime = getDateTimePrefix();

    let messageContent;

    // Check for JSON-prefixed message (multimodal with images)
    // Format: __JSON__{"content":[{type:"image",...},{type:"text",...}]}
    if (content.startsWith("__JSON__")) {
      try {
        const jsonData = JSON.parse(content.slice(8)); // Remove "__JSON__" prefix

        // jsonData.content is array of content blocks
        // Prepend date/time to the text block(s)
        messageContent = jsonData.content.map(block => {
          if (block.type === "text") {
            return { ...block, text: `[${dateTime}] ${block.text}` };
          }
          return block;
        });

        debugLog("MULTIMODAL", `Sending ${messageContent.length} content blocks (${messageContent.filter(b => b.type === "image").length} images)`);
      } catch (e) {
        debugLog("MULTIMODAL_ERROR", `Failed to parse JSON content: ${e.message}`);
        // Fallback to plain text
        messageContent = `[${dateTime}] ${content}`;
      }
    } else {
      // Plain text (existing behavior)
      messageContent = `[${dateTime}] ${content}`;
    }

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: messageContent },
      session_id: currentSessionId,
      parent_tool_use_id: null
    }) + "\n";

    // Log truncated version (images are large)
    const logMsg = msg.length > 500 ? msg.slice(0, 500) + `... (${msg.length} bytes total)` : msg;
    debugLog("CLAUDE_STDIN", logMsg);

    // Only queue if Claude process isn't available (during respawn)
    // Note: We must NOT queue based on readySent - Claude needs to receive
    // a message first before it outputs the init event
    if (!claude || !claude.stdin || !claude.stdin.writable) {
      debugLog("QUEUE", "Queueing message - Claude process not ready");
      pendingMessages.push(msg);
    } else {
      claude.stdin.write(msg);
    }
  }

  // Handle interrupt - kill Claude process to stop generation immediately
  function handleInterrupt() {
    if (!claude || isInterrupting) return;

    debugLog("INTERRUPT", "Killing Claude process to interrupt");
    isInterrupting = true;

    // Kill the process - stdin.end() doesn't stop Claude fast enough
    // The close handler will respawn automatically
    claude.kill('SIGTERM');
  }

  // Initial spawn
  spawnClaude();

  // Warmup: Send a /status command to trigger Claude's init immediately
  // This way Claude is ready by the time the user types their first message
  setTimeout(() => {
    if (claude && claude.stdin.writable) {
      debugLog("WARMUP", "Sending /status to trigger Claude init");
      isWarmingUp = true;
      const warmupMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: "/status" },
        session_id: currentSessionId,
        parent_tool_use_id: null
      }) + "\n";
      claude.stdin.write(warmupMsg);
    }
  }, 100);

  // Forward user input to Claude
  inputRl.on("line", (line) => {
    debugLog("INPUT_RAW", line);
    const input = line.trim();
    if (!input) return;

    // Check for interrupt signal
    if (input.startsWith("{")) {
      try {
        const parsed = JSON.parse(input);

        // Handle interrupt
        if (parsed.type === "interrupt") {
          debugLog("INTERRUPT_RECEIVED", parsed);
          handleInterrupt();
          return;
        }

        // Handle permission response (control_response)
        if (parsed.type === "control_response") {
          debugLog("CONTROL_RESPONSE_FROM_UI", parsed);

          // Send control_response to Claude - format matches SDK's internal structure:
          // { type: "control_response", response: { subtype: "success", request_id, response: {...} } }
          // The inner response must match canUseTool callback return format:
          // For "allow": { behavior: "allow", updatedInput: {...} }
          // For "deny": { behavior: "deny", message: "..." }
          const permissionResponse = parsed.allow
            ? { behavior: "allow", updatedInput: parsed.tool_input || {} }
            : { behavior: "deny", message: "User denied permission" };

          const msg = JSON.stringify({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: parsed.request_id,
              response: permissionResponse
            }
          }) + "\n";

          debugLog("CLAUDE_STDIN", msg);
          if (claude && claude.stdin.writable) {
            claude.stdin.write(msg);
          }
          return;
        }
      } catch (e) {
        // Not JSON, treat as regular message
      }
    }

    // Handle slash commands
    if (input.startsWith("/")) {
      const [cmd, ...args] = input.slice(1).split(" ");
      debugLog("SLASH_CMD", { cmd, args });

      // Local-only commands (don't forward to CLI)
      switch (cmd.toLowerCase()) {
        case "exit":
        case "quit":
          sendEvent("status", { message: "Exiting..." });
          if (claude) claude.kill();
          process.exit(0);
          return;
        case "help":
          sendEvent("status", {
            message: "Commands: /compact, /clear, /cost, /model, /status, /config, /memory, /review, /doctor, /exit"
          });
          return;
        case "clear":
          // Handle /clear locally by generating a new session ID
          // This makes the CLI treat subsequent messages as a new conversation
          // without needing to restart the process
          debugLog("CLEAR", "Generating new session ID to clear context");
          currentSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          debugLog("CLEAR", `New session ID: ${currentSessionId}`);
          sendEvent("status", { message: "Context cleared" });
          sendEvent("ready", {
            sessionId: currentSessionId,
            model: "opus",
            tools: 0  // Will be updated on next message
          });
          readySent = true;  // Mark ready as sent for the new session
          sendEvent("done", {});
          return;
      }

      // All other slash commands: send as user message to CLI
      // This works for: /compact, /cost, /model, /status, /config, /memory, /review, /doctor, etc.
      debugLog("SLASH_CMD_FORWARD", input);
      const slashMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: input },
        session_id: currentSessionId,
        parent_tool_use_id: null
      }) + "\n";
      debugLog("CLAUDE_SLASH", slashMsg);
      if (claude && claude.stdin.writable) {
        claude.stdin.write(slashMsg);
      }
      return;
    }

    sendEvent("processing", { prompt: input });
    sendUserMessage(input);
  });

  inputRl.on("close", () => {
    if (claude && claude.stdin) {
      claude.stdin.end();
    }
  });

  process.on("SIGINT", () => {
    if (claude) claude.kill();
    process.exit(0);
  });
}

main().catch((e) => {
  sendEvent("error", { message: e.message });
  process.exit(1);
});
