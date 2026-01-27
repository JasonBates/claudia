#!/usr/bin/env node
/**
 * Permission Hook for Claude Terminal
 *
 * This hook is called by Claude Code when a permission dialog would appear.
 * It writes the request to a file and waits for the app to respond.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Get session ID from environment (set by Tauri when spawning bridge)
// This ensures multi-instance safety by using unique file paths per app instance
const SESSION_ID = process.env.CLAUDIA_SESSION_ID || 'default';
const PERMISSION_REQUEST_FILE = path.join(os.tmpdir(), `claudia-permission-request-${SESSION_ID}.json`);
const PERMISSION_RESPONSE_FILE = path.join(os.tmpdir(), `claudia-permission-response-${SESSION_ID}.json`);
const TIMEOUT_MS = 60000; // 60 second timeout

async function main() {
  // Read input from stdin
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  const input = JSON.parse(inputData);

  // Write request to file for the app to read
  const request = {
    timestamp: Date.now(),
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    tool_use_id: input.tool_use_id,
    session_id: input.session_id,
    permission_mode: input.permission_mode,
  };

  fs.writeFileSync(PERMISSION_REQUEST_FILE, JSON.stringify(request, null, 2));

  // Clear any old response file
  try {
    fs.unlinkSync(PERMISSION_RESPONSE_FILE);
  } catch (e) {
    // File might not exist
  }

  // Wait for response from app
  const startTime = Date.now();
  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms

    try {
      if (fs.existsSync(PERMISSION_RESPONSE_FILE)) {
        const responseData = fs.readFileSync(PERMISSION_RESPONSE_FILE, 'utf-8');
        const response = JSON.parse(responseData);

        // Clean up files
        try { fs.unlinkSync(PERMISSION_REQUEST_FILE); } catch (e) {}
        try { fs.unlinkSync(PERMISSION_RESPONSE_FILE); } catch (e) {}

        // Return decision to Claude Code
        const output = {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
              behavior: response.allow ? 'allow' : 'deny',
              ...(response.message && { message: response.message }),
            }
          }
        };

        console.log(JSON.stringify(output));
        process.exit(0);
      }
    } catch (e) {
      // Response file not ready yet or invalid
    }
  }

  // Timeout - deny by default
  console.error('Permission request timed out');
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: 'Permission request timed out waiting for user response',
      }
    }
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

main().catch(e => {
  console.error('Hook error:', e.message);
  process.exit(1);
});
