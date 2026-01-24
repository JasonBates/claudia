#!/usr/bin/env node
/**
 * Test CLI persistent session with stream-json input/output
 */

import { spawn } from "child_process";
import * as readline from "readline";

const PROMPTS = [
  "Say 'one'",
  "Say 'two'",
  "Say 'three'",
  "Say 'four'",
  "Say 'five'"
];

async function main() {
  console.log("Testing CLI with --input-format stream-json (persistent process)");
  console.log("=".repeat(60));

  const proc = spawn("claude", [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--model", "haiku",
    "--verbose"
  ], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  const rl = readline.createInterface({ input: proc.stdout });

  let currentPromptIndex = 0;
  let messageStart = null;
  let waitingForResult = false;

  rl.on("line", (line) => {
    if (!line.trim()) return;

    try {
      const msg = JSON.parse(line);

      if (msg.type === "system" && msg.subtype === "init") {
        console.log(`  Session: ${msg.session_id}`);
      }

      if (msg.type === "result") {
        const elapsed = performance.now() - messageStart;
        console.log(`  ${currentPromptIndex}: ${elapsed.toFixed(0)}ms - "${PROMPTS[currentPromptIndex - 1]}"`);
        console.log(`    Result: ${msg.result?.slice(0, 50)}`);

        waitingForResult = false;

        // Send next prompt
        if (currentPromptIndex < PROMPTS.length) {
          sendPrompt();
        } else {
          console.log("\n" + "=".repeat(60));
          console.log("Done!");
          proc.stdin.end();
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  proc.stderr.on("data", (data) => {
    console.error("STDERR:", data.toString());
  });

  proc.on("close", (code) => {
    console.log(`Process exited with code ${code}`);
    process.exit(code);
  });

  function sendPrompt() {
    const prompt = PROMPTS[currentPromptIndex];
    currentPromptIndex++;
    messageStart = performance.now();
    waitingForResult = true;

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt }
    }) + "\n";

    proc.stdin.write(msg);
  }

  // Start first prompt after a short delay for init
  setTimeout(sendPrompt, 100);
}

main().catch(console.error);
