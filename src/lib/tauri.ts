import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { runWithOwner, batch, Owner } from "solid-js";
import type { SessionEntry } from "./types";

export interface ClaudeEvent {
  type:
    | "status"
    | "ready"
    | "processing"
    | "text_delta"
    | "thinking_start"
    | "thinking_delta"
    | "tool_start"
    | "tool_input"
    | "tool_pending"
    | "permission_request"
    | "tool_result"
    | "block_end"
    | "context_update"
    | "result"
    | "done"
    | "closed"
    | "error";
  // Status/Ready
  message?: string;
  is_compaction?: boolean;
  pre_tokens?: number;
  post_tokens?: number;
  session_id?: string;
  model?: string;
  tools?: number;
  // Processing
  prompt?: string;
  // TextDelta
  text?: string;
  // Thinking
  thinking?: string;
  index?: number;
  // ToolStart
  id?: string;
  name?: string;
  // ToolInput
  json?: string;
  // PermissionRequest (control_request with can_use_tool)
  request_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  description?: string;
  // ToolResult
  tool_use_id?: string;
  stdout?: string;
  stderr?: string;
  is_error?: boolean;
  // ContextUpdate (real-time context from message_start)
  raw_input_tokens?: number;
  // Result
  content?: string;
  cost?: number;
  duration?: number;
  turns?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read?: number;
  cache_write?: number;
  // Closed
  code?: number;
}

export interface Config {
  anthropic_api_key?: string;
  default_working_dir?: string;
  theme: string;
  content_margin: number;
  font_family: string;
  font_size: number;
  color_scheme?: string;
}

export interface ColorSchemeInfo {
  name: string;
  path?: string;
  is_bundled: boolean;
}

export interface ColorSchemeColors {
  bg: string;
  bg_secondary: string;
  bg_tertiary: string;
  fg: string;
  fg_muted: string;
  accent: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  cyan: string;
  magenta: string;
  violet: string;
  border: string;
  user_bg: string;
  code_bg: string;
}

export async function startSession(workingDir?: string): Promise<string> {
  return await invoke<string>("start_session", { workingDir });
}

export async function sendMessage(
  message: string,
  onEvent: (event: ClaudeEvent) => void,
  owner?: Owner | null
): Promise<void> {
  const channel = new Channel<ClaudeEvent>();

  // Wrap the callback with SolidJS reactive context restoration
  // Tauri channel callbacks run outside SolidJS's tracking, so we restore context
  channel.onmessage = (event) => {
    console.log("[TAURI CHANNEL] Received event:", event.type);

    if (owner) {
      runWithOwner(owner, () => {
        batch(() => {
          onEvent(event);
        });
      });
    } else {
      onEvent(event);
    }
  };

  console.log("[TAURI] Calling invoke send_message");
  await invoke("send_message", { message, channel });
  console.log("[TAURI] invoke send_message returned");
}

export async function stopSession(): Promise<void> {
  await invoke("stop_session");
}

/**
 * Send an interrupt signal to stop the current Claude response.
 * The bridge will respawn Claude internally so the next message is fast.
 */
export async function sendInterrupt(): Promise<void> {
  console.log("[TAURI] Sending interrupt signal");
  await invoke("send_interrupt");
}

/**
 * Clear the session by restarting the Claude process.
 * This is the only way to actually clear context in stream-json mode,
 * as slash commands don't work when sent as message content.
 */
export async function clearSession(
  onEvent: (event: ClaudeEvent) => void,
  owner?: Owner | null
): Promise<void> {
  const channel = new Channel<ClaudeEvent>();

  channel.onmessage = (event) => {
    console.log("[TAURI CHANNEL] Clear session event:", event.type);

    if (owner) {
      runWithOwner(owner, () => {
        batch(() => {
          onEvent(event);
        });
      });
    } else {
      onEvent(event);
    }
  };

  console.log("[TAURI] Calling invoke clear_session");
  await invoke("clear_session", { channel });
  console.log("[TAURI] invoke clear_session returned");
}

export async function getConfig(): Promise<Config> {
  return await invoke("get_config");
}

export async function saveConfig(config: Config): Promise<void> {
  await invoke("save_config", { config });
}

export async function isSessionActive(): Promise<boolean> {
  return await invoke("is_session_active");
}

export async function sendPermissionResponse(requestId: string, allow: boolean, remember?: boolean): Promise<void> {
  await invoke("send_permission_response", { requestId, allow, remember: remember || false });
}

// Hook-based permission system
export interface PermissionRequestFromHook {
  timestamp: number;
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  session_id: string;
  permission_mode: string;
}

export async function pollPermissionRequest(): Promise<PermissionRequestFromHook | null> {
  return await invoke("poll_permission_request");
}

export async function respondToPermission(allow: boolean, message?: string): Promise<void> {
  await invoke("respond_to_permission", { allow, message });
}

export async function getLaunchDir(): Promise<string> {
  return await invoke<string>("get_launch_dir");
}

// ============================================================================
// Sync Functions (CCMS integration)
// ============================================================================

export interface SyncResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * Pull latest ~/.claude/ from remote machine
 * Called on app startup to get latest session data
 */
export async function syncPull(): Promise<SyncResult> {
  return await invoke<SyncResult>("sync_pull");
}

/**
 * Push local ~/.claude/ to remote machine
 * Called periodically during work and on app close
 */
export async function syncPush(): Promise<SyncResult> {
  return await invoke<SyncResult>("sync_push");
}

/**
 * Get sync status (dry-run showing what would change)
 */
export async function syncStatus(): Promise<SyncResult> {
  return await invoke<SyncResult>("sync_status");
}

/**
 * Check if sync is available (ccms installed and configured)
 */
export async function isSyncAvailable(): Promise<boolean> {
  return await invoke<boolean>("is_sync_available");
}

// ============================================================================
// Streaming Command Runner
// ============================================================================

/**
 * Events emitted during streaming command execution
 */
export interface CommandEvent {
  type: "started" | "stdout" | "stderr" | "completed" | "error";
  command_id: string;
  command?: string; // for "started"
  line?: string; // for "stdout" / "stderr"
  exit_code?: number; // for "completed"
  success?: boolean; // for "completed"
  message?: string; // for "error"
}

/**
 * Run an external command with streaming output
 *
 * @param program - The command to run (e.g., "ccms", "npm", "cargo")
 * @param args - Command arguments
 * @param onEvent - Callback for each event (stdout line, stderr line, completion)
 * @param workingDir - Optional working directory
 * @param owner - SolidJS owner for reactivity context
 * @returns The command ID
 */
export async function runStreamingCommand(
  program: string,
  args: string[],
  onEvent: (event: CommandEvent) => void,
  workingDir?: string,
  owner?: Owner | null
): Promise<string> {
  const channel = new Channel<CommandEvent>();

  // Restore SolidJS reactive context for channel callbacks
  channel.onmessage = (event) => {
    if (owner) {
      runWithOwner(owner, () => {
        batch(() => {
          onEvent(event);
        });
      });
    } else {
      onEvent(event);
    }
  };

  return await invoke<string>("run_streaming_command", {
    program,
    args,
    workingDir,
    channel,
  });
}

// ============================================================================
// Session Listing (for sidebar)
// ============================================================================

/**
 * List sessions for a given working directory.
 * Reads from Claude Code's sessions-index.json file.
 * Returns sessions sorted by modified date (newest first), excluding sidechains.
 */
export async function listSessions(workingDir: string): Promise<SessionEntry[]> {
  return await invoke<SessionEntry[]>("list_sessions", { workingDir });
}

/**
 * Delete a session by its ID.
 * Removes the JSONL file and updates sessions-index.json.
 */
export async function deleteSession(sessionId: string, workingDir: string): Promise<void> {
  await invoke("delete_session", { sessionId, workingDir });
}

/**
 * Resume a previous session by ID.
 * This restarts the Claude process with the --resume flag.
 */
export async function resumeSession(
  sessionId: string,
  onEvent: (event: ClaudeEvent) => void
): Promise<string> {
  const channel = new Channel<ClaudeEvent>();
  channel.onmessage = onEvent;
  return await invoke<string>("resume_session", { sessionId, channel });
}

/**
 * Message from session history
 */
export interface HistoryMessage {
  id: string;
  role: string;
  content: string;
}

/**
 * Get the message history for a session.
 * Reads the JSONL file and extracts user/assistant messages.
 */
export async function getSessionHistory(
  sessionId: string,
  workingDir: string
): Promise<HistoryMessage[]> {
  return await invoke<HistoryMessage[]>("get_session_history", {
    sessionId,
    workingDir,
  });
}

/**
 * Close the application window
 */
export async function quitApp(): Promise<void> {
  await getCurrentWindow().close();
}

// ============================================================================
// Appearance Commands
// ============================================================================

/**
 * List available color schemes (bundled + user .itermcolors files)
 */
export async function listColorSchemes(): Promise<ColorSchemeInfo[]> {
  return await invoke<ColorSchemeInfo[]>("list_color_schemes");
}

/**
 * Get color values for a specific scheme
 */
export async function getSchemeColors(name: string): Promise<ColorSchemeColors> {
  return await invoke<ColorSchemeColors>("get_scheme_colors", { name });
}
