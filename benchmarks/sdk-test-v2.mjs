#!/usr/bin/env node
/**
 * SDK V2 API and Streaming Tests
 * Tests the unstable V2 persistent session API and partial message streaming
 */

import {
  query,
  unstable_v2_createSession,
  unstable_v2_prompt
} from "@anthropic-ai/claude-agent-sdk";

const TEST_PROMPT = "Say 'hello' and nothing else";

// Test 1: V2 One-shot prompt
async function testV2Prompt() {
  console.log("\n=== Test 1: V2 One-shot Prompt ===");
  const start = performance.now();

  try {
    const result = await unstable_v2_prompt(TEST_PROMPT, {
      model: 'claude-sonnet-4-5-20250929'
    });
    console.log(`  Result: ${result.result?.slice(0, 50)}`);
    console.log(`  Cost: $${result.total_cost_usd}`);
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  console.log(`  Total: ${(performance.now() - start).toFixed(0)}ms`);
}

// Test 2: V2 Persistent Session - Multi-turn
async function testV2Session() {
  console.log("\n=== Test 2: V2 Persistent Session ===");

  try {
    const session = unstable_v2_createSession({
      model: 'claude-sonnet-4-5-20250929'
    });

    // First message
    console.log("  Sending first message...");
    const start1 = performance.now();
    await session.send("Remember the number 42");

    let firstResponse = null;
    for await (const msg of session.stream()) {
      if (msg.type === 'result') {
        firstResponse = msg;
        break;
      }
    }
    console.log(`  First message: ${(performance.now() - start1).toFixed(0)}ms`);
    console.log(`  Session ID: ${session.sessionId}`);

    // Second message (should be faster - no spawn overhead)
    console.log("  Sending second message...");
    const start2 = performance.now();
    await session.send("What number did I tell you?");

    for await (const msg of session.stream()) {
      if (msg.type === 'assistant') {
        const text = msg.message?.content?.[0]?.text;
        if (text) console.log(`  Response: ${text.slice(0, 50)}`);
      }
      if (msg.type === 'result') {
        break;
      }
    }
    console.log(`  Second message: ${(performance.now() - start2).toFixed(0)}ms`);

    // Third message
    console.log("  Sending third message...");
    const start3 = performance.now();
    await session.send("Now multiply it by 2");

    for await (const msg of session.stream()) {
      if (msg.type === 'assistant') {
        const text = msg.message?.content?.[0]?.text;
        if (text) console.log(`  Response: ${text.slice(0, 50)}`);
      }
      if (msg.type === 'result') {
        break;
      }
    }
    console.log(`  Third message: ${(performance.now() - start3).toFixed(0)}ms`);

    session.close();
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    console.log(e.stack);
  }
}

// Test 3: Partial message streaming
async function testPartialMessages() {
  console.log("\n=== Test 3: Partial Message Streaming ===");

  const start = performance.now();
  let firstChunkTime = null;
  let chunkCount = 0;

  for await (const message of query({
    prompt: "Count from 1 to 5, one number per line",
    options: {
      maxTurns: 1,
      includePartialMessages: true
    }
  })) {
    if (message.type === 'stream_event') {
      if (firstChunkTime === null) {
        firstChunkTime = performance.now() - start;
        console.log(`  First chunk: ${firstChunkTime.toFixed(0)}ms`);
      }
      chunkCount++;

      // Show delta text if available
      if (message.event?.type === 'content_block_delta') {
        const delta = message.event.delta;
        if (delta?.type === 'text_delta') {
          process.stdout.write(delta.text);
        }
      }
    }
  }

  console.log(`\n  Total chunks: ${chunkCount}`);
  console.log(`  Total time: ${(performance.now() - start).toFixed(0)}ms`);
}

// Test 4: Query with streamInput for multi-turn
async function testStreamInput() {
  console.log("\n=== Test 4: Query with StreamInput ===");

  try {
    // Create async generator for messages
    async function* messageGenerator() {
      yield {
        type: 'user',
        message: { role: 'user', content: 'Remember: the secret word is banana' },
        parent_tool_use_id: null,
        session_id: ''
      };
    }

    const q = query({
      prompt: messageGenerator(),
      options: { maxTurns: 1 }
    });

    const start = performance.now();
    let sessionId = null;

    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        console.log(`  Session: ${sessionId}`);
      }
      if (msg.type === 'assistant') {
        const text = msg.message?.content?.[0]?.text;
        if (text) console.log(`  Response: ${text.slice(0, 50)}`);
      }
      if (msg.type === 'result') {
        console.log(`  First turn: ${(performance.now() - start).toFixed(0)}ms`);
        break;
      }
    }

    // Now test second turn with same query object using streamInput
    console.log("  Testing follow-up via streamInput...");
    const start2 = performance.now();

    async function* followUp() {
      yield {
        type: 'user',
        message: { role: 'user', content: 'What was the secret word?' },
        parent_tool_use_id: null,
        session_id: sessionId
      };
    }

    await q.streamInput(followUp());

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const text = msg.message?.content?.[0]?.text;
        if (text) console.log(`  Response: ${text.slice(0, 50)}`);
      }
      if (msg.type === 'result') {
        console.log(`  Second turn: ${(performance.now() - start2).toFixed(0)}ms`);
        break;
      }
    }

    q.close();
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
}

// Run tests
async function main() {
  console.log("Claude Code SDK V2 & Streaming Tests");
  console.log("=====================================");

  await testPartialMessages();
  await testV2Session();
}

main().catch(console.error);
