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

  // Build Claude args - optionally resume a session
  function buildClaudeArgs(resumeSessionId = null) {
    const args = [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--model", "opus",
      "--verbose",
      "--dangerously-skip-permissions",
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
          sendEvent("tool_start", {
            id: event.content_block.id,
            name: event.content_block.name
          });
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
            // Full message - we already streamed chunks, skip
            break;

          case "user":
            // Tool result embedded in user message (e.g., WebSearch results)
            debugLog("USER_MSG", { hasContent: !!msg.message?.content, isArray: Array.isArray(msg.message?.content) });
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              for (const item of msg.message.content) {
                debugLog("USER_CONTENT_ITEM", { type: item.type, hasContent: !!item.content });
                if (item.type === "tool_result") {
                  debugLog("TOOL_RESULT_FROM_USER", { toolUseId: item.tool_use_id, contentLength: item.content?.length });
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
            sendEvent("tool_result", {
              stdout: msg.content || msg.output || "",
              stderr: msg.error || "",
              isError: !!msg.is_error
            });
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
  function sendUserMessage(content) {
    // Inject current date/time with each message
    const dateTime = getDateTimePrefix();
    const contextualInput = `[${dateTime}] ${content}`;

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: contextualInput },
      session_id: currentSessionId,
      parent_tool_use_id: null
    }) + "\n";

    debugLog("CLAUDE_STDIN", msg);

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

          // Send control_response to Claude
          const msg = JSON.stringify({
            type: "control_response",
            request_id: parsed.request_id,
            response: {
              subtype: "success",
              response: {
                behavior: parsed.allow ? "allow" : "deny",
                ...(parsed.remember && { updatedPermissions: true })
              }
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
