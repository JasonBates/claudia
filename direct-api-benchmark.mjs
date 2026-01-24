#!/usr/bin/env node
/**
 * Compare Direct Anthropic API vs SDK V2 Session
 */

import Anthropic from "@anthropic-ai/sdk";
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

const PROMPTS = [
  "What's O(1) vs O(n)?",
  "REST vs GraphQL difference?",
  "What is a mutex?",
  "Explain TCP handshake",
  "What's a closure?"
];

// Direct Anthropic API
async function testDirectAPI(model, label) {
  console.log(`\n=== Direct API - ${label} ===`);
  const client = new Anthropic();
  const times = [];
  const messages = [];

  for (let i = 0; i < PROMPTS.length; i++) {
    messages.push({ role: "user", content: PROMPTS[i] });

    const start = performance.now();
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [...messages]
    });
    const elapsed = performance.now() - start;
    times.push(elapsed);

    // Add assistant response to maintain conversation
    messages.push({ role: "assistant", content: response.content[0].text });

    console.log(`  ${i + 1}: ${elapsed.toFixed(0)}ms - "${PROMPTS[i]}"`);
  }

  printStats(times);
  return times;
}

// SDK V2 Session
async function testSDKV2(model, label) {
  console.log(`\n=== SDK V2 Session - ${label} ===`);
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
  console.log("Direct API vs SDK V2 Benchmark");
  console.log("=".repeat(60));

  // Haiku comparison
  await testDirectAPI("claude-3-5-haiku-20241022", "Haiku 3.5");
  await testSDKV2("claude-haiku-3-5-20241022", "Haiku 3.5");

  // Opus comparison
  await testDirectAPI("claude-opus-4-5-20251101", "Opus 4.5");
  await testSDKV2("claude-opus-4-5-20251101", "Opus 4.5");

  console.log("\n" + "=".repeat(60));
  console.log("Complete!");
}

main().catch(console.error);
