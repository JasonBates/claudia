#!/usr/bin/env node
/**
 * Compare CLI persistent vs SDK V2 session
 */

import { spawn } from "child_process";
import * as readline from "readline";
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

const PROMPTS = [
  "What's O(1) vs O(n)?",
  "REST vs GraphQL difference?",
  "What is a mutex?",
  "Explain TCP handshake",
  "What's a closure?"
];

// CLI Persistent Test
async function testCLIPersistent(model) {
  return new Promise((resolve) => {
    console.log(`\n=== CLI Persistent - ${model} ===`);
    const times = [];

    const proc = spawn("claude", [
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--model", model,
      "--verbose"
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const rl = readline.createInterface({ input: proc.stdout });
    let idx = 0;
    let start = null;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "result") {
          const elapsed = performance.now() - start;
          times.push(elapsed);
          console.log(`  ${idx}: ${elapsed.toFixed(0)}ms - "${PROMPTS[idx - 1]}"`);

          if (idx < PROMPTS.length) {
            sendNext();
          } else {
            printStats(times);
            proc.stdin.end();
            resolve(times);
          }
        }
      } catch {}
    });

    proc.on("close", () => resolve(times));

    function sendNext() {
      start = performance.now();
      idx++;
      proc.stdin.write(JSON.stringify({
        type: "user",
        message: { role: "user", content: PROMPTS[idx - 1] }
      }) + "\n");
    }

    setTimeout(sendNext, 100);
  });
}

// SDK V2 Test
async function testSDKV2(model) {
  console.log(`\n=== SDK V2 Session - ${model} ===`);
  const times = [];

  const session = unstable_v2_createSession({ model });

  for (let i = 0; i < PROMPTS.length; i++) {
    const start = performance.now();
    await session.send(PROMPTS[i]);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
    const elapsed = performance.now() - start;
    times.push(elapsed);
    console.log(`  ${i + 1}: ${elapsed.toFixed(0)}ms - "${PROMPTS[i]}"`);
  }

  session.close();
  printStats(times);
  return times;
}

function printStats(times) {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const avgAfter = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
  console.log(`  ---`);
  console.log(`  Avg: ${avg.toFixed(0)}ms | Avg (2-5): ${avgAfter.toFixed(0)}ms`);
}

async function main() {
  console.log("Persistent Session Benchmark: CLI vs SDK");
  console.log("=".repeat(60));

  // Opus 4.5 comparison
  await testCLIPersistent("opus");
  await testSDKV2("claude-opus-4-5-20251101");

  console.log("\n" + "=".repeat(60));
  console.log("Complete!");
}

main().catch(console.error);
