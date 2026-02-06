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

import { batch } from "solid-js";
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
  NormalizedAskUserQuestionEvent,
  NormalizedSubagentStartEvent,
  NormalizedSubagentProgressEvent,
  NormalizedSubagentEndEvent,
} from "../claude-event-normalizer";
import type { Action } from "./actions";
import type { StreamingRefs } from "./types";
import type { ToolUse, SubagentInfo, Question } from "../types";
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
  getCurrentMode: () => "auto" | "request" | "plan" | "bot";

  // === State accessors (for conditional logic) ===
  // These read current state when handlers need to make decisions

  /** Get current session info */
  getSessionInfo: () => SessionInfo;

  /** Get launch session ID */
  getLaunchSessionId: () => string | null;

  /** Get plan file path */
  getPlanFilePath: () => string | null;

  /** Get planning tool ID */
  getPlanningToolId: () => string | null;

  /** Check if planning mode is active */
  isPlanning: () => boolean;

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

  // AskUserQuestion is now handled via control protocol (ask_user_question event)
  // We still need to suppress it from showing as a regular tool
  if (event.name === "AskUserQuestion") {
    return;
  }

  if (event.name === "EnterPlanMode") {
    ctx.dispatch({ type: "SET_PLANNING_ACTIVE", payload: true });
    // Add Planning tool block to show activity
    const toolId = `planning-${Date.now()}`;
    ctx.dispatch({ type: "SET_PLANNING_TOOL_ID", payload: toolId });
    const newTool: ToolUse = {
      id: toolId,
      name: "Planning",
      input: {},
      isLoading: true,
    };
    ctx.dispatch({ type: "ADD_TOOL", payload: newTool });
    return;
  }

  if (event.name === "ExitPlanMode") {
    // ExitPlanMode is handled via permission_request event where we get the requestId
    // Just return early to avoid adding it as a tool block
    console.log("[PLANNING] ExitPlanMode tool_start - waiting for permission_request");
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

  // Track nested tools during planning for activity display
  if (ctx.isPlanning() && event.name !== "Planning") {
    ctx.dispatch({
      type: "ADD_PLANNING_NESTED_TOOL",
      payload: { name: event.name || "unknown" },
    });
  }
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

  // AskUserQuestion is now handled via control protocol - no need to collect JSON here

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

  // AskUserQuestion is now handled via control protocol

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

  // AskUserQuestion is now handled via control protocol

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

  // Capture plan file content from Read or Write tools during planning
  const tool = currentTools.find((t) => t.id === targetToolId);
  const planFilePath = ctx.getPlanFilePath();
  const isInPlanningMode = ctx.isPlanning();

  if (tool) {
    const inputPath = (tool.input as Record<string, unknown>)?.file_path as string | undefined;

    // Plan file read - capture from result (if path matches or looks like a plan file)
    if (tool.name === "Read") {
      const isMatchingPath = planFilePath && inputPath === planFilePath;
      const looksLikePlanFile = isInPlanningMode && inputPath &&
        (inputPath.includes("plan") || inputPath.includes(".claude/plans")) &&
        inputPath.endsWith(".md");

      if (isMatchingPath || looksLikePlanFile) {
        console.log("[PLANNING] Captured plan content from Read:", inputPath);
        // Strip line numbers from Read tool output (format: "  123→content" or "123→content")
        const rawContent = event.stdout || "";
        const strippedContent = rawContent
          .split("\n")
          .map(line => line.replace(/^\s*\d+→/, ""))
          .join("\n");
        ctx.dispatch({ type: "SET_PLAN_CONTENT", payload: strippedContent });
        if (!planFilePath && inputPath) {
          console.log("[PLANNING] Setting plan file path from Read:", inputPath);
          ctx.dispatch({ type: "SET_PLAN_FILE_PATH", payload: inputPath });
        }
      }
    }

    // Plan file write - capture from input content (if in planning mode and writing .md)
    // In planning mode, capture ANY markdown file as the plan
    if (tool.name === "Write" && isInPlanningMode && inputPath?.endsWith(".md")) {
      const content = (tool.input as Record<string, unknown>)?.content;
      if (typeof content === "string") {
        console.log("[PLANNING] Captured plan content from Write:", inputPath);
        ctx.dispatch({ type: "SET_PLAN_CONTENT", payload: content });
        if (!planFilePath) {
          console.log("[PLANNING] Setting plan file path from Write:", inputPath);
          ctx.dispatch({ type: "SET_PLAN_FILE_PATH", payload: inputPath });
        }
      }
    }

    // Plan file edit - signal that the plan file was modified
    // The Edit tool doesn't give us the full content, so we dispatch an action
    // to indicate the file needs to be re-read
    // Note: We check for plan file edits even outside planning mode to handle
    // resumed sessions where Claude continues editing without calling EnterPlanMode
    if (tool.name === "Edit" && inputPath?.endsWith(".md")) {
      const isMatchingPath = planFilePath && inputPath === planFilePath;
      const looksLikePlanFile = inputPath &&
        (inputPath.includes("plan") || inputPath.includes(".claude/plans"));

      if (isMatchingPath || looksLikePlanFile) {
        console.log("[PLANNING] Plan file edited:", inputPath);
        // Activate planning mode if not already active (e.g., resumed session)
        if (!isInPlanningMode) {
          console.log("[PLANNING] Activating planning mode from Edit");
          ctx.dispatch({ type: "SET_PLANNING_ACTIVE", payload: true });
          // Add Planning tool block to show activity
          const toolId = `planning-${Date.now()}`;
          ctx.dispatch({ type: "SET_PLANNING_TOOL_ID", payload: toolId });
          ctx.dispatch({
            type: "ADD_TOOL",
            payload: { id: toolId, name: "Planning", input: {}, isLoading: true },
          });
        }
        // Set the plan file path if not already set (e.g., editing existing plan file)
        if (!planFilePath) {
          console.log("[PLANNING] Setting plan file path from Edit:", inputPath);
          ctx.dispatch({ type: "SET_PLAN_FILE_PATH", payload: inputPath });
        }
        // Dispatch action to signal plan needs refresh
        ctx.dispatch({ type: "SET_PLAN_NEEDS_REFRESH", payload: inputPath });
      }
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

  // ExitPlanMode requires special handling - route to plan approval flow
  if (toolName === "ExitPlanMode") {
    console.log("[PERMISSION] ExitPlanMode - routing to plan approval, requestId:", requestId);
    ctx.dispatch({ type: "SET_PLAN_PERMISSION_REQUEST_ID", payload: requestId });
    ctx.dispatch({ type: "SET_PLAN_READY", payload: true });
    // Update the Planning tool to show complete state
    const planToolId = ctx.getPlanningToolId();
    if (planToolId) {
      ctx.dispatch({
        type: "UPDATE_TOOL",
        payload: { id: planToolId, updates: { isLoading: false } },
      });
    }
    return;
  }

  const mode = ctx.getCurrentMode();

  // In auto mode, immediately approve without showing dialog
  if (mode === "auto") {
    console.log("[PERMISSION] Auto-accepting:", toolName, "requestId:", requestId);
    ctx.sendPermissionResponse(requestId, true, false, toolInput)
      .then(() => {
        console.log("[PERMISSION] Auto-accept sent successfully:", toolName);
      })
      .catch((err) => {
        console.error("[PERMISSION] Auto-accept FAILED:", toolName, err);
        // Show permission dialog as fallback so user can manually approve
        const permission: PermissionRequest = {
          requestId,
          toolName,
          toolInput,
          description,
          source: "control",
        };
        ctx.dispatch({ type: "ENQUEUE_PERMISSION", payload: permission });
      });
    return;
  }

  // In bot mode, trigger LLM review before deciding
  if (mode === "bot") {
    console.log("[PERMISSION] Bot mode - triggering LLM review:", toolName, "requestId:", requestId);
    const permission: PermissionRequest = {
      requestId,
      toolName,
      toolInput,
      description,
      source: "control",
    };
    // Enqueue first so the item exists, then set reviewing on it
    ctx.dispatch({ type: "ENQUEUE_PERMISSION", payload: permission });
    ctx.dispatch({ type: "SET_PERMISSION_REVIEWING", payload: { requestId, reviewing: true } });
    return;
  }

  // Otherwise show the permission dialog (request/plan modes)
  const permission: PermissionRequest = {
    requestId,
    toolName,
    toolInput,
    description,
    source: "control",
  };

  ctx.dispatch({ type: "ENQUEUE_PERMISSION", payload: permission });
}

/**
 * Handle AskUserQuestion events (Claude asking clarifying questions via control protocol)
 */
export function handleAskUserQuestion(
  event: NormalizedAskUserQuestionEvent,
  ctx: EventContext
): void {
  const { requestId, questions } = event;

  console.log("[ASK_USER_QUESTION] Received via control protocol:", requestId);

  // Store the request ID so we can respond later
  ctx.dispatch({ type: "SET_PENDING_QUESTION_REQUEST_ID", payload: requestId });

  // Set questions and show the panel
  // Cast to Question[] since the control protocol provides the same structure
  ctx.dispatch({ type: "SET_QUESTIONS", payload: questions as Question[] });
  ctx.dispatch({ type: "SET_QUESTION_PANEL_VISIBLE", payload: true });
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
    // Batch all dispatches within a single event handler to minimize re-renders
    batch(() => {
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
        case "ask_user_question":
          handleAskUserQuestion(event, ctx);
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
    });
  };
}
