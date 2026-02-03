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
 * Result from LLM permission review (Bot mode)
 */
export interface ReviewResult {
  safe: boolean;
  reason: string;
}

/**
 * Information about an available update.
 */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string | null;
}

/**
 * Update status states.
 */
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

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
  /** Index of current tool block in streaming.blocks for O(1) updates */
  lastToolBlockIndexRef: { current: number | null };
  /** Map of tool ID to block index for O(1) lookups during UPDATE_TOOL */
  toolIdToBlockIndexRef: { current: Map<string, number> };
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
    /** Request ID from control protocol (for sending response) */
    requestId: string | null;
  };

  // === Planning Mode ===
  planning: {
    /** Plan mode active state */
    isActive: boolean;
    /** Detected plan file path */
    filePath: string | null;
    /** Plan file contents (streams in as written) */
    content: string;
    /** ID of the Planning tool block */
    toolId: string | null;
    /** Tools used during planning (for activity display) */
    nestedTools: { name: string; input?: string }[];
    /** True when ExitPlanMode called (show approval buttons) */
    isReady: boolean;
    /** Path of plan file that needs refresh (set when Edit tool modifies it) */
    needsRefresh: string | null;
    /** Permission request ID for ExitPlanMode (to send control_response) */
    permissionRequestId: string | null;
  };

  // === Permissions ===
  permission: {
    /** Current permission dialog request */
    pending: PermissionRequest | null;
    /** True when Bot mode is reviewing a permission */
    isReviewing: boolean;
    /** Result from LLM review (Bot mode) */
    reviewResult: ReviewResult | null;
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
    /** Message ID waiting for real context from next context_update */
    pendingUpdateMessageId: string | null;
    /** Pre-tokens to display while waiting for update */
    pendingPreTokens: number | null;
  };

  // === Update ===
  update: {
    /** Available update info */
    available: UpdateInfo | null;
    /** Download progress (0-100) */
    downloadProgress: number | null;
    /** Update status */
    status: UpdateStatus;
    /** Error message if any */
    error: string | null;
    /** Version that was dismissed (don't show banner for this version) */
    dismissedVersion: string | null;
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
      requestId: null,
    },
    planning: {
      isActive: false,
      filePath: null,
      content: "",
      toolId: null,
      nestedTools: [],
      isReady: false,
      needsRefresh: null,
      permissionRequestId: null,
    },
    permission: {
      pending: null,
      isReviewing: false,
      reviewResult: null,
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
      pendingUpdateMessageId: null,
      pendingPreTokens: null,
    },
    update: {
      available: null,
      downloadProgress: null,
      status: 'idle',
      error: null,
      dismissedVersion: null,
    },
  };
}
