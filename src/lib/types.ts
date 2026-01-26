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
