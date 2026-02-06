/**
 * Action type definitions for centralized state management.
 *
 * All state transitions are expressed as discriminated union actions.
 * This provides:
 * - Type-safe dispatch with autocomplete
 * - Predictable state changes (easier debugging)
 * - Testable reducers (pure functions)
 */

import type {
  Message,
  ToolUse,
  ContentBlock,
  Todo,
  Question,
  SubagentInfo,
} from "../types";
import type { SessionInfo, PermissionRequest } from "../event-handlers";
import type { ReviewResult, UpdateInfo, UpdateStatus } from "./types";

/**
 * Discriminated union of all possible actions.
 * Each action represents a single, atomic state transition.
 */
export type Action =
  // === Message Actions ===
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "UPDATE_MESSAGE"; payload: { id: string; updates: Partial<Message> } }
  | { type: "SET_MESSAGES"; payload: Message[] }
  | { type: "CLEAR_MESSAGES" }

  // === Streaming Actions ===
  | { type: "APPEND_STREAMING_CONTENT"; payload: string }
  | { type: "SET_STREAMING_CONTENT"; payload: string }
  | { type: "APPEND_STREAMING_THINKING"; payload: string }
  | { type: "SET_STREAMING_THINKING"; payload: string }
  | { type: "SET_STREAMING_LOADING"; payload: boolean }
  | { type: "ADD_STREAMING_BLOCK"; payload: ContentBlock }
  | { type: "SET_STREAMING_BLOCKS"; payload: ContentBlock[] }
  | {
      type: "FINISH_STREAMING";
      payload?: { interrupted?: boolean; generateId: () => string };
    }
  | { type: "RESET_STREAMING" }
  | { type: "SET_SHOW_THINKING"; payload: boolean }
  | { type: "TOGGLE_SHOW_THINKING" }

  // === Tool Actions ===
  | { type: "ADD_TOOL"; payload: ToolUse }
  | { type: "UPDATE_TOOL"; payload: { id: string; updates: Partial<ToolUse> } }
  | {
      type: "UPDATE_TOOL_SUBAGENT";
      payload: { id: string; subagent: Partial<SubagentInfo> };
    }
  | { type: "UPDATE_LAST_TOOL_INPUT"; payload: unknown }
  | { type: "SET_TOOLS"; payload: ToolUse[] }
  | { type: "CLEAR_TOOLS" }

  // === Todo Actions ===
  | { type: "SET_TODOS"; payload: Todo[] }
  | { type: "SET_TODO_PANEL_VISIBLE"; payload: boolean }
  | { type: "SET_TODO_PANEL_HIDING"; payload: boolean }

  // === Question Actions ===
  | { type: "SET_QUESTIONS"; payload: Question[] }
  | { type: "SET_QUESTION_PANEL_VISIBLE"; payload: boolean }
  | { type: "SET_PENDING_QUESTION_REQUEST_ID"; payload: string | null }
  | { type: "CLEAR_QUESTION_PANEL" }

  // === Planning Actions ===
  | { type: "SET_PLANNING_ACTIVE"; payload: boolean }
  | { type: "SET_PLAN_FILE_PATH"; payload: string | null }
  | { type: "SET_PLAN_CONTENT"; payload: string }
  | { type: "SET_PLANNING_TOOL_ID"; payload: string | null }
  | { type: "ADD_PLANNING_NESTED_TOOL"; payload: { name: string; input?: string } }
  | { type: "SET_PLAN_READY"; payload: boolean }
  | { type: "SET_PLAN_NEEDS_REFRESH"; payload: string }
  | { type: "CLEAR_PLAN_NEEDS_REFRESH" }
  | { type: "SET_PLAN_PERMISSION_REQUEST_ID"; payload: string | null }
  | { type: "EXIT_PLANNING" }

  // === Permission Actions ===
  | { type: "ENQUEUE_PERMISSION"; payload: PermissionRequest }
  | { type: "DEQUEUE_PERMISSION"; payload: string }
  | { type: "SET_PERMISSION_REVIEWING"; payload: { requestId: string; reviewing: boolean } }
  | { type: "SET_REVIEW_RESULT"; payload: { requestId: string; result: ReviewResult | null } }
  | { type: "CLEAR_PERMISSION_QUEUE" }

  // === Session Actions ===
  | { type: "SET_SESSION_ACTIVE"; payload: boolean }
  | { type: "UPDATE_SESSION_INFO"; payload: Partial<SessionInfo> }
  | { type: "SET_SESSION_INFO"; payload: SessionInfo }
  | { type: "SET_SESSION_ERROR"; payload: string | null }
  | { type: "SET_LAUNCH_SESSION_ID"; payload: string | null }

  // === Compaction Actions ===
  | { type: "SET_COMPACTION_PRE_TOKENS"; payload: number | null }
  | { type: "SET_COMPACTION_MESSAGE_ID"; payload: string | null }
  | { type: "SET_WARNING_DISMISSED"; payload: boolean }
  | {
      type: "START_COMPACTION";
      payload: { preTokens: number; messageId: string; generateId: () => string };
    }
  | {
      type: "COMPLETE_COMPACTION";
      payload: { preTokens: number; postTokens: number; baseContext: number };
    }

  // === Update Actions ===
  | { type: "SET_UPDATE_AVAILABLE"; payload: UpdateInfo | null }
  | { type: "SET_UPDATE_PROGRESS"; payload: number | null }
  | { type: "SET_UPDATE_STATUS"; payload: UpdateStatus }
  | { type: "SET_UPDATE_ERROR"; payload: string | null }
  | { type: "DISMISS_UPDATE"; payload: string };

/**
 * Action creator functions for type-safe dispatch.
 * These provide autocomplete and eliminate string typos.
 */
export const actions = {
  // === Message Actions ===
  addMessage: (msg: Message): Action => ({
    type: "ADD_MESSAGE",
    payload: msg,
  }),
  updateMessage: (id: string, updates: Partial<Message>): Action => ({
    type: "UPDATE_MESSAGE",
    payload: { id, updates },
  }),
  setMessages: (msgs: Message[]): Action => ({
    type: "SET_MESSAGES",
    payload: msgs,
  }),
  clearMessages: (): Action => ({ type: "CLEAR_MESSAGES" }),

  // === Streaming Actions ===
  appendContent: (text: string): Action => ({
    type: "APPEND_STREAMING_CONTENT",
    payload: text,
  }),
  setContent: (text: string): Action => ({
    type: "SET_STREAMING_CONTENT",
    payload: text,
  }),
  appendThinking: (text: string): Action => ({
    type: "APPEND_STREAMING_THINKING",
    payload: text,
  }),
  setThinking: (text: string): Action => ({
    type: "SET_STREAMING_THINKING",
    payload: text,
  }),
  setLoading: (loading: boolean): Action => ({
    type: "SET_STREAMING_LOADING",
    payload: loading,
  }),
  addBlock: (block: ContentBlock): Action => ({
    type: "ADD_STREAMING_BLOCK",
    payload: block,
  }),
  setBlocks: (blocks: ContentBlock[]): Action => ({
    type: "SET_STREAMING_BLOCKS",
    payload: blocks,
  }),
  finishStreaming: (opts?: {
    interrupted?: boolean;
    generateId: () => string;
  }): Action => ({
    type: "FINISH_STREAMING",
    payload: opts,
  }),
  resetStreaming: (): Action => ({ type: "RESET_STREAMING" }),
  setShowThinking: (show: boolean): Action => ({
    type: "SET_SHOW_THINKING",
    payload: show,
  }),
  toggleShowThinking: (): Action => ({ type: "TOGGLE_SHOW_THINKING" }),

  // === Tool Actions ===
  addTool: (tool: ToolUse): Action => ({
    type: "ADD_TOOL",
    payload: tool,
  }),
  updateTool: (id: string, updates: Partial<ToolUse>): Action => ({
    type: "UPDATE_TOOL",
    payload: { id, updates },
  }),
  updateToolSubagent: (id: string, subagent: Partial<SubagentInfo>): Action => ({
    type: "UPDATE_TOOL_SUBAGENT",
    payload: { id, subagent },
  }),
  updateLastToolInput: (input: unknown): Action => ({
    type: "UPDATE_LAST_TOOL_INPUT",
    payload: input,
  }),
  setTools: (tools: ToolUse[]): Action => ({
    type: "SET_TOOLS",
    payload: tools,
  }),
  clearTools: (): Action => ({ type: "CLEAR_TOOLS" }),

  // === Todo Actions ===
  setTodos: (todos: Todo[]): Action => ({
    type: "SET_TODOS",
    payload: todos,
  }),
  setTodoPanelVisible: (visible: boolean): Action => ({
    type: "SET_TODO_PANEL_VISIBLE",
    payload: visible,
  }),
  setTodoPanelHiding: (hiding: boolean): Action => ({
    type: "SET_TODO_PANEL_HIDING",
    payload: hiding,
  }),

  // === Question Actions ===
  setQuestions: (questions: Question[]): Action => ({
    type: "SET_QUESTIONS",
    payload: questions,
  }),
  setQuestionPanelVisible: (visible: boolean): Action => ({
    type: "SET_QUESTION_PANEL_VISIBLE",
    payload: visible,
  }),
  setPendingQuestionRequestId: (requestId: string | null): Action => ({
    type: "SET_PENDING_QUESTION_REQUEST_ID",
    payload: requestId,
  }),
  clearQuestionPanel: (): Action => ({ type: "CLEAR_QUESTION_PANEL" }),

  // === Planning Actions ===
  setPlanningActive: (active: boolean): Action => ({
    type: "SET_PLANNING_ACTIVE",
    payload: active,
  }),
  setPlanFilePath: (path: string | null): Action => ({
    type: "SET_PLAN_FILE_PATH",
    payload: path,
  }),
  setPlanContent: (content: string): Action => ({
    type: "SET_PLAN_CONTENT",
    payload: content,
  }),
  setPlanningToolId: (id: string | null): Action => ({
    type: "SET_PLANNING_TOOL_ID",
    payload: id,
  }),
  addPlanningNestedTool: (tool: { name: string; input?: string }): Action => ({
    type: "ADD_PLANNING_NESTED_TOOL",
    payload: tool,
  }),
  setPlanReady: (ready: boolean): Action => ({
    type: "SET_PLAN_READY",
    payload: ready,
  }),
  setPlanNeedsRefresh: (path: string): Action => ({
    type: "SET_PLAN_NEEDS_REFRESH",
    payload: path,
  }),
  clearPlanNeedsRefresh: (): Action => ({ type: "CLEAR_PLAN_NEEDS_REFRESH" }),
  setPlanPermissionRequestId: (requestId: string | null): Action => ({
    type: "SET_PLAN_PERMISSION_REQUEST_ID",
    payload: requestId,
  }),
  exitPlanning: (): Action => ({ type: "EXIT_PLANNING" }),

  // === Permission Actions ===
  enqueuePermission: (permission: PermissionRequest): Action => ({
    type: "ENQUEUE_PERMISSION",
    payload: permission,
  }),
  dequeuePermission: (requestId: string): Action => ({
    type: "DEQUEUE_PERMISSION",
    payload: requestId,
  }),
  setPermissionReviewing: (requestId: string, reviewing: boolean): Action => ({
    type: "SET_PERMISSION_REVIEWING",
    payload: { requestId, reviewing },
  }),
  setReviewResult: (requestId: string, result: ReviewResult | null): Action => ({
    type: "SET_REVIEW_RESULT",
    payload: { requestId, result },
  }),
  clearPermissionQueue: (): Action => ({ type: "CLEAR_PERMISSION_QUEUE" }),

  // === Session Actions ===
  setSessionActive: (active: boolean): Action => ({
    type: "SET_SESSION_ACTIVE",
    payload: active,
  }),
  updateSessionInfo: (info: Partial<SessionInfo>): Action => ({
    type: "UPDATE_SESSION_INFO",
    payload: info,
  }),
  setSessionInfo: (info: SessionInfo): Action => ({
    type: "SET_SESSION_INFO",
    payload: info,
  }),
  setSessionError: (error: string | null): Action => ({
    type: "SET_SESSION_ERROR",
    payload: error,
  }),
  setLaunchSessionId: (id: string | null): Action => ({
    type: "SET_LAUNCH_SESSION_ID",
    payload: id,
  }),

  // === Compaction Actions ===
  setCompactionPreTokens: (tokens: number | null): Action => ({
    type: "SET_COMPACTION_PRE_TOKENS",
    payload: tokens,
  }),
  setCompactionMessageId: (id: string | null): Action => ({
    type: "SET_COMPACTION_MESSAGE_ID",
    payload: id,
  }),
  setWarningDismissed: (dismissed: boolean): Action => ({
    type: "SET_WARNING_DISMISSED",
    payload: dismissed,
  }),
  startCompaction: (
    preTokens: number,
    messageId: string,
    generateId: () => string
  ): Action => ({
    type: "START_COMPACTION",
    payload: { preTokens, messageId, generateId },
  }),
  completeCompaction: (
    preTokens: number,
    postTokens: number,
    baseContext: number
  ): Action => ({
    type: "COMPLETE_COMPACTION",
    payload: { preTokens, postTokens, baseContext },
  }),

  // === Update Actions ===
  setUpdateAvailable: (info: UpdateInfo | null): Action => ({
    type: "SET_UPDATE_AVAILABLE",
    payload: info,
  }),
  setUpdateProgress: (progress: number | null): Action => ({
    type: "SET_UPDATE_PROGRESS",
    payload: progress,
  }),
  setUpdateStatus: (status: UpdateStatus): Action => ({
    type: "SET_UPDATE_STATUS",
    payload: status,
  }),
  setUpdateError: (error: string | null): Action => ({
    type: "SET_UPDATE_ERROR",
    payload: error,
  }),
  dismissUpdate: (version: string): Action => ({
    type: "DISMISS_UPDATE",
    payload: version,
  }),
} as const;
