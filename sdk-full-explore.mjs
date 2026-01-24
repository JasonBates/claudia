#!/usr/bin/env node
/**
 * Full exploration of SDK message types including thinking
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("SDK Full Message Explorer");
  console.log("=".repeat(60));

  const session = unstable_v2_createSession({
    model: 'claude-opus-4-5-20251101',
    // Don't disable thinking
  });

  console.log("\nSending complex prompt to trigger thinking...\n");

  await session.send("Write a haiku about recursion. Think deeply about the concept first.");

  const allMessages = [];

  for await (const msg of session.stream()) {
    allMessages.push(msg);

    // Show type and key fields
    const preview = {
      type: msg.type,
      subtype: msg.subtype,
    };

    // Check for thinking content
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'thinking') {
          preview.thinking = block.thinking?.slice(0, 200) + '...';
        }
        if (block.type === 'text') {
          preview.text = block.text?.slice(0, 200);
        }
      }
    }

    // Check for tool use
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          preview.tool = block.name;
        }
      }
    }

    // Streaming/partial indicators
    if (msg.type === 'content_block_start') preview.block = msg;
    if (msg.type === 'content_block_delta') preview.delta = msg;

    console.log(JSON.stringify(preview, null, 2));
    console.log("---");

    if (msg.type === 'result') break;
  }

  // Summary
  console.log("\n=== Message Types Received ===");
  const types = [...new Set(allMessages.map(m => m.type))];
  console.log(types.join(', '));

  // Check if any message had thinking
  const hasThinking = allMessages.some(m =>
    m.message?.content?.some(b => b.type === 'thinking')
  );
  console.log(`\nThinking blocks present: ${hasThinking}`);

  session.close();
}

main().catch(console.error);
