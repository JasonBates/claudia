import { query } from "@anthropic-ai/claude-code";

for await (const msg of query({ prompt: "say hello briefly", options: { maxTurns: 1 } })) {
  console.log(JSON.stringify(msg, null, 2));
}
