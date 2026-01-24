#!/usr/bin/env node
/**
 * SDK Performance Testing
 * Tests different approaches to find fastest response method
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const TEST_PROMPT = "Say 'hello' and nothing else";

// Helper to time async operations
async function timeIt(name, fn) {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  console.log(`[${name}] ${elapsed.toFixed(0)}ms`);
  return { result, elapsed };
}

// Test 1: Basic query with full iteration
async function testBasicQuery() {
  console.log("\n=== Test 1: Basic Query ===");

  let firstMessageTime = null;
  let messageCount = 0;
  const start = performance.now();

  for await (const message of query({ prompt: TEST_PROMPT })) {
    if (firstMessageTime === null) {
      firstMessageTime = performance.now() - start;
      console.log(`  First message: ${firstMessageTime.toFixed(0)}ms`);
    }
    messageCount++;
    console.log(`  [${message.type}] ${message.subtype || ''}`);
  }

  const total = performance.now() - start;
  console.log(`  Total: ${total.toFixed(0)}ms, Messages: ${messageCount}`);
}

// Test 2: Query with maxTurns=1
async function testMaxTurns() {
  console.log("\n=== Test 2: maxTurns=1 ===");

  let firstMessageTime = null;
  let messageCount = 0;
  const start = performance.now();

  for await (const message of query({
    prompt: TEST_PROMPT,
    options: { maxTurns: 1 }
  })) {
    if (firstMessageTime === null) {
      firstMessageTime = performance.now() - start;
      console.log(`  First message: ${firstMessageTime.toFixed(0)}ms`);
    }
    messageCount++;
    console.log(`  [${message.type}] ${message.subtype || ''}`);
  }

  const total = performance.now() - start;
  console.log(`  Total: ${total.toFixed(0)}ms, Messages: ${messageCount}`);
}

// Test 3: Query with no tools allowed
async function testNoTools() {
  console.log("\n=== Test 3: No Tools ===");

  let firstMessageTime = null;
  let messageCount = 0;
  const start = performance.now();

  for await (const message of query({
    prompt: TEST_PROMPT,
    options: {
      maxTurns: 1,
      allowedTools: []
    }
  })) {
    if (firstMessageTime === null) {
      firstMessageTime = performance.now() - start;
      console.log(`  First message: ${firstMessageTime.toFixed(0)}ms`);
    }
    messageCount++;
    console.log(`  [${message.type}] ${message.subtype || ''}`);
  }

  const total = performance.now() - start;
  console.log(`  Total: ${total.toFixed(0)}ms, Messages: ${messageCount}`);
}

// Test 4: Session resume performance
async function testSessionResume() {
  console.log("\n=== Test 4: Session Resume ===");

  // First query to get session ID
  let sessionId = null;
  console.log("  First query (new session)...");
  const start1 = performance.now();

  for await (const message of query({
    prompt: "Remember the number 42",
    options: { maxTurns: 1 }
  })) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
    }
  }
  console.log(`  First query: ${(performance.now() - start1).toFixed(0)}ms`);
  console.log(`  Session ID: ${sessionId}`);

  // Second query with resume
  console.log("  Second query (resume)...");
  const start2 = performance.now();
  let firstMessageTime = null;

  for await (const message of query({
    prompt: "What number did I tell you?",
    options: {
      maxTurns: 1,
      resume: sessionId
    }
  })) {
    if (firstMessageTime === null) {
      firstMessageTime = performance.now() - start2;
    }
    if (message.type === "assistant") {
      console.log(`  Response: ${JSON.stringify(message.message?.content?.[0]?.text?.slice(0, 50))}`);
    }
  }
  console.log(`  Resume query: ${(performance.now() - start2).toFixed(0)}ms`);
  console.log(`  First message: ${firstMessageTime?.toFixed(0)}ms`);
}

// Test 5: Log all message types in detail
async function testMessageTypes() {
  console.log("\n=== Test 5: Message Types Detail ===");

  for await (const message of query({
    prompt: TEST_PROMPT,
    options: { maxTurns: 1 }
  })) {
    console.log(`  Type: ${message.type}, Subtype: ${message.subtype || 'none'}`);
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        console.log(`    Content block: ${block.type} = ${JSON.stringify(block.text?.slice(0, 50) || block)}`);
      }
    }
    if (message.type === "result") {
      console.log(`    Result: ${JSON.stringify(message.result?.slice(0, 50))}`);
      console.log(`    Cost: $${message.total_cost_usd}`);
    }
  }
}

// Run all tests
async function main() {
  console.log("Claude Code SDK Performance Tests");
  console.log("==================================");

  try {
    await testBasicQuery();
    await testMaxTurns();
    await testNoTools();
    await testSessionResume();
    await testMessageTypes();
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
