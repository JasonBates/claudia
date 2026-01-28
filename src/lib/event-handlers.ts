/**
 * Event handlers for Claude streaming events.
 *
 * This module extracts the event handling logic from App.tsx into
 * testable, composable functions. The handlers are created via a
 * factory that receives the necessary state setters.
 *
 * Pattern: Dependency injection via factory function allows us to:
 * 1. Test handlers with mock setters
 * 2. Reuse handlers across different components
 * 3. Keep App.tsx focused on UI composition
 */

import type { Setter } from "solid-js";
import type { ClaudeEvent } from "./tauri";
import type { Todo, Question, Message, ToolUse, ContentBlock } from "./types";
import { parseToolInput } from "./json-streamer";

/**
 * Session info tracked across the conversation
 */
export interface SessionInfo {
  sessionId?: string;
  model?: string;
  totalContext?: number;
  outputTokens?: number;
  baseContext?: number;
}

/**
 * Permission request from Claude
 */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  description: string;
}

/**
 * All state setters needed by event handlers.
 * Using Setter<T> type from SolidJS for proper typing.
 */
export interface EventHandlerDeps {
  // Message state
  setMessages: Setter<Message[]>;
  setStreamingContent: Setter<string>;
  setStreamingBlocks: Setter<ContentBlock[]>;
  setStreamingThinking: Setter<string>;

  // Tool state
  setCurrentToolUses: Setter<ToolUse[]>;

  // Todo state
  setCurrentTodos: Setter<Todo[]>;
  setShowTodoPanel: Setter<boolean>;
  setTodoPanelHiding: Setter<boolean>;

  // Question state
  setPendingQuestions: Setter<Question[]>;
  setShowQuestionPanel: Setter<boolean>;

  // Planning state
  setIsPlanning: Setter<boolean>;
  setPlanFilePath: Setter<string | null>;
  setShowPlanApproval: Setter<boolean>;
  setPlanContent: Setter<string>;

  // Permission state
  setPendingPermission: Setter<PermissionRequest | null>;
  getCurrentMode: () => "auto" | "request" | "plan";
  sendPermissionResponse: (requestId: string, allow: boolean, remember?: boolean, toolInput?: unknown) => Promise<void>;

  // Session state
  setSessionActive: Setter<boolean>;
  setSessionInfo: Setter<SessionInfo>;
  setError: Setter<string | null>;
  setIsLoading: Setter<boolean>;

  // Launch session tracking (for "Original Session" feature)
  getLaunchSessionId: () => string | null;
  setLaunchSessionId: Setter<string | null>;

  // Compaction tracking
  setLastCompactionPreTokens: Setter<number | null>;
  setCompactionMessageId: Setter<string | null>;
  setWarningDismissed: Setter<boolean>;

  // Accessors for current state (needed for some handlers)
  getSessionInfo: () => SessionInfo;
  getCurrentToolUses: () => ToolUse[];
  getStreamingBlocks: () => ContentBlock[];
  getPlanFilePath: () => string | null;
  getLastCompactionPreTokens: () => number | null;
  getCompactionMessageId: () => string | null;

  // Mutable refs (for JSON accumulation)
  toolInputRef: { current: string };
  todoJsonRef: { current: string };
  questionJsonRef: { current: string };
  isCollectingTodoRef: { current: boolean };
  isCollectingQuestionRef: { current: boolean };

  // Pending tool results (for race condition handling)
  // When a tool_result arrives before the tool exists, we store it here
  pendingResultsRef: { current: Map<string, { result: string; isError: boolean }> };

  // Callbacks
  generateMessageId: () => string;
  finishStreaming: () => void;
}

/**
 * Handle status events (status messages, compaction)
 */
export function handleStatusEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  if (!event.message) return;

  // Compaction starting
  if (event.message.includes("Compacting")) {
    const currentContext = deps.getSessionInfo().totalContext || 0;
    deps.setLastCompactionPreTokens(currentContext);

    const msgId = `compaction-${Date.now()}`;
    deps.setCompactionMessageId(msgId);
    const preK = Math.round(currentContext / 1000);

    const compactionMsg: Message = {
      id: msgId,
      role: "system",
      content: `${preK}k → ...`,
      variant: "compaction",
    };
    deps.setMessages((prev) => [...prev, compactionMsg]);
    return;
  }

  // Compaction completed (support both snake_case and camelCase from JS bridge)
  if (event.is_compaction || event.isCompaction) {
    const preTokens = deps.getLastCompactionPreTokens() || event.pre_tokens || event.preTokens || 0;
    const summaryTokens = event.post_tokens || event.postTokens || 0;
    const baseContext = deps.getSessionInfo().baseContext || 0;
    const estimatedContext = baseContext + summaryTokens;

    if (estimatedContext > 0) {
      deps.setSessionInfo((prev) => ({
        ...prev,
        totalContext: estimatedContext,
      }));
    }

    const preK = Math.round(preTokens / 1000);
    const postK = estimatedContext > 0 ? Math.round(estimatedContext / 1000) : "?";
    const content = `${preK}k → ${postK}k`;

    const existingMsgId = deps.getCompactionMessageId();
    if (existingMsgId) {
      deps.setMessages((prev) =>
        prev.map((msg) => (msg.id === existingMsgId ? { ...msg, content } : msg))
      );
    } else {
      const compactionMsg: Message = {
        id: `compaction-${Date.now()}`,
        role: "system",
        content,
        variant: "compaction",
      };
      deps.setMessages((prev) => [...prev, compactionMsg]);
    }

    deps.setLastCompactionPreTokens(null);
    deps.setCompactionMessageId(null);
    deps.setWarningDismissed(false);
    return;
  }

  // Regular status message
  const statusMsg: Message = {
    id: `status-${Date.now()}`,
    role: "system",
    content: event.message,
    variant: "status",
  };
  deps.setMessages((prev) => [...prev, statusMsg]);
}

/**
 * Handle ready event (session established)
 */
export function handleReadyEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  // Support both snake_case (Rust/Tauri) and camelCase (JS SDK bridge)
  const sessionId = event.session_id || event.sessionId;

  deps.setSessionActive(true);
  deps.setSessionInfo((prev) => ({
    ...prev,
    sessionId,
    model: event.model,
    totalContext: prev.totalContext || 0,
  }));

  // Capture launch session ID on first ready event (for "Original Session" feature)
  // This only sets once - subsequent ready events (from resuming) don't overwrite
  if (sessionId && !deps.getLaunchSessionId()) {
    deps.setLaunchSessionId(sessionId);
  }
}

/**
 * Handle thinking events (extended thinking mode)
 */
export function handleThinkingStartEvent(deps: EventHandlerDeps): void {
  deps.setStreamingThinking("");
}

export function handleThinkingDeltaEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  const thinking = event.thinking || "";
  deps.setStreamingThinking((prev) => prev + thinking);

  deps.setStreamingBlocks((prev) => {
    const blocks = [...prev];
    if (blocks.length > 0 && blocks[blocks.length - 1].type === "thinking") {
      const lastBlock = blocks[blocks.length - 1] as { type: "thinking"; content: string };
      blocks[blocks.length - 1] = {
        type: "thinking",
        content: lastBlock.content + thinking,
      };
    } else {
      blocks.push({ type: "thinking", content: thinking });
    }
    return blocks;
  });
}

/**
 * Handle text delta events (streaming text)
 */
export function handleTextDeltaEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  const text = event.text || "";

  // NOTE: Tool loading state is NOT cleared here on text arrival.
  // Tools remain in loading state until their tool_result event arrives.
  // This prevents premature "done" indicators when Claude outputs text
  // between or during parallel tool executions.

  // Update streaming content
  deps.setStreamingContent((prev) => {
    const newContent = prev + text;
    // Extract plan file path if present
    const planMatch = newContent.match(/plan file[^/]*?(\/[^\s]+\.md)/i);
    if (planMatch && !deps.getPlanFilePath()) {
      deps.setPlanFilePath(planMatch[1]);
    }
    return newContent;
  });

  // Update streaming blocks
  deps.setStreamingBlocks((prev) => {
    const blocks = [...prev];
    if (blocks.length > 0 && blocks[blocks.length - 1].type === "text") {
      const lastBlock = blocks[blocks.length - 1] as { type: "text"; content: string };
      blocks[blocks.length - 1] = { type: "text", content: lastBlock.content + text };
    } else {
      blocks.push({ type: "text", content: text });
    }
    return blocks;
  });
}

/**
 * Handle tool start events
 */
export function handleToolStartEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  deps.toolInputRef.current = "";

  if (event.name === "TodoWrite") {
    deps.isCollectingTodoRef.current = true;
    deps.todoJsonRef.current = "";
    deps.setShowTodoPanel(true);
    deps.setTodoPanelHiding(false);
  } else if (event.name === "AskUserQuestion") {
    deps.isCollectingQuestionRef.current = true;
    deps.questionJsonRef.current = "";
  } else if (event.name === "EnterPlanMode") {
    deps.setIsPlanning(true);
  } else if (event.name === "ExitPlanMode") {
    deps.setShowPlanApproval(true);
  } else {
    const toolId = event.id || "";

    // Check if we have a pending result for this tool (race condition recovery)
    const pendingResult = toolId ? deps.pendingResultsRef.current.get(toolId) : undefined;
    if (pendingResult) {
      deps.pendingResultsRef.current.delete(toolId);
      console.log(`[tool_start] Applying pending result for tool: ${toolId}`);
    }

    const newTool: ToolUse = {
      id: toolId,
      name: event.name || "unknown",
      input: {},
      isLoading: pendingResult ? false : true,
      result: pendingResult?.result,
    };
    deps.setCurrentToolUses((prev) => [...prev, newTool]);
    deps.setStreamingBlocks((prev) => [...prev, { type: "tool_use", tool: newTool }]);
  }
}

/**
 * Handle tool input events (accumulate JSON chunks)
 */
export function handleToolInputEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  const json = event.json || "";

  if (deps.isCollectingTodoRef.current) {
    deps.todoJsonRef.current += json;
    try {
      const parsed = JSON.parse(deps.todoJsonRef.current);
      if (parsed.todos && Array.isArray(parsed.todos)) {
        deps.setCurrentTodos(parsed.todos);
      }
    } catch {
      // Incomplete JSON, wait for more chunks
    }
  } else if (deps.isCollectingQuestionRef.current) {
    deps.questionJsonRef.current += json;
    try {
      const parsed = JSON.parse(deps.questionJsonRef.current);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        deps.setPendingQuestions(parsed.questions);
        deps.setShowQuestionPanel(true);
      }
    } catch {
      // Incomplete JSON, wait for more chunks
    }
  } else {
    deps.toolInputRef.current += json;
  }
}

/**
 * Handle tool pending events (tool about to execute)
 */
export function handleToolPendingEvent(deps: EventHandlerDeps): void {
  if (deps.isCollectingTodoRef.current) {
    try {
      const parsed = JSON.parse(deps.todoJsonRef.current);
      if (parsed.todos && Array.isArray(parsed.todos)) {
        deps.setCurrentTodos(parsed.todos);
      }
    } catch {
      // Parsing failed
    }
  } else if (deps.isCollectingQuestionRef.current) {
    try {
      const parsed = JSON.parse(deps.questionJsonRef.current);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        deps.setPendingQuestions(parsed.questions);
        deps.setShowQuestionPanel(true);
      }
    } catch {
      // Parsing failed
    }
  } else if (deps.getCurrentToolUses().length > 0) {
    const parsedInput = parseToolInput(deps.toolInputRef.current);

    deps.setCurrentToolUses((prev) => {
      const updated = [...prev];
      const lastTool = updated[updated.length - 1];
      lastTool.input = parsedInput;
      return updated;
    });

    deps.setStreamingBlocks((prev) => {
      const blocks = [...prev];
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === "tool_use") {
          const toolBlock = blocks[i] as { type: "tool_use"; tool: ToolUse };
          blocks[i] = {
            type: "tool_use",
            tool: { ...toolBlock.tool, input: parsedInput },
          };
          break;
        }
      }
      return blocks;
    });
  }
}

/**
 * Handle permission request events
 */
export function handlePermissionRequestEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  // Support both snake_case (Rust/Tauri) and camelCase (JS SDK bridge) field names
  const requestId = event.request_id || event.requestId || "";
  const toolName = event.tool_name || event.toolName || "unknown";

  // Support both snake_case and camelCase for toolInput
  const toolInput = event.tool_input ?? event.toolInput;

  // In auto mode, immediately approve without showing dialog
  if (deps.getCurrentMode() === "auto") {
    console.log("[PERMISSION] Auto-accepting:", toolName);
    deps.sendPermissionResponse(requestId, true, false, toolInput);
    return;
  }

  // Otherwise show the permission dialog
  deps.setPendingPermission({
    requestId,
    toolName,
    toolInput,
    description: event.description || "",
  });
}

/**
 * Handle tool result events
 */
export function handleToolResultEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  if (deps.isCollectingTodoRef.current) {
    deps.isCollectingTodoRef.current = false;
    return;
  }

  if (deps.isCollectingQuestionRef.current) {
    deps.isCollectingQuestionRef.current = false;
    return;
  }

  // The CLI sends duplicate tool_result events: first with tool_use_id, then
  // without it but with the same content. We ONLY process results that have
  // a tool_use_id to avoid corrupting other tools' results.
  const targetToolId = event.tool_use_id;
  if (!targetToolId) {
    // No tool_use_id = duplicate event, skip it
    return;
  }

  // Support both snake_case (Rust/Tauri) and camelCase (JS SDK bridge)
  const isError = event.is_error || event.isError || false;
  const resultData = {
    result: isError
      ? `Error: ${event.stderr || event.stdout}`
      : event.stdout || event.stderr || "",
    isLoading: false,
    isError,
  };

  // Check if tool exists yet - if not, store result for later (race condition handling)
  const currentTools = deps.getCurrentToolUses();
  const toolExists = currentTools.some((t) => t.id === targetToolId);

  if (!toolExists) {
    deps.pendingResultsRef.current.set(targetToolId, {
      result: resultData.result,
      isError: resultData.isError,
    });
    return;
  }

  deps.setCurrentToolUses((prev) => {
    if (prev.length === 0) return prev;
    const updated = [...prev];

    const toolIndex = updated.findIndex((t) => t.id === targetToolId);
    if (toolIndex === -1) {
      // Should not happen after pre-check, but be safe
      return prev;
    }

    const tool = updated[toolIndex];

    // Check for plan file read
    if (tool.name === "Read" && deps.getPlanFilePath()) {
      const inputPath = (tool.input as Record<string, unknown>)?.file_path;
      if (inputPath === deps.getPlanFilePath()) {
        deps.setPlanContent(event.stdout || "");
      }
    }

    updated[toolIndex] = {
      ...tool,
      result: resultData.result,
      isLoading: resultData.isLoading,
    };
    return updated;
  });

  deps.setStreamingBlocks((prev) => {
    const blocks = [...prev];

    // Find the tool block by ID
    let foundIndex = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === "tool_use") {
        const toolBlock = blocks[i] as { type: "tool_use"; tool: ToolUse };
        if (toolBlock.tool.id === targetToolId) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex === -1) {
      return prev;
    }

    const toolBlock = blocks[foundIndex] as { type: "tool_use"; tool: ToolUse };
    blocks[foundIndex] = {
      type: "tool_use",
      tool: {
        ...toolBlock.tool,
        result: resultData.result,
        isLoading: resultData.isLoading,
      },
    };
    return blocks;
  });
}

/**
 * Handle context update events
 */
export function handleContextUpdateEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  // Support both snake_case (Rust/Tauri) and camelCase (JS SDK bridge)
  const contextTotal = event.input_tokens || event.inputTokens || 0;
  if (contextTotal > 0) {
    const cacheRead = event.cache_read || event.cacheRead || 0;
    const cacheWrite = event.cache_write || event.cacheWrite || 0;
    const cacheSize = Math.max(cacheRead, cacheWrite);
    deps.setSessionInfo((prev) => ({
      ...prev,
      totalContext: contextTotal,
      baseContext: Math.max(prev.baseContext || 0, cacheSize),
    }));
  }
}

/**
 * Handle result events (response complete)
 */
export function handleResultEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  // Support both snake_case (Rust/Tauri) and camelCase (JS SDK bridge)
  const newOutputTokens = event.output_tokens || event.outputTokens || 0;
  deps.setSessionInfo((prev) => ({
    ...prev,
    totalContext: (prev.totalContext || 0) + newOutputTokens,
    outputTokens: (prev.outputTokens || 0) + newOutputTokens,
  }));
  deps.finishStreaming();
}

/**
 * Handle done events
 */
export function handleDoneEvent(deps: EventHandlerDeps): void {
  deps.finishStreaming();
}

/**
 * Handle closed events (session terminated)
 */
export function handleClosedEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  deps.setSessionActive(false);
  deps.setError(`Session closed (code ${event.code})`);
}

/**
 * Handle error events
 */
export function handleErrorEvent(
  event: ClaudeEvent,
  deps: EventHandlerDeps
): void {
  deps.setError(event.message || "Unknown error");
  deps.finishStreaming();
}

/**
 * Create the main event handler function.
 *
 * This factory creates a handler that dispatches events to the
 * appropriate handler functions, making it easy to test individual
 * handlers in isolation.
 */
export function createEventHandler(deps: EventHandlerDeps) {
  return (event: ClaudeEvent): void => {
    switch (event.type) {
      case "status":
        handleStatusEvent(event, deps);
        break;
      case "ready":
        handleReadyEvent(event, deps);
        break;
      case "processing":
        // User message being processed - no action needed
        break;
      case "thinking_start":
        handleThinkingStartEvent(deps);
        break;
      case "thinking_delta":
        handleThinkingDeltaEvent(event, deps);
        break;
      case "text_delta":
        handleTextDeltaEvent(event, deps);
        break;
      case "tool_start":
        handleToolStartEvent(event, deps);
        break;
      case "tool_input":
        handleToolInputEvent(event, deps);
        break;
      case "permission_request":
        handlePermissionRequestEvent(event, deps);
        break;
      case "tool_pending":
        handleToolPendingEvent(deps);
        break;
      case "tool_result":
        handleToolResultEvent(event, deps);
        break;
      case "block_end":
        // Content block ended - no action needed
        break;
      case "context_update":
        handleContextUpdateEvent(event, deps);
        break;
      case "result":
        handleResultEvent(event, deps);
        break;
      case "done":
        handleDoneEvent(deps);
        break;
      case "closed":
        handleClosedEvent(event, deps);
        break;
      case "error":
        handleErrorEvent(event, deps);
        break;
    }
  };
}
