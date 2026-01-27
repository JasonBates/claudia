#!/usr/bin/env node
/**
 * Permission MCP Server for Claude Terminal
 *
 * This MCP server handles permission requests from Claude Code CLI
 * via the --permission-prompt-tool flag. It communicates with the
 * Tauri app through files.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Get session ID from environment (set by Tauri when spawning bridge)
// This ensures multi-instance safety by using unique file paths per app instance
const SESSION_ID = process.env.CLAUDIA_SESSION_ID || "default";
const PERMISSION_REQUEST_FILE = path.join(os.tmpdir(), `claudia-permission-request-${SESSION_ID}.json`);
const PERMISSION_RESPONSE_FILE = path.join(os.tmpdir(), `claudia-permission-response-${SESSION_ID}.json`);
const LOG_FILE = path.join(os.tmpdir(), `claude-permission-mcp-${SESSION_ID}.log`);
const TIMEOUT_MS = 120000; // 2 minute timeout

// Log to file (stderr would interfere with MCP protocol)
function log(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

// Clear log on start
fs.writeFileSync(LOG_FILE, `=== Permission MCP Server started at ${new Date().toISOString()} ===\n`);
log(`Session ID: ${SESSION_ID.substring(0, 8)}...`);

const server = new Server(
  {
    name: "permission-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "permission_prompt",
        description: "Handle permission requests from Claude Code CLI",
        inputSchema: {
          type: "object",
          properties: {
            tool_use_id: {
              type: "string",
              description: "Unique identifier for this tool invocation",
            },
            tool_name: {
              type: "string",
              description: "Name of the tool requesting permission",
            },
            input: {
              type: "object",
              description: "The input parameters for the tool",
            },
          },
          required: ["tool_use_id", "tool_name"],
        },
      },
    ],
  };
});

// Handle permission_prompt calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "permission_prompt") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { tool_use_id, tool_name, input } = request.params.arguments;
  log(`Permission request: tool_name=${tool_name}, tool_use_id=${tool_use_id}`);
  log(`Input: ${JSON.stringify(input)}`);

  // Write request to file for Tauri app to read
  // Field names must match PermissionRequestFromHook interface in tauri.ts
  const permissionRequest = {
    timestamp: Date.now(),
    tool_use_id,
    tool_name,
    tool_input: input || {},
  };

  fs.writeFileSync(PERMISSION_REQUEST_FILE, JSON.stringify(permissionRequest, null, 2));
  log(`Wrote request to ${PERMISSION_REQUEST_FILE}`);

  // Clear any old response file
  try {
    fs.unlinkSync(PERMISSION_RESPONSE_FILE);
  } catch (e) {
    // File might not exist
  }

  // Wait for response from Tauri app
  const startTime = Date.now();
  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Poll every 100ms

    try {
      if (fs.existsSync(PERMISSION_RESPONSE_FILE)) {
        const responseData = fs.readFileSync(PERMISSION_RESPONSE_FILE, "utf-8");
        const response = JSON.parse(responseData);
        log(`Got response: ${JSON.stringify(response)}`);

        // Clean up files
        try { fs.unlinkSync(PERMISSION_REQUEST_FILE); } catch (e) {}
        try { fs.unlinkSync(PERMISSION_RESPONSE_FILE); } catch (e) {}

        // Return MCP response - must match Claude CLI's expected schema exactly
        // IMPORTANT: "allow" responses MUST include "updatedInput" field
        if (response.allow) {
          log(`Allowing ${tool_name}`);
          const result = {
            behavior: "allow",
            updatedInput: input || {}  // Required field - pass through original input
          };
          log(`Returning: ${JSON.stringify(result)}`);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } else {
          log(`Denying ${tool_name}: ${response.message || "User denied"}`);
          const result = { behavior: "deny", message: response.message || "Permission denied by user" };
          log(`Returning: ${JSON.stringify(result)}`);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        }
      }
    } catch (e) {
      log(`Error reading response: ${e.message}`);
    }
  }

  // Timeout - deny by default
  log(`Timeout waiting for permission response for ${tool_name}`);
  try { fs.unlinkSync(PERMISSION_REQUEST_FILE); } catch (e) {}

  const result = { behavior: "deny", message: "Permission request timed out" };
  log(`Returning timeout: ${JSON.stringify(result)}`);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
});

async function main() {
  log("Starting MCP server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected and running");
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
