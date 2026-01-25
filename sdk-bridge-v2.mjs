#!/usr/bin/env node
/**
 * Claude Code Bridge with Real Streaming
 *
 * Uses CLI with --include-partial-messages for streaming text chunks.
 * Maintains persistent session via --input-format stream-json.
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

  // Spawn Claude CLI with streaming
  sendEvent("status", { message: "Starting Claude..." });

  const claudePath = findBinary("claude");

  // Detect timezone once at startup
  const userTimezone = getTimezone();
  debugLog("TIMEZONE", userTimezone);
  debugLog("CLAUDE_PATH", claudePath);

  // Let CLI load MCP servers and agents from user's global config (~/.claude/)
  const claude = spawn(claudePath, [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--model", "opus",
    "--verbose",
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify({ alwaysThinkingEnabled: true }),
    "--append-system-prompt", `User's timezone: ${userTimezone}`
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      MAX_THINKING_TOKENS: "10000"
    }
  });

  // Track session ID for message sending
  let currentSessionId = null;

  // Parse Claude's output
  const claudeRl = readline.createInterface({ input: claude.stdout });

  claudeRl.on("line", (line) => {
    debugLog("CLAUDE_RAW", line.slice(0, 500));

    if (!line.trim()) return;

    try {
      const msg = JSON.parse(line);
      debugLog("CLAUDE_PARSED", { type: msg.type, subtype: msg.subtype, hasEvent: !!msg.event });

      switch (msg.type) {
        case "system":
          if (msg.subtype === "init") {
            // Store session ID for subsequent messages
            currentSessionId = msg.session_id;
            debugLog("SESSION_ID", currentSessionId);
            sendEvent("ready", {
              sessionId: msg.session_id,
              model: msg.model,
              tools: msg.tools?.length || 0
            });
          } else if (msg.subtype === "status") {
            // Forward status updates (e.g., "compacting")
            if (msg.status) {
              sendEvent("status", { message: msg.status === "compacting" ? "Compacting conversation..." : msg.status });
            }
          } else if (msg.subtype === "compact_boundary") {
            // Compaction completed - send notification with pre-compaction token count
            const preTokens = msg.compact_metadata?.pre_tokens || 0;
            sendEvent("status", {
              message: `Compacted from ${Math.round(preTokens / 1000)}k`,
              isCompaction: true,
              preTokens: preTokens
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

            // Store request ID for later response
            pendingControlRequests.set("current", requestId);

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

  function handleStreamEvent(event, sessionId) {
    if (!event) return;
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

  // Handle stderr
  claude.stderr.on("data", (data) => {
    const str = data.toString();
    debugLog("CLAUDE_STDERR", str.slice(0, 500));
    if (str.includes("error") || str.includes("Error")) {
      sendEvent("error", { message: str.slice(0, 500) });
    }
  });

  // Forward user input to Claude
  inputRl.on("line", (line) => {
    debugLog("INPUT_RAW", line);
    const input = line.trim();
    if (!input) return;

    // Check if this is a permission response (control_response)
    if (input.startsWith("{")) {
      try {
        const parsed = JSON.parse(input);
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
          claude.stdin.write(msg);
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
          claude.kill();
          process.exit(0);
          return;
        case "help":
          sendEvent("status", {
            message: "Commands: /compact, /clear, /cost, /model, /status, /config, /memory, /review, /doctor, /exit"
          });
          return;
      }

      // All other slash commands: send as user message to CLI
      // This works for: /compact, /clear, /cost, /model, /status, /config, /memory, /review, /doctor, etc.
      debugLog("SLASH_CMD_FORWARD", input);
      const slashMsg = JSON.stringify({
        type: "user",
        message: { role: "user", content: input },
        session_id: currentSessionId,
        parent_tool_use_id: null
      }) + "\n";
      debugLog("CLAUDE_SLASH", slashMsg);
      claude.stdin.write(slashMsg);
      return;
    }

    sendEvent("processing", { prompt: input });

    // Inject current date/time with each message
    const dateTime = getDateTimePrefix();
    const contextualInput = `[${dateTime}] ${input}`;

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: contextualInput },
      session_id: currentSessionId,
      parent_tool_use_id: null
    }) + "\n";

    debugLog("CLAUDE_STDIN", msg);
    claude.stdin.write(msg);
  });

  // Handle process exit
  claude.on("close", (code) => {
    sendEvent("closed", { code });
    process.exit(code || 0);
  });

  inputRl.on("close", () => {
    claude.stdin.end();
  });

  process.on("SIGINT", () => {
    claude.kill();
    process.exit(0);
  });
}

main().catch((e) => {
  sendEvent("error", { message: e.message });
  process.exit(1);
});
