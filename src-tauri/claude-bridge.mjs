#!/usr/bin/env node
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";
import { writeFileSync } from "fs";

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

let sessionId = null;

// Use sync write to fd 1 (stdout) to bypass Node's buffering
function sendEvent(type, data) {
  const msg = JSON.stringify({ type, ...data }) + '\n';
  writeFileSync(1, msg);
}

async function handleMessage(prompt) {
  try {
    const options = {
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      cwd: process.cwd(),
    };

    if (sessionId) {
      options.resume = sessionId;
    }

    for await (const message of query({ prompt, options })) {
      // Capture session ID from init message
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        sendEvent("system", { message: "Session started", sessionId });
        continue;
      }

      // Handle different message types
      if (message.type === "assistant") {
        // Extract text content
        if (message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              sendEvent("text", { content: block.text });
            } else if (block.type === "tool_use") {
              sendEvent("tool_use", {
                id: block.id,
                name: block.name,
                input: block.input,
              });
            }
          }
        }
      } else if (message.type === "result") {
        sendEvent("result", {
          content: message.result || "",
          cost: message.total_cost_usd,
          turns: message.num_turns,
        });
        sendEvent("done", {});
      } else if (message.type === "tool_progress") {
        sendEvent("tool_progress", {
          id: message.tool_use_id,
          name: message.tool_name,
          elapsed: message.elapsed_time_seconds,
        });
      }
    }

    sendEvent("done", {});
  } catch (error) {
    sendEvent("error", { message: error.message });
  }
}

// Read prompts from stdin, one per line
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed) {
    handleMessage(trimmed);
  }
});

rl.on("close", () => {
  process.exit(0);
});

sendEvent("ready", {});
