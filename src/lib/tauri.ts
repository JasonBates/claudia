import { invoke, Channel } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { runWithOwner, batch, Owner } from "solid-js";
import type { SessionEntry } from "./types";
import type { ReviewResult } from "./store/types";

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
    | "ask_user_question"
    | "tool_result"
    | "block_end"
    | "context_update"
    | "result"
    | "done"
    | "interrupted"
    | "closed"
    | "error"
    | "subagent_start"
    | "subagent_progress"
    | "subagent_end"
    | "bg_task_registered"
    | "bg_task_completed"
    | "bg_task_result";
  // Status/Ready
  // snake_case from Rust/Tauri backend, camelCase from JS SDK bridge
  message?: string;
  is_compaction?: boolean;
  isCompaction?: boolean;
  pre_tokens?: number;
  preTokens?: number;
  post_tokens?: number;
  postTokens?: number;
  session_id?: string;
  sessionId?: string;
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
  // snake_case from Rust/Tauri backend, camelCase from JS SDK bridge
  request_id?: string;
  requestId?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: unknown;
  toolInput?: unknown;
  description?: string;
  // ToolResult
  tool_use_id?: string;
  stdout?: string;
  stderr?: string;
  is_error?: boolean;
  isError?: boolean;
  // Result / ContextUpdate
  // snake_case from Rust/Tauri backend, camelCase from JS SDK bridge
  content?: string;
  cost?: number;
  duration?: number;
  turns?: number;
  input_tokens?: number;
  inputTokens?: number;
  output_tokens?: number;
  outputTokens?: number;
  cache_read?: number;
  cacheRead?: number;
  cache_write?: number;
  cacheWrite?: number;
  raw_input_tokens?: number;
  rawInputTokens?: number;
  // Closed
  code?: number;
  // SubagentStart
  agent_type?: string;
  agentType?: string;
  // SubagentProgress
  subagent_id?: string;
  tool_detail?: string;
  tool_count?: number;
  // SubagentEnd (uses existing duration, result fields)
  result?: string;
  // Background task events (snake_case from Rust, camelCase from JS bridge)
  task_id?: string;
  taskId?: string;
  toolUseId?: string;
  summary?: string;
  status?: string;
  // AskUserQuestion (control_request for AskUserQuestion tool)
  questions?: unknown[];
}

export interface Config {
  anthropic_api_key?: string;
  default_working_dir?: string;
  theme: string;
  content_margin: number;
  font_family: string;
  font_size: number;
  color_scheme?: string;
  window_width?: number;
  window_height?: number;
  permission_mode?: string; // "auto" | "request" | "plan" | "bot"
  sandbox_enabled?: boolean;
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
  quote: string;
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

export async function saveConfig(
  config: Config,
  saveLocally: boolean = false
): Promise<void> {
  await invoke("save_config", { config, saveLocally });
}

export async function hasLocalConfig(): Promise<boolean> {
  return await invoke("has_local_config");
}

export async function isSessionActive(): Promise<boolean> {
  return await invoke("is_session_active");
}

export async function sendPermissionResponse(requestId: string, allow: boolean, remember?: boolean, toolInput?: unknown, message?: string): Promise<void> {
  await invoke("send_permission_response", { requestId, allow, remember: remember || false, toolInput: toolInput || {}, message: message || null });
}

export async function sendQuestionResponse(requestId: string, questions: unknown[], answers: Record<string, string | string[]>): Promise<void> {
  await invoke("send_question_response", { requestId, questions, answers });
}

export async function sendQuestionCancel(requestId: string): Promise<void> {
  await invoke("send_question_cancel", { requestId });
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

// ============================================================================
// Bot Mode / LLM Review
// ============================================================================

// Re-export ReviewResult from store types (single source of truth)
export type { ReviewResult };

export async function reviewPermissionRequest(
  toolName: string,
  toolInput: unknown,
  description?: string
): Promise<ReviewResult> {
  return await invoke("review_permission_request", { toolName, toolInput, description });
}

export async function getBotApiKey(): Promise<string | null> {
  return await invoke("get_bot_api_key");
}

export async function hasBotApiKey(): Promise<boolean> {
  return await invoke("has_bot_api_key");
}

export async function setBotApiKey(apiKey: string): Promise<void> {
  await invoke("set_bot_api_key", { apiKey });
}

export async function validateBotApiKey(): Promise<boolean> {
  return await invoke("validate_bot_api_key");
}

export async function getLaunchDir(): Promise<string> {
  return await invoke<string>("get_launch_dir");
}

export async function isSandboxEnabled(): Promise<boolean> {
  return await invoke<boolean>("is_sandbox_enabled");
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
 * @param program - The command to run (e.g., "npm", "cargo")
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

// ============================================================================
// Session Custom Names
// ============================================================================

/**
 * Get all custom session names.
 * Returns a map of sessionId -> customName.
 */
export async function getSessionNames(): Promise<Record<string, string>> {
  return await invoke<Record<string, string>>("get_session_names");
}

/**
 * Set a custom name for a session.
 * Pass an empty string to remove the custom name.
 */
export async function setSessionName(sessionId: string, name: string): Promise<void> {
  await invoke("set_session_name", { sessionId, name });
}

/**
 * Delete a custom name for a session.
 */
export async function deleteSessionName(sessionId: string): Promise<void> {
  await invoke("delete_session_name", { sessionId });
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
 * Exit the application
 */
export async function quitApp(): Promise<void> {
  await exit(0);
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

// ============================================================================
// New Window / Project Switching
// ============================================================================

/**
 * Open a new Claudia window with the specified directory.
 * Uses the Rust backend to spawn a new app instance via macOS open command.
 *
 * @param directory - The directory to open in the new window
 */
export async function openInNewWindow(directory: string): Promise<void> {
  console.log("[TAURI] Opening new window for directory:", directory);
  await invoke("open_new_window", { directory });
  console.log("[TAURI] New window opened");
}

/**
 * Close current window and reopen in a different directory.
 * This spawns a new instance with the directory as CLI argument, then exits.
 *
 * @param directory - The directory to reopen in
 */
export async function reopenInDirectory(directory: string): Promise<void> {
  console.log("[TAURI] Reopening in directory:", directory);
  await invoke("reopen_in_directory", { directory });
  // App will exit after this, no need for anything else
}

/**
 * Check if a CLI directory argument was provided when launching the app.
 * Used to skip the project picker when the app is reopened in a specific directory.
 */
export async function hasCliDirectory(): Promise<boolean> {
  return await invoke<boolean>("has_cli_directory");
}

/**
 * Status of Claude Code CLI installation
 */
export interface ClaudeCodeStatus {
  /** Whether Claude Code CLI is installed and accessible */
  installed: boolean;
  /** Version string if installed (e.g., "1.0.30") */
  version: string | null;
  /** Path to the claude binary if found */
  path: string | null;
}

/**
 * Check if Claude Code CLI is installed.
 * Called at startup to show a friendly install message if needed.
 */
export async function checkClaudeCodeInstalled(): Promise<ClaudeCodeStatus> {
  return await invoke<ClaudeCodeStatus>("check_claude_code_installed");
}

// ============================================================================
// Project Listing (for project picker)
// ============================================================================

/**
 * Information about a Claude Code project
 */
export interface ProjectInfo {
  encodedName: string; // "-Users-jasonbates-Code-repos-my-project"
  decodedPath: string; // "/Users/jasonbates/Code/repos/my-project"
  displayName: string; // "my-project"
  lastUsed: number; // Unix timestamp (from most recent session file)
  sessionCount: number; // Number of .jsonl files
  isNew: boolean; // True for newly opened directories with no sessions yet
}

/**
 * List all Claude Code projects, sorted by most recently used.
 * Reads from ~/.claude/projects/ directory.
 */
export async function listProjects(): Promise<ProjectInfo[]> {
  return await invoke<ProjectInfo[]>("list_projects");
}

// ============================================================================
// Auto-Update
// ============================================================================

/**
 * Information about an available update
 */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string | null;
}

// Store the Update object for download after check
let pendingUpdate: Update | null = null;

/**
 * Check for available updates.
 * Returns update info if an update is available, null otherwise.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    console.log("[UPDATE] Checking for updates...");
    const update = await check();

    if (update) {
      console.log("[UPDATE] Update available:", update.version);
      pendingUpdate = update;
      return {
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body ?? null,
      };
    }

    console.log("[UPDATE] No update available");
    pendingUpdate = null;
    return null;
  } catch (error) {
    console.error("[UPDATE] Check failed:", error);
    pendingUpdate = null;
    throw error;
  }
}

/**
 * Download and install the pending update.
 *
 * @param onProgress - Callback with download progress (0-100)
 */
export async function downloadAndInstallUpdate(
  onProgress: (progress: number) => void
): Promise<void> {
  if (!pendingUpdate) {
    // Re-check for updates if no pending update
    const update = await check();
    if (!update) {
      throw new Error("No update available");
    }
    pendingUpdate = update;
  }

  console.log("[UPDATE] Starting download...");
  let downloaded = 0;
  let contentLength = 0;

  await pendingUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength || 0;
        console.log("[UPDATE] Download started, size:", contentLength);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          const progress = Math.round((downloaded / contentLength) * 100);
          onProgress(progress);
        }
        break;
      case "Finished":
        console.log("[UPDATE] Download finished");
        onProgress(100);
        break;
    }
  });

  console.log("[UPDATE] Update installed, ready to restart");
  pendingUpdate = null;
}

/**
 * Restart the app to apply the update.
 */
export async function restartApp(): Promise<void> {
  console.log("[UPDATE] Restarting app...");
  await relaunch();
}

/**
 * Get the current app version from Tauri.
 */
export async function getAppVersion(): Promise<string> {
  return await getVersion();
}
