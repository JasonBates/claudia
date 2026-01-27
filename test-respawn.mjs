#!/usr/bin/env node
/**
 * Respawn Test Harness
 *
 * This standalone test simulates what the bridge does:
 * 1. Spawn Claude CLI with stream-json mode
 * 2. Send a message and receive streaming response
 * 3. Interrupt (close stdin to Claude)
 * 4. Respawn Claude
 * 5. Send another message and verify it works
 *
 * Goal: Find the correct way to respawn Claude without restarting the bridge.
 */

import { spawn } from "child_process";
import * as readline from "readline";
import { homedir } from "os";
import { existsSync } from "fs";
import { join } from "path";

// Find Claude binary
function findClaude() {
  const home = homedir();
  const candidates = [
    join(home, ".local/bin/claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("Claude CLI not found");
}

const CLAUDE_PATH = findClaude();
console.log(`Using Claude: ${CLAUDE_PATH}`);

// Build args matching the bridge
function buildArgs() {
  return [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--model", "opus",
    "--verbose",
    "--dangerously-skip-permissions",
    "--settings", JSON.stringify({ alwaysThinkingEnabled: true }),
    "--append-system-prompt", "User's timezone: Europe/London"
  ];
}

// State
let claude = null;
let claudeRl = null;
let currentSessionId = null;
let lineCount = 0;

function log(prefix, msg) {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${ts}] [${prefix}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
}

function spawnClaude() {
  return new Promise((resolve) => {
    log("SPAWN", "Spawning new Claude process...");

    // Clean up old readline if exists
    if (claudeRl) {
      log("SPAWN", "Closing old readline");
      claudeRl.close();
      claudeRl = null;
    }

    currentSessionId = null;

    claude = spawn(CLAUDE_PATH, buildArgs(), {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MAX_THINKING_TOKENS: "10000"
      }
    });

    log("SPAWN", `Claude PID: ${claude.pid}`);

  // Set up readline on stdout
  claudeRl = readline.createInterface({ input: claude.stdout });

  let initResolved = false;

  claudeRl.on("line", (line) => {
    lineCount++;

    try {
      const msg = JSON.parse(line);

      // Extract session ID from init
      if (msg.type === "system" && msg.subtype === "init") {
        currentSessionId = msg.session_id;
        log("READY", `Session: ${currentSessionId?.slice(0, 8)}...`);
        if (!initResolved) {
          initResolved = true;
          resolve();
        }
      }

      // Log streaming text
      if (msg.type === "stream_event" && msg.event?.delta?.text) {
        process.stdout.write(msg.event.delta.text);
      }

      // Log result
      if (msg.type === "result") {
        log("RESULT", `"${msg.result?.slice(0, 50)}..."`);
      }

    } catch (e) {
      log("RAW", line.slice(0, 100));
    }
  });

  claude.stderr.on("data", (data) => {
    const str = data.toString();
    if (str.includes("Error") || str.includes("error")) {
      log("STDERR", str.slice(0, 200));
    }
  });

  claude.on("close", (code) => {
    log("CLOSE", `Claude exited with code ${code}`);
  });

  claude.on("error", (err) => {
    log("ERROR", err.message);
  });

  log("SPAWN", "Claude spawned, waiting for init...");

    // Timeout for init - resolve anyway after 10s
    setTimeout(() => {
      if (!initResolved) {
        log("SPAWN", "Init timeout - continuing anyway");
        initResolved = true;
        resolve();
      }
    }, 10000);
  });
}

function sendMessage(content) {
  if (!claude || !claude.stdin.writable) {
    log("ERROR", "Claude stdin not writable");
    return;
  }

  const msg = JSON.stringify({
    type: "user",
    message: { role: "user", content },
    session_id: currentSessionId,
    parent_tool_use_id: null
  }) + "\n";

  log("SEND", `"${content}"`);
  claude.stdin.write(msg);
}

function interrupt() {
  log("INTERRUPT", "Closing stdin to interrupt Claude...");
  if (claude && claude.stdin) {
    claude.stdin.end();
  }
}

// Test sequence
async function runTest() {
  log("TEST", "=== Starting Respawn Test ===");

  // Phase 1: Initial spawn and wait for init
  log("TEST", "--- Phase 1: Initial Spawn ---");
  await spawnClaude();

  // Phase 2: Send first message
  log("TEST", "--- Phase 2: First Message ---");
  sendMessage("Count from 1 to 5");

  // Wait for some response
  await new Promise(r => setTimeout(r, 5000));

  // Phase 3: Interrupt
  log("TEST", "--- Phase 3: Interrupt ---");
  interrupt();

  // Wait for Claude to close
  await new Promise(r => setTimeout(r, 2000));

  // Phase 4: Respawn and wait for init
  log("TEST", "--- Phase 4: Respawn ---");
  await spawnClaude();

  // Phase 5: Send second message
  log("TEST", "--- Phase 5: Second Message ---");
  sendMessage("Say hello");

  // Wait for response
  await new Promise(r => setTimeout(r, 5000));

  // Done
  log("TEST", `=== Test Complete (${lineCount} lines received) ===`);

  if (claude) {
    claude.kill();
  }
  process.exit(0);
}

// Run with timeout
const timeout = setTimeout(() => {
  log("TIMEOUT", "Test timed out after 60s");
  if (claude) claude.kill();
  process.exit(1);
}, 60000);

runTest().catch(err => {
  log("ERROR", err.message);
  if (claude) claude.kill();
  process.exit(1);
});
