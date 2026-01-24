#!/usr/bin/env node
/**
 * Test SDK optimizations for maximum speed
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

const PROMPTS = [
  "What's O(1) vs O(n)?",
  "REST vs GraphQL difference?",
  "What is a mutex?",
  "Explain TCP handshake",
  "What's a closure?"
];

async function benchmark(name, fn) {
  console.log(`\n=== ${name} ===`);
  const times = [];

  for (let i = 0; i < PROMPTS.length; i++) {
    const start = performance.now();
    await fn(PROMPTS[i]);
    const elapsed = performance.now() - start;
    times.push(elapsed);
    console.log(`  ${i + 1}: ${elapsed.toFixed(0)}ms`);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const avgAfter = times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1);
  console.log(`  ---`);
  console.log(`  Avg: ${avg.toFixed(0)}ms | Avg (2-5): ${avgAfter.toFixed(0)}ms`);
  return times;
}

// Test 1: Default V2 Session (baseline)
async function testDefault() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101'
  });

  await benchmark("Default V2 (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 2: Minimal - No Claude Code system prompt (SDK default)
async function testMinimalSystemPrompt() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    // Don't use claude_code preset - SDK uses minimal prompt by default
  });

  await benchmark("Minimal System Prompt (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 3: Disable all tools
async function testNoTools() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    disallowedTools: [
      'Read', 'Write', 'Edit', 'MultiEdit',
      'Bash', 'Glob', 'Grep', 'LS',
      'WebFetch', 'WebSearch',
      'Task', 'TodoWrite', 'NotebookEdit',
      'AskFollowupQuestion'
    ]
  });

  await benchmark("No Tools (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 4: Custom minimal system prompt
async function testCustomMinimal() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    systemPrompt: "You are a helpful coding assistant. Be concise."
  });

  await benchmark("Custom Minimal Prompt (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 5: Max tokens limit (force shorter responses)
async function testMaxTokens() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    maxTokens: 256  // Limit output length
  });

  await benchmark("Max 256 Tokens (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 6: Everything combined - maximum optimization
async function testMaxOptimized() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    systemPrompt: "Be concise.",
    disallowedTools: [
      'Read', 'Write', 'Edit', 'MultiEdit',
      'Bash', 'Glob', 'Grep', 'LS',
      'WebFetch', 'WebSearch',
      'Task', 'TodoWrite', 'NotebookEdit',
      'AskFollowupQuestion'
    ],
    maxTokens: 256
  });

  await benchmark("MAX OPTIMIZED (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 7: No thinking
async function testNoThinking() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    maxThinkingTokens: 0
  });

  await benchmark("No Thinking (Opus)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

// Test 8: ULTIMATE - no thinking + short output + minimal prompt
async function testUltimate() {
  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    systemPrompt: "Be very brief.",
    maxThinkingTokens: 0,
    maxTokens: 256,
    disallowedTools: [
      'Read', 'Write', 'Edit', 'MultiEdit',
      'Bash', 'Glob', 'Grep', 'LS',
      'WebFetch', 'WebSearch',
      'Task', 'TodoWrite', 'NotebookEdit',
      'AskFollowupQuestion'
    ]
  });

  await benchmark("ULTIMATE (Opus - no thinking, 256 tokens)", async (prompt) => {
    await session.send(prompt);
    for await (const msg of session.stream()) {
      if (msg.type === 'result') break;
    }
  });

  session.close();
}

async function main() {
  console.log("SDK Optimization Benchmark - Opus 4.5");
  console.log("=".repeat(60));

  await testDefault();
  await testMaxTokens();
  await testNoThinking();
  await testUltimate();

  console.log("\n" + "=".repeat(60));
  console.log("Complete!");
}

main().catch(console.error);
