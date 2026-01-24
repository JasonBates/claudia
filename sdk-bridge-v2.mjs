#!/usr/bin/env node
/**
 * Claude Code Bridge with Real Streaming
 *
 * Uses CLI with --include-partial-messages for streaming text chunks.
 * Maintains persistent session via --input-format stream-json.
 */

import { spawn } from "child_process";
import * as readline from "readline";
import { writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

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

  // Track pending control requests for permission responses
  const pendingControlRequests = new Map();

  // Path to our permission MCP server
  const permissionServerPath = join(__dirname, "permission-mcp-server.mjs");

  // MCP config for our permission server
  const mcpConfig = {
    mcpServers: {
      permission: {
        command: "node",
        args: [permissionServerPath],
      }
    }
  };

  debugLog("MCP_CONFIG", mcpConfig);

  const claude = spawn("claude", [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--model", "opus",
    "--verbose",
    "--mcp-config", JSON.stringify(mcpConfig),
    "--permission-prompt-tool", "mcp__permission__permission_prompt"
  ], {
    stdio: ["pipe", "pipe", "pipe"]
  });

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
            sendEvent("ready", {
              sessionId: msg.session_id,
              model: msg.model,
              tools: msg.tools?.length || 0
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
          // Tool result embedded in user message
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
          const inputTokens = (usage.input_tokens || 0) +
                              (usage.cache_creation_input_tokens || 0) +
                              (usage.cache_read_input_tokens || 0);
          const outputTokens = usage.output_tokens || 0;

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
        break;

      case "content_block_stop":
        sendEvent("block_end", {});
        break;

      case "message_delta":
        if (event.delta?.stop_reason === "tool_use") {
          sendEvent("tool_pending", {});
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

    sendEvent("processing", { prompt: input });

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: input }
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
