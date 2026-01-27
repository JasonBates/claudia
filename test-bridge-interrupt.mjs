#!/usr/bin/env node
/**
 * Bridge Interrupt Test Harness
 *
 * Tests the bridge's ability to:
 * 1. Start and send a message
 * 2. Receive streaming content
 * 3. Send interrupt
 * 4. Respawn Claude internally (bridge stays running)
 * 5. Send another message and receive response
 */

import { spawn } from "child_process";
import * as readline from "readline";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const BRIDGE_PATH = join(__dirname, "sdk-bridge-v2.mjs");
const FIRST_MESSAGE = "Count from 1 to 20 slowly";
const SECOND_MESSAGE = "Say hello";
const INTERRUPT_AFTER_MS = 3000;  // Interrupt 3s after first content

let bridge;
let bridgeRl;
let gotFirstContent = false;
let interruptSent = false;
let readyCount = 0;
let phase = "starting";  // starting -> first_message -> interrupted -> second_message -> done

function log(prefix, msg) {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${ts}] [${prefix}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
}

function sendToBridge(data) {
  const msg = typeof data === "string" ? data : JSON.stringify(data);
  log("SEND", msg.slice(0, 100));
  bridge.stdin.write(msg + "\n");
}

function handleEvent(event) {
  const preview = event.text ? `"${event.text.slice(0,30)}..."` : "";
  log("EVENT", `${event.type} ${preview}`);

  switch (event.type) {
    case "ready":
      readyCount++;
      log("PHASE", `Ready event #${readyCount}, session: ${event.sessionId?.slice(0,8)}...`);

      // First ready just confirms Claude initialized (we already sent first message)
      // Second ready after respawn - send second message
      if (readyCount >= 2 && phase === "interrupted") {
        phase = "second_message";
        log("PHASE", "Respawn complete! Sending second message");
        sendToBridge(SECOND_MESSAGE);
      }
      break;

    case "text_delta":
      process.stdout.write(event.text);  // Show streaming text
      if (!gotFirstContent && phase === "first_message") {
        gotFirstContent = true;
        log("PHASE", `\nGot first content, will interrupt in ${INTERRUPT_AFTER_MS}ms`);
        setTimeout(() => {
          if (!interruptSent && phase === "first_message") {
            interruptSent = true;
            log("PHASE", "\n>>> SENDING INTERRUPT <<<");
            phase = "interrupted";
            sendToBridge({ type: "interrupt" });
          }
        }, INTERRUPT_AFTER_MS);
      }
      break;

    case "interrupted":
      log("PHASE", "Interrupt acknowledged, Claude respawning...");
      // After respawn, Claude needs a message to trigger init
      // Send the second message right away (like a user typing their next prompt)
      setTimeout(() => {
        phase = "second_message";
        log("PHASE", "Sending second message to trigger respawned Claude");
        sendToBridge(SECOND_MESSAGE);
      }, 2000);
      break;

    case "done":
      log("PHASE", `Done in phase: ${phase}`);
      if (phase === "second_message") {
        log("SUCCESS", "✓ Second message completed! Interrupt+respawn works!");
        console.log("\n");
        setTimeout(() => process.exit(0), 500);
      }
      break;

    case "error":
      log("ERROR", event.message);
      break;

    case "closed":
      log("CLOSED", `Bridge reported closed with code ${event.code}`);
      break;
  }
}

// Spawn bridge
log("START", `Spawning bridge: ${BRIDGE_PATH}`);
bridge = spawn("node", [BRIDGE_PATH], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: process.cwd()
});

bridgeRl = readline.createInterface({ input: bridge.stdout });

// Claude CLI needs to receive a message before it sends the init/ready event
// So we send the first message right away (don't wait for ready)
setTimeout(() => {
  log("PHASE", "Sending first message (triggers Claude init)");
  phase = "first_message";
  sendToBridge(FIRST_MESSAGE);
}, 2000);

bridgeRl.on("line", (line) => {
  try {
    const event = JSON.parse(line);
    handleEvent(event);
  } catch (e) {
    log("RAW", line.slice(0, 100));
  }
});

bridge.stderr.on("data", (data) => {
  // Only log errors, not all stderr
  const str = data.toString().trim();
  if (str.includes("Error") || str.includes("error")) {
    log("STDERR", str.slice(0, 200));
  }
});

bridge.on("close", (code) => {
  log("CLOSE", `Bridge process exited with code ${code}`);
  if (phase !== "second_message" && phase !== "done") {
    log("FAIL", `✗ Test failed in phase: ${phase}`);
    process.exit(1);
  }
});

// Timeout
setTimeout(() => {
  log("TIMEOUT", "Test timed out after 90s");
  log("FAIL", `✗ Stuck in phase: ${phase}`);
  bridge.kill();
  process.exit(1);
}, 90000);
