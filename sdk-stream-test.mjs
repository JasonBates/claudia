#!/usr/bin/env node
/**
 * Test what SDK V2 actually streams
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("Testing SDK V2 streaming...\n");

  const session = unstable_v2_createSession({
    model: 'claude-haiku-3-5-20241022'
  });

  await session.send("Count from 1 to 10, one number per line");

  let msgCount = 0;
  for await (const msg of session.stream()) {
    msgCount++;
    console.log(`[${msgCount}] type=${msg.type}, subtype=${msg.subtype || '-'}`);

    // Log all keys
    console.log(`    keys: ${Object.keys(msg).join(', ')}`);

    // Check for streaming events
    if (msg.event) {
      console.log(`    event.type: ${msg.event.type}`);
    }

    if (msg.type === 'result') break;
  }

  console.log(`\nTotal messages: ${msgCount}`);
  session.close();
}

main().catch(console.error);
