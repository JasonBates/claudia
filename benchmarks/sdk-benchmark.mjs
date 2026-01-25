#!/usr/bin/env node
/**
 * Comprehensive SDK Benchmark
 * Tests various configurations for fastest response times
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

const PROMPTS = [
  "What's O(1) vs O(n)?",
  "REST vs GraphQL difference?",
  "What is a mutex?",
  "Explain TCP handshake",
  "What's a closure?"
];
const NUM_MESSAGES = 5;

async function benchmark(name, fn) {
  console.log(`\n=== ${name} ===`);
  const times = [];

  for (let i = 0; i < NUM_MESSAGES; i++) {
    const prompt = PROMPTS[i];
    const start = performance.now();
    try {
      await fn(i, prompt);
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
    console.log(`  Avg: ${avg.toFixed(0)}ms | Avg (2-${NUM_MESSAGES}): ${avgAfterFirst.toFixed(0)}ms | Min: ${min.toFixed(0)}ms | Max: ${max.toFixed(0)}ms`);
  }

  return times;
}

// Test: V2 Session with Opus 4.5 (with thinking - default)
async function testV2OpusThinking() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101'
  });

  await benchmark("V2 Session - Opus 4.5 (thinking)", async (i, prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test: V2 Session with Opus 4.5 (no thinking)
async function testV2OpusNoThinking() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    maxThinkingTokens: 0
  });

  await benchmark("V2 Session - Opus 4.5 (no thinking)", async (i, prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test: V2 Session with Sonnet (for comparison)
async function testV2Sonnet() {
  const session = unstable_v2_createSession({
    model: 'claude-sonnet-4-5-20250929'
  });

  await benchmark("V2 Session - Sonnet 4.5", async (i, prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test: V2 Session with Haiku (fastest)
async function testV2Haiku() {
  const session = unstable_v2_createSession({
    model: 'claude-haiku-3-5-20241022'
  });

  await benchmark("V2 Session - Haiku 3.5", async (i, prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

async function main() {
  console.log("Claude Code SDK Benchmark - Opus 4.5 Thinking Test");
  console.log(`Prompts: ${PROMPTS.length} technical questions`);
  console.log("=".repeat(60));

  // Test Opus with and without thinking
  await testV2OpusThinking();     // Opus 4.5 with thinking (default)
  await testV2OpusNoThinking();   // Opus 4.5 without thinking

  // Comparison models
  await testV2Sonnet();           // Sonnet 4.5
  await testV2Haiku();            // Haiku 3.5 (fastest)

  console.log("\n" + "=".repeat(60));
  console.log("Benchmark complete!");
}

main().catch(console.error);
