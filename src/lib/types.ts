/**
 * Centralized type definitions for the Claude Terminal application.
 *
 * This file serves as the single source of truth for shared types used
 * across multiple components. Types that are only used within a single
 * component should remain local to that component.
 */

// ============================================================================
// Todo Types
// ============================================================================

/**
 * A todo item in the task list.
 * Used by: App.tsx, TodoPanel.tsx, ToolResult.tsx
 */
export interface Todo {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

// ============================================================================
// Question Types (for AskUserQuestion tool)
// ============================================================================

/**
 * An option in a question prompt.
 * Used by: App.tsx, QuestionPanel.tsx
 */
export interface QuestionOption {
  label: string;
  description: string;
}

/**
 * A question to display to the user.
 * Used by: App.tsx, QuestionPanel.tsx
 */
export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Nested tool execution within a subagent.
 */
export interface SubagentNestedTool {
  name: string;
  input?: string;  // Short preview of input (e.g., file path, search pattern)
}

/**
 * Subagent state for Task tools.
 */
export interface SubagentInfo {
  agentType: string;           // "Explore", "Plan", "deep-research", etc.
  description: string;         // Short description from Task input
  status: "starting" | "running" | "complete" | "error";
  startTime: number;           // Unix timestamp
  duration?: number;           // Calculated on completion (ms)
  nestedTools: SubagentNestedTool[];  // Tools executed within (if streamed)
  toolCount?: number;          // Total tool count from result (nested tools aren't always streamed)
  result?: string;             // Final result text from subagent (up to 500 chars)
}

/**
 * A tool use within a message.
 */
export interface ToolUse {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  isLoading?: boolean;
  autoExpanded?: boolean;  // Forces expanded state (survives component recreation)
  subagent?: SubagentInfo; // Subagent state (only for Task tools)
  startedAt?: number;      // Timestamp when tool started (for elapsed time display)
  completedAt?: number;    // Timestamp when result received
}

/**
 * A content block within a message - allows interleaving text and tool uses.
 */
export type ContentBlock =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: ToolUse }
  | { type: "thinking"; content: string };

/**
 * A message in the conversation.
 */
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;  // Legacy: plain text content
  toolUses?: ToolUse[];  // Legacy: tool uses at end
  contentBlocks?: ContentBlock[];  // New: ordered blocks
  variant?:
    | "divider"
    | "status"
    | "compaction"
    | "cleared"
    | "background_task_running"
    | "background_task_complete";  // Optional styling variant
  faded?: boolean;  // Messages above a clear point (40% opacity)
  interrupted?: boolean;  // Response was interrupted by user (not saved to session)
}

// ============================================================================
// Image Attachment Types
// ============================================================================

/**
 * An image attachment for multimodal messages.
 * Used by: CommandInput.tsx, App.tsx
 */
export interface ImageAttachment {
  id: string;           // Unique ID for component keys
  data: string;         // Base64-encoded image data (without data URL prefix)
  mediaType: string;    // MIME type: "image/png", "image/jpeg", etc.
  thumbnail: string;    // Data URL for preview display
  fileName?: string;    // Original filename if available
  size: number;         // Original file size in bytes
}

/**
 * Supported image formats for Claude API.
 */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/**
 * Maximum file size for images (3.75MB to account for base64 ~33% overhead).
 * Claude API limit is 5MB for base64-encoded data.
 */
export const MAX_IMAGE_SIZE_BYTES = 3.75 * 1024 * 1024;

// ============================================================================
// Event Types (from Tauri IPC)
// ============================================================================

/**
 * Base event type matching Rust ClaudeEvent serialization.
 * Events are discriminated by the `type` field.
 */
export interface BaseClaudeEvent {
  type: string;
}

/**
 * Permission request event from Claude.
 */
export interface PermissionRequestEvent extends BaseClaudeEvent {
  type: "permission_request";
  request_id: string;
  tool_name: string;
  tool_input?: unknown;
  description: string;
}

// ============================================================================
// Subagent Types (for Task tool tracking)
// ============================================================================

/**
 * A nested tool execution within a subagent.
 * Tracks individual tool calls made by the subagent.
 */
export interface NestedToolState {
  id: string;
  name: string;
  status: "pending" | "running" | "complete" | "error";
  startTime: number;
  duration?: number;
}

/**
 * State of an active or completed subagent (Task tool).
 * Used by: SubagentPanel, useSubagentPanel
 */
export interface SubagentState {
  id: string;                    // tool_use_id of the Task call
  agentType: string;             // "Explore", "Plan", "deep-research", etc.
  description: string;           // Short description from Task input
  prompt: string;                // Full prompt (truncated for display)
  status: "starting" | "running" | "complete" | "error";
  startTime: number;             // Unix timestamp
  duration?: number;             // Calculated on completion (ms)
  parentToolId: string | null;   // For nested subagents
  nestedTools: NestedToolState[];// Tools executed within this subagent
  result?: string;               // Final output (truncated)
}

/**
 * Subagent start event from backend.
 */
export interface SubagentStartEvent extends BaseClaudeEvent {
  type: "subagent_start";
  id: string;
  agent_type: string;
  description: string;
  prompt: string;
}

/**
 * Subagent progress event from backend.
 */
export interface SubagentProgressEvent extends BaseClaudeEvent {
  type: "subagent_progress";
  subagent_id: string;
  tool_name: string;
  tool_count: number;
}

/**
 * Subagent end event from backend.
 */
export interface SubagentEndEvent extends BaseClaudeEvent {
  type: "subagent_end";
  id: string;
  agent_type: string;
  duration: number;
  tool_count: number;
  result: string;
}

// ============================================================================
// Session Types (for sidebar)
// ============================================================================

/**
 * A session entry from Claude Code's sessions-index.json.
 * Used by: Sidebar, SessionList, useSidebar
 *
 * Note: Field names match Rust's serde rename attributes (camelCase)
 * to match the JSON serialization from the backend.
 */
export interface SessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}
