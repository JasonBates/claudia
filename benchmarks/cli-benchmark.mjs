#!/usr/bin/env node
/**
 * CLI Benchmark - Compare direct CLI with session resume vs SDK
 */

import { spawn } from "child_process";

const PROMPTS = [
  "What's O(1) vs O(n)?",
  "REST vs GraphQL difference?",
  "What is a mutex?",
  "Explain TCP handshake",
  "What's a closure?"
];

async function runClaude(prompt, sessionId = null, model = "sonnet") {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--output-format", "json",
      "--model", model
    ];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Exit ${code}: ${stderr}`));
        return;
      }

      // Parse the JSON output to get session ID
      try {
        const lines = stdout.trim().split("\n");
        let newSessionId = sessionId;
        let result = "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "system" && msg.session_id) {
            newSessionId = msg.session_id;
          }
          if (msg.type === "result") {
            result = msg.result;
          }
        }

        resolve({ sessionId: newSessionId, result });
      } catch (e) {
        resolve({ sessionId: null, result: stdout });
      }
    });
  });
}

async function benchmarkCLI(name, model) {
  console.log(`\n=== ${name} ===`);
  const times = [];
  let sessionId = null;

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    const start = performance.now();

    try {
      const result = await runClaude(prompt, sessionId, model);
      sessionId = result.sessionId;
      const elapsed = performance.now() - start;
      times.push(elapsed);
      console.log(`  ${i + 1}: ${elapsed.toFixed(0)}ms - "${prompt}"`);
    } catch (e) {
      console.log(`  ${i + 1}: ERROR - ${e.message}`);
    }
  }

  if (times.length > 1) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const avgAfterFirst = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
    const min = Math.min(...times);
    const max = Math.max(...times);
    console.log(`  ---`);
    console.log(`  Avg: ${avg.toFixed(0)}ms | Avg (2-5): ${avgAfterFirst.toFixed(0)}ms | Min: ${min.toFixed(0)}ms | Max: ${max.toFixed(0)}ms`);
  }
}

async function main() {
  console.log("Claude CLI Benchmark - Direct CLI with Session Resume");
  console.log("=".repeat(60));

  await benchmarkCLI("CLI - Opus 4.5 (with resume)", "opus");
  await benchmarkCLI("CLI - Sonnet 4.5 (with resume)", "sonnet");
  await benchmarkCLI("CLI - Haiku 3.5 (with resume)", "haiku");

  console.log("\n" + "=".repeat(60));
  console.log("Benchmark complete!");
}

main().catch(console.error);
