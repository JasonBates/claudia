/**
 * Store type definitions for centralized state management.
 *
 * This module defines the shape of the application state that replaces
 * the distributed state across multiple hooks. The ConversationState
 * interface mirrors the current state shape to enable gradual migration.
 */

import type {
  Message,
  ToolUse,
  ContentBlock,
  Todo,
  Question,
} from "../types";
import type { SessionInfo, PermissionRequest } from "../event-handlers";

/**
 * Mutable refs for streaming JSON accumulation.
 * These MUST remain outside the reactive store to avoid
 * triggering reactivity on every character append during streaming.
 */
export interface StreamingRefs {
  /** Accumulated JSON for current tool input */
  toolInputRef: { current: string };
  /** Accumulated JSON for TodoWrite tool */
  todoJsonRef: { current: string };
  /** Accumulated JSON for AskUserQuestion tool */
  questionJsonRef: { current: string };
  /** Flag indicating TodoWrite collection is active */
  isCollectingTodoRef: { current: boolean };
  /** Flag indicating AskUserQuestion collection is active */
  isCollectingQuestionRef: { current: boolean };
  /** Pending tool results for race condition handling (result before tool_start) */
  pendingResultsRef: { current: Map<string, { result: string; isError: boolean }> };
}

/**
 * Core conversation state managed by the store.
 * Organized into logical sections matching the UI domains.
 */
export interface ConversationState {
  // === Messages ===
  /** Conversation history */
  messages: Message[];

  // === Streaming State ===
  streaming: {
    /** Text being streamed in current response */
    content: string;
    /** Ordered blocks (text + tools) for interleaving display */
    blocks: ContentBlock[];
    /** Extended thinking content */
    thinking: string;
    /** Response in progress flag */
    isLoading: boolean;
    /** Whether to show thinking content */
    showThinking: boolean;
  };

  // === Tool State ===
  tools: {
    /** Tools being executed in current response */
    current: ToolUse[];
  };

  // === Todo Panel ===
  todo: {
    /** Task list from TodoWrite tool */
    items: Todo[];
    /** Panel visibility toggle */
    showPanel: boolean;
    /** Panel slide-out animation state */
    isHiding: boolean;
  };

  // === Question Panel ===
  question: {
    /** Questions from AskUserQuestion tool */
    pending: Question[];
    /** Panel visibility toggle */
    showPanel: boolean;
  };

  // === Planning Mode ===
  planning: {
    /** Plan mode active state */
    isActive: boolean;
    /** Detected plan file path */
    filePath: string | null;
    /** Approval modal visibility */
    showApproval: boolean;
    /** Plan file contents */
    content: string;
  };

  // === Permissions ===
  permission: {
    /** Current permission dialog request */
    pending: PermissionRequest | null;
  };

  // === Session ===
  session: {
    /** Connection status */
    active: boolean;
    /** Model, tokens, context info */
    info: SessionInfo;
    /** Error messages */
    error: string | null;
    /** Launch session ID for "Original Session" feature */
    launchSessionId: string | null;
  };

  // === Compaction ===
  compaction: {
    /** Pre-compaction token count */
    preTokens: number | null;
    /** ID of compaction message */
    messageId: string | null;
    /** Context warning dismissal state */
    warningDismissed: boolean;
  };
}

/**
 * Initial state factory - creates a fresh state object.
 */
export function createInitialState(): ConversationState {
  return {
    messages: [],
    streaming: {
      content: "",
      blocks: [],
      thinking: "",
      isLoading: false,
      showThinking: false,
    },
    tools: {
      current: [],
    },
    todo: {
      items: [],
      showPanel: false,
      isHiding: false,
    },
    question: {
      pending: [],
      showPanel: false,
    },
    planning: {
      isActive: false,
      filePath: null,
      showApproval: false,
      content: "",
    },
    permission: {
      pending: null,
    },
    session: {
      active: false,
      info: {},
      error: null,
      launchSessionId: null,
    },
    compaction: {
      preTokens: null,
      messageId: null,
      warningDismissed: false,
    },
  };
}
