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
 * A tool use within a message.
 */
export interface ToolUse {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  isLoading?: boolean;
  autoExpanded?: boolean;  // Forces expanded state (survives component recreation)
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
  variant?: "divider" | "status" | "compaction" | "cleared";  // Optional styling variant
  faded?: boolean;  // Messages above a clear point (40% opacity)
  interrupted?: boolean;  // Response was interrupted by user (not saved to session)
}

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
