/**
 * Event dispatchers for Claude streaming events.
 *
 * This module provides event handlers that dispatch actions to the store
 * instead of calling setters directly. This is the replacement for the
 * EventHandlerDeps-based handlers in event-handlers.ts.
 *
 * Key differences from EventHandlerDeps pattern:
 * - Handlers receive minimal EventContext instead of 40+ dependencies
 * - State changes are expressed as actions (declarative)
 * - Testing requires only mocking dispatch function
 * - Pure functions that are easier to reason about
 *
 * NOTE: Events are normalized to camelCase before reaching these handlers.
 * See claude-event-normalizer.ts for the normalization logic.
 */

import type {
  NormalizedEvent,
  NormalizedStatusEvent,
  NormalizedReadyEvent,
  NormalizedClosedEvent,
  NormalizedErrorEvent,
  NormalizedContextUpdateEvent,
  NormalizedResultEvent,
  NormalizedThinkingDeltaEvent,
  NormalizedTextDeltaEvent,
  NormalizedToolStartEvent,
  NormalizedToolInputEvent,
  NormalizedToolResultEvent,
  NormalizedPermissionRequestEvent,
  NormalizedSubagentStartEvent,
  NormalizedSubagentProgressEvent,
  NormalizedSubagentEndEvent,
} from "../claude-event-normalizer";
import type { Action } from "./actions";
import type { StreamingRefs } from "./types";
import type { ToolUse, SubagentInfo } from "../types";
import type { PermissionRequest, SessionInfo } from "../event-handlers";
import { parseToolInput } from "../json-streamer";

/**
 * Minimal context needed by event dispatchers.
 * Much smaller than EventHandlerDeps (40+ properties).
 */
export interface EventContext {
  /** Dispatch an action to update state */
  dispatch: (action: Action) => void;

  /** Mutable refs for JSON accumulation during streaming */
  refs: StreamingRefs;

  /** Generate a unique message ID */
  generateMessageId: () => string;

  // === External callbacks (cannot be replaced by dispatch) ===

  /** Send a permission response back to Claude */
  sendPermissionResponse: (
    requestId: string,
    allow: boolean,
    remember?: boolean,
    toolInput?: unknown
  ) => Promise<void>;

  /** Get the current permission mode */
  getCurrentMode: () => "auto" | "request" | "plan";

  // === State accessors (for conditional logic) ===
  // These read current state when handlers need to make decisions

  /** Get current session info */
  getSessionInfo: () => SessionInfo;

  /** Get launch session ID */
  getLaunchSessionId: () => string | null;

  /** Get plan file path */
  getPlanFilePath: () => string | null;

  /** Get pre-compaction token count */
  getCompactionPreTokens: () => number | null;

  /** Get compaction message ID */
  getCompactionMessageId: () => string | null;

  /** Get current tool uses (for race condition handling) */
  getCurrentToolUses: () => ToolUse[];
}

// =============================================================================
// Status & Session Handlers
// =============================================================================

/**
 * Handle status events (status messages, compaction)
 */
export function handleStatus(event: NormalizedStatusEvent, ctx: EventContext): void {
  if (!event.message) return;

  // Compaction starting
  if (event.message.includes("Compacting")) {
    const currentContext = ctx.getSessionInfo().totalContext || 0;
    const msgId = `compaction-${Date.now()}`;

    ctx.dispatch({
      type: "START_COMPACTION",
      payload: {
        preTokens: currentContext,
        messageId: msgId,
        generateId: ctx.generateMessageId,
      },
    });
    return;
  }

  // Compaction completed
  if (event.isCompaction) {
    const preTokens = ctx.getCompactionPreTokens() || event.preTokens || 0;
    const postTokens = event.postTokens || 0;
    const baseContext = ctx.getSessionInfo().baseContext || 0;

    ctx.dispatch({
      type: "COMPLETE_COMPACTION",
      payload: { preTokens, postTokens, baseContext },
    });
    return;
  }

  // Regular status message
  ctx.dispatch({
    type: "ADD_MESSAGE",
    payload: {
      id: `status-${Date.now()}`,
      role: "system",
      content: event.message,
      variant: "status",
    },
  });
}

/**
 * Handle ready event (session established)
 */
export function handleReady(event: NormalizedReadyEvent, ctx: EventContext): void {
  const sessionId = event.sessionId;

  ctx.dispatch({ type: "SET_SESSION_ACTIVE", payload: true });
  ctx.dispatch({
    type: "UPDATE_SESSION_INFO",
    payload: {
      sessionId,
      model: event.model,
    },
  });

  // Capture launch session ID on first ready event (for "Original Session" feature)
  // This only sets once - subsequent ready events (from resuming) don't overwrite
  if (sessionId && !ctx.getLaunchSessionId()) {
    ctx.dispatch({ type: "SET_LAUNCH_SESSION_ID", payload: sessionId });
  }
}

/**
 * Handle closed events (session terminated)
 */
export function handleClosed(event: NormalizedClosedEvent, ctx: EventContext): void {
  ctx.dispatch({ type: "SET_SESSION_ACTIVE", payload: false });
  ctx.dispatch({
    type: "SET_SESSION_ERROR",
    payload: `Session closed (code ${event.code})`,
  });
}

/**
 * Handle error events
 */
export function handleError(event: NormalizedErrorEvent, ctx: EventContext): void {
  ctx.dispatch({
    type: "SET_SESSION_ERROR",
    payload: event.message || "Unknown error",
  });
  ctx.dispatch({
    type: "FINISH_STREAMING",
    payload: { generateId: ctx.generateMessageId },
  });
}

/**
 * Handle context update events
 */
export function handleContextUpdate(
  event: NormalizedContextUpdateEvent,
  ctx: EventContext
): void {
  const contextTotal = event.inputTokens || 0;
  if (contextTotal > 0) {
    const cacheRead = event.cacheRead || 0;
    const cacheWrite = event.cacheWrite || 0;
    const cacheSize = Math.max(cacheRead, cacheWrite);
    const currentBaseContext = ctx.getSessionInfo().baseContext || 0;

    ctx.dispatch({
      type: "UPDATE_SESSION_INFO",
      payload: {
        totalContext: contextTotal,
        baseContext: Math.max(currentBaseContext, cacheSize),
      },
    });
  }
}

/**
 * Handle result events (response complete)
 */
export function handleResult(event: NormalizedResultEvent, ctx: EventContext): void {
  const newOutputTokens = event.outputTokens || 0;
  const currentInfo = ctx.getSessionInfo();

  ctx.dispatch({
    type: "UPDATE_SESSION_INFO",
    payload: {
      totalContext: (currentInfo.totalContext || 0) + newOutputTokens,
      outputTokens: (currentInfo.outputTokens || 0) + newOutputTokens,
    },
  });

  ctx.dispatch({
    type: "FINISH_STREAMING",
    payload: { generateId: ctx.generateMessageId },
  });
}

/**
 * Handle done events
 */
export function handleDone(ctx: EventContext): void {
  ctx.dispatch({
    type: "FINISH_STREAMING",
    payload: { generateId: ctx.generateMessageId },
  });
}

// =============================================================================
// Text & Thinking Handlers
// =============================================================================

/**
 * Handle thinking start events (extended thinking mode)
 */
export function handleThinkingStart(ctx: EventContext): void {
  ctx.dispatch({ type: "SET_STREAMING_THINKING", payload: "" });
}

/**
 * Handle thinking delta events
 */
export function handleThinkingDelta(
  event: NormalizedThinkingDeltaEvent,
  ctx: EventContext
): void {
  const thinking = event.thinking || "";
  ctx.dispatch({ type: "APPEND_STREAMING_THINKING", payload: thinking });
}

/**
 * Handle text delta events (streaming text)
 */
export function handleTextDelta(event: NormalizedTextDeltaEvent, ctx: EventContext): void {
  const text = event.text || "";

  // Append to streaming content (reducer handles block updates)
  ctx.dispatch({ type: "APPEND_STREAMING_CONTENT", payload: text });

  // Extract plan file path if present
  // Note: We need to check accumulated content, which requires reading state
  // This is handled by checking the entire delta for the pattern
  const planMatch = text.match(/plan file[^/]*?(\/[^\s]+\.md)/i);
  if (planMatch && !ctx.getPlanFilePath()) {
    ctx.dispatch({ type: "SET_PLAN_FILE_PATH", payload: planMatch[1] });
  }
}

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * Handle tool start events
 */
export function handleToolStart(event: NormalizedToolStartEvent, ctx: EventContext): void {
  ctx.refs.toolInputRef.current = "";

  if (event.name === "TodoWrite") {
    ctx.refs.isCollectingTodoRef.current = true;
    ctx.refs.todoJsonRef.current = "";
    ctx.dispatch({ type: "SET_TODO_PANEL_VISIBLE", payload: true });
    ctx.dispatch({ type: "SET_TODO_PANEL_HIDING", payload: false });
    return;
  }

  if (event.name === "AskUserQuestion") {
    ctx.refs.isCollectingQuestionRef.current = true;
    ctx.refs.questionJsonRef.current = "";
    return;
  }

  if (event.name === "EnterPlanMode") {
    ctx.dispatch({ type: "SET_PLANNING_ACTIVE", payload: true });
    return;
  }

  if (event.name === "ExitPlanMode") {
    ctx.dispatch({ type: "SET_PLAN_APPROVAL_VISIBLE", payload: true });
    return;
  }

  // Regular tool
  const toolId = event.id || "";

  // Check if we have a pending result for this tool (race condition recovery)
  const pendingResult = toolId
    ? ctx.refs.pendingResultsRef.current.get(toolId)
    : undefined;
  if (pendingResult) {
    ctx.refs.pendingResultsRef.current.delete(toolId);
    console.log(`[tool_start] Applying pending result for tool: ${toolId}`);
  }

  const newTool: ToolUse = {
    id: toolId,
    name: event.name || "unknown",
    input: {},
    isLoading: pendingResult ? false : true,
    result: pendingResult?.result,
  };

  ctx.dispatch({ type: "ADD_TOOL", payload: newTool });
}

/**
 * Handle tool input events (accumulate JSON chunks)
 */
export function handleToolInput(event: NormalizedToolInputEvent, ctx: EventContext): void {
  const json = event.json || "";

  if (ctx.refs.isCollectingTodoRef.current) {
    ctx.refs.todoJsonRef.current += json;
    try {
      const parsed = JSON.parse(ctx.refs.todoJsonRef.current);
      if (parsed.todos && Array.isArray(parsed.todos)) {
        ctx.dispatch({ type: "SET_TODOS", payload: parsed.todos });
      }
    } catch {
      // Incomplete JSON, wait for more chunks
    }
    return;
  }

  if (ctx.refs.isCollectingQuestionRef.current) {
    ctx.refs.questionJsonRef.current += json;
    try {
      const parsed = JSON.parse(ctx.refs.questionJsonRef.current);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        ctx.dispatch({ type: "SET_QUESTIONS", payload: parsed.questions });
        ctx.dispatch({ type: "SET_QUESTION_PANEL_VISIBLE", payload: true });
      }
    } catch {
      // Incomplete JSON, wait for more chunks
    }
    return;
  }

  // Regular tool input
  ctx.refs.toolInputRef.current += json;

  // Incrementally update tool input so UI shows command/description while streaming
  const parsedInput = parseToolInput(ctx.refs.toolInputRef.current);
  ctx.dispatch({ type: "UPDATE_LAST_TOOL_INPUT", payload: parsedInput });
}

/**
 * Handle tool pending events (tool about to execute)
 */
export function handleToolPending(ctx: EventContext): void {
  if (ctx.refs.isCollectingTodoRef.current) {
    try {
      const parsed = JSON.parse(ctx.refs.todoJsonRef.current);
      if (parsed.todos && Array.isArray(parsed.todos)) {
        ctx.dispatch({ type: "SET_TODOS", payload: parsed.todos });
      }
    } catch {
      // Parsing failed
    }
    return;
  }

  if (ctx.refs.isCollectingQuestionRef.current) {
    try {
      const parsed = JSON.parse(ctx.refs.questionJsonRef.current);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        ctx.dispatch({ type: "SET_QUESTIONS", payload: parsed.questions });
        ctx.dispatch({ type: "SET_QUESTION_PANEL_VISIBLE", payload: true });
      }
    } catch {
      // Parsing failed
    }
    return;
  }

  // Finalize tool input
  const currentTools = ctx.getCurrentToolUses();
  if (currentTools.length > 0) {
    const parsedInput = parseToolInput(ctx.refs.toolInputRef.current);
    ctx.dispatch({ type: "UPDATE_LAST_TOOL_INPUT", payload: parsedInput });
  }
}

/**
 * Handle tool result events
 */
export function handleToolResult(event: NormalizedToolResultEvent, ctx: EventContext): void {
  if (ctx.refs.isCollectingTodoRef.current) {
    ctx.refs.isCollectingTodoRef.current = false;
    return;
  }

  if (ctx.refs.isCollectingQuestionRef.current) {
    ctx.refs.isCollectingQuestionRef.current = false;
    return;
  }

  // The CLI sends duplicate tool_result events: first with toolUseId, then
  // without it but with the same content. We ONLY process results that have
  // a toolUseId to avoid corrupting other tools' results.
  const targetToolId = event.toolUseId;
  if (!targetToolId) {
    return;
  }

  const isError = event.isError || false;
  const result = isError
    ? `Error: ${event.stderr || event.stdout}`
    : event.stdout || event.stderr || "";

  // Check if tool exists yet - if not, store result for later (race condition handling)
  const currentTools = ctx.getCurrentToolUses();
  const toolExists = currentTools.some((t) => t.id === targetToolId);

  if (!toolExists) {
    ctx.refs.pendingResultsRef.current.set(targetToolId, {
      result,
      isError,
    });
    return;
  }

  // Check for plan file read
  const tool = currentTools.find((t) => t.id === targetToolId);
  if (tool?.name === "Read" && ctx.getPlanFilePath()) {
    const inputPath = (tool.input as Record<string, unknown>)?.file_path;
    if (inputPath === ctx.getPlanFilePath()) {
      ctx.dispatch({ type: "SET_PLAN_CONTENT", payload: event.stdout || "" });
    }
  }

  ctx.dispatch({
    type: "UPDATE_TOOL",
    payload: {
      id: targetToolId,
      updates: { result, isLoading: false },
    },
  });
}

// =============================================================================
// Permission Handler
// =============================================================================

/**
 * Handle permission request events
 */
export function handlePermissionRequest(
  event: NormalizedPermissionRequestEvent,
  ctx: EventContext
): void {
  const { requestId, toolName, toolInput, description } = event;

  // In auto mode, immediately approve without showing dialog
  if (ctx.getCurrentMode() === "auto") {
    console.log("[PERMISSION] Auto-accepting:", toolName);
    ctx.sendPermissionResponse(requestId, true, false, toolInput);
    return;
  }

  // Otherwise show the permission dialog
  const permission: PermissionRequest = {
    requestId,
    toolName,
    toolInput,
    description,
  };

  ctx.dispatch({ type: "SET_PENDING_PERMISSION", payload: permission });
}

// =============================================================================
// Subagent Handlers
// =============================================================================

/**
 * Handle subagent start events (Task tool started)
 * Events are normalized to camelCase before reaching this handler
 */
export function handleSubagentStart(
  event: NormalizedSubagentStartEvent,
  ctx: EventContext
): void {
  const taskId = event.id || "";

  const subagentInfo: SubagentInfo = {
    agentType: event.agentType || "unknown",
    description: event.description || "",
    status: "running",
    startTime: Date.now(),
    nestedTools: [],
  };

  ctx.dispatch({
    type: "UPDATE_TOOL_SUBAGENT",
    payload: { id: taskId, subagent: subagentInfo },
  });
}

/**
 * Handle subagent progress events (nested tool executing)
 * Events are normalized to camelCase before reaching this handler
 */
export function handleSubagentProgress(
  event: NormalizedSubagentProgressEvent,
  ctx: EventContext
): void {
  const taskId = event.subagentId || "";
  const newTool = {
    name: event.toolName || "unknown",
    input: event.toolDetail || undefined,
  };

  // Get current tools to find and update the subagent
  const currentTools = ctx.getCurrentToolUses();
  const task = currentTools.find((t) => t.id === taskId);

  if (task?.subagent) {
    const updatedNestedTools = [...task.subagent.nestedTools, newTool];
    ctx.dispatch({
      type: "UPDATE_TOOL_SUBAGENT",
      payload: {
        id: taskId,
        subagent: { nestedTools: updatedNestedTools },
      },
    });
  }
}

/**
 * Handle subagent end events (Task tool completed)
 * Events are normalized to camelCase before reaching this handler
 */
export function handleSubagentEnd(event: NormalizedSubagentEndEvent, ctx: EventContext): void {
  const taskId = event.id || "";
  const duration = event.duration || 0;
  const toolCount = event.toolCount || 0;

  ctx.dispatch({
    type: "UPDATE_TOOL_SUBAGENT",
    payload: {
      id: taskId,
      subagent: {
        status: "complete",
        duration,
        toolCount,
      },
    },
  });
}

// =============================================================================
// Event Dispatcher Factory
// =============================================================================

/**
 * Create the main event dispatcher function.
 *
 * This is the replacement for createEventHandler() from event-handlers.ts.
 * Instead of receiving EventHandlerDeps, it receives the minimal EventContext.
 */
export function createEventDispatcher(ctx: EventContext) {
  return (event: NormalizedEvent): void => {
    switch (event.type) {
      case "status":
        handleStatus(event, ctx);
        break;
      case "ready":
        handleReady(event, ctx);
        break;
      case "processing":
        // User message being processed - no action needed
        break;
      case "thinking_start":
        handleThinkingStart(ctx);
        break;
      case "thinking_delta":
        handleThinkingDelta(event, ctx);
        break;
      case "text_delta":
        handleTextDelta(event, ctx);
        break;
      case "tool_start":
        handleToolStart(event, ctx);
        break;
      case "tool_input":
        handleToolInput(event, ctx);
        break;
      case "permission_request":
        handlePermissionRequest(event, ctx);
        break;
      case "tool_pending":
        handleToolPending(ctx);
        break;
      case "tool_result":
        handleToolResult(event, ctx);
        break;
      case "block_end":
        // Content block ended - no action needed
        break;
      case "context_update":
        handleContextUpdate(event, ctx);
        break;
      case "result":
        handleResult(event, ctx);
        break;
      case "done":
        handleDone(ctx);
        break;
      case "closed":
        handleClosed(event, ctx);
        break;
      case "error":
        handleError(event, ctx);
        break;
      case "subagent_start":
        handleSubagentStart(event, ctx);
        break;
      case "subagent_progress":
        handleSubagentProgress(event, ctx);
        break;
      case "subagent_end":
        handleSubagentEnd(event, ctx);
        break;
    }
  };
}
