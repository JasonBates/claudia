#!/usr/bin/env node
/**
 * Explore all message types from SDK V2 session
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("SDK Message Types Explorer");
  console.log("=".repeat(60));

  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101'
  });

  console.log("\nSending: 'What is 2+2? Think step by step.'\n");

  await session.send("What is 2+2? Think step by step.");

  for await (const msg of session.stream()) {
    // Log full message structure
    console.log(`[${msg.type}]`, JSON.stringify(msg, null, 2).slice(0, 500));
    console.log("---");

    if (msg.type === 'result') break;
  }

  session.close();
  console.log("\nDone!");
}

main().catch(console.error);
