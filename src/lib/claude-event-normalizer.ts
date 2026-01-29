/**
 * Normalized Event Pipeline
 *
 * This module provides a single normalization boundary for Claude streaming events.
 * It converts raw events (which may have snake_case or camelCase fields depending
 * on the source) into a canonical camelCase format with sensible defaults.
 *
 * The normalization happens at the event boundary (in App.tsx handleEvent) so that
 * all downstream handlers receive consistent, strongly-typed events.
 */

import type { ClaudeEvent } from "./tauri";

// ============================================================================
// Normalized Event Types
// ============================================================================

/**
 * Status event (includes compaction notifications)
 */
export interface NormalizedStatusEvent {
  type: "status";
  message: string;
  isCompaction: boolean;
  preTokens: number;
  postTokens: number;
}

/**
 * Ready event (session established)
 */
export interface NormalizedReadyEvent {
  type: "ready";
  sessionId: string | undefined;
  model: string | undefined;
  tools: number;
}

/**
 * Processing event (user message being processed)
 */
export interface NormalizedProcessingEvent {
  type: "processing";
  prompt: string;
}

/**
 * Text delta event (streaming text)
 */
export interface NormalizedTextDeltaEvent {
  type: "text_delta";
  text: string;
}

/**
 * Thinking start event
 */
export interface NormalizedThinkingStartEvent {
  type: "thinking_start";
  index: number;
}

/**
 * Thinking delta event (streaming thinking content)
 */
export interface NormalizedThinkingDeltaEvent {
  type: "thinking_delta";
  thinking: string;
}

/**
 * Tool start event
 */
export interface NormalizedToolStartEvent {
  type: "tool_start";
  id: string;
  name: string;
}

/**
 * Tool input event (streaming JSON chunks)
 */
export interface NormalizedToolInputEvent {
  type: "tool_input";
  json: string;
}

/**
 * Tool pending event (tool about to execute)
 */
export interface NormalizedToolPendingEvent {
  type: "tool_pending";
}

/**
 * Permission request event
 */
export interface NormalizedPermissionRequestEvent {
  type: "permission_request";
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
}

/**
 * AskUserQuestion event (Claude asking clarifying questions)
 */
export interface NormalizedAskUserQuestionEvent {
  type: "ask_user_question";
  requestId: string;
  questions: unknown[];
}

/**
 * Tool result event
 */
export interface NormalizedToolResultEvent {
  type: "tool_result";
  toolUseId: string | undefined;
  stdout: string;
  stderr: string;
  isError: boolean;
}

/**
 * Block end event
 */
export interface NormalizedBlockEndEvent {
  type: "block_end";
}

/**
 * Context update event (token usage)
 */
export interface NormalizedContextUpdateEvent {
  type: "context_update";
  inputTokens: number;
  rawInputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Result event (response complete)
 */
export interface NormalizedResultEvent {
  type: "result";
  content: string | undefined;
  cost: number | undefined;
  duration: number | undefined;
  turns: number | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Done event
 */
export interface NormalizedDoneEvent {
  type: "done";
}

/**
 * Interrupted event
 */
export interface NormalizedInterruptedEvent {
  type: "interrupted";
}

/**
 * Closed event (session terminated)
 */
export interface NormalizedClosedEvent {
  type: "closed";
  code: number;
}

/**
 * Error event
 */
export interface NormalizedErrorEvent {
  type: "error";
  message: string;
}

/**
 * Subagent start event (Task tool started)
 */
export interface NormalizedSubagentStartEvent {
  type: "subagent_start";
  id: string;
  agentType: string;
  description: string;
}

/**
 * Subagent progress event (nested tool executing)
 */
export interface NormalizedSubagentProgressEvent {
  type: "subagent_progress";
  subagentId: string;
  toolName: string;
  toolDetail: string;
  toolCount: number;
}

/**
 * Subagent end event (Task tool completed)
 */
export interface NormalizedSubagentEndEvent {
  type: "subagent_end";
  id: string;
  agentType: string;
  duration: number;
  toolCount: number;
  result: string;
}

/**
 * Union of all normalized event types
 */
export type NormalizedEvent =
  | NormalizedStatusEvent
  | NormalizedReadyEvent
  | NormalizedProcessingEvent
  | NormalizedTextDeltaEvent
  | NormalizedThinkingStartEvent
  | NormalizedThinkingDeltaEvent
  | NormalizedToolStartEvent
  | NormalizedToolInputEvent
  | NormalizedToolPendingEvent
  | NormalizedPermissionRequestEvent
  | NormalizedAskUserQuestionEvent
  | NormalizedToolResultEvent
  | NormalizedBlockEndEvent
  | NormalizedContextUpdateEvent
  | NormalizedResultEvent
  | NormalizedDoneEvent
  | NormalizedInterruptedEvent
  | NormalizedClosedEvent
  | NormalizedErrorEvent
  | NormalizedSubagentStartEvent
  | NormalizedSubagentProgressEvent
  | NormalizedSubagentEndEvent;

// ============================================================================
// Normalizer Function
// ============================================================================

/**
 * Normalize a raw ClaudeEvent to canonical camelCase format.
 *
 * This function handles the dual naming convention (snake_case from Rust,
 * camelCase from JS bridge) and applies sensible defaults for missing fields.
 *
 * snake_case takes precedence when both variants are present (matches the
 * original || fallback order in handlers).
 *
 * @param event - Raw event from Tauri channel
 * @returns Normalized event with consistent camelCase naming
 */
export function normalizeClaudeEvent(event: ClaudeEvent): NormalizedEvent {
  switch (event.type) {
    case "status":
      return {
        type: "status",
        message: event.message || "",
        isCompaction: event.is_compaction ?? event.isCompaction ?? false,
        preTokens: event.pre_tokens ?? event.preTokens ?? 0,
        postTokens: event.post_tokens ?? event.postTokens ?? 0,
      };

    case "ready":
      return {
        type: "ready",
        sessionId: event.session_id ?? event.sessionId,
        model: event.model,
        tools: event.tools ?? 0,
      };

    case "processing":
      return {
        type: "processing",
        prompt: event.prompt || "",
      };

    case "text_delta":
      return {
        type: "text_delta",
        text: event.text || "",
      };

    case "thinking_start":
      return {
        type: "thinking_start",
        index: event.index ?? 0,
      };

    case "thinking_delta":
      return {
        type: "thinking_delta",
        thinking: event.thinking || "",
      };

    case "tool_start":
      return {
        type: "tool_start",
        id: event.id || "",
        name: event.name || "unknown",
      };

    case "tool_input":
      return {
        type: "tool_input",
        json: event.json || "",
      };

    case "tool_pending":
      return {
        type: "tool_pending",
      };

    case "permission_request":
      return {
        type: "permission_request",
        requestId: event.request_id ?? event.requestId ?? "",
        toolName: event.tool_name ?? event.toolName ?? "unknown",
        toolInput: event.tool_input ?? event.toolInput,
        description: event.description || "",
      };

    case "ask_user_question":
      return {
        type: "ask_user_question",
        requestId: event.request_id ?? event.requestId ?? "",
        questions: event.questions ?? [],
      };

    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: event.tool_use_id,
        stdout: event.stdout || "",
        stderr: event.stderr || "",
        isError: event.is_error ?? event.isError ?? false,
      };

    case "block_end":
      return {
        type: "block_end",
      };

    case "context_update":
      return {
        type: "context_update",
        inputTokens: event.input_tokens ?? event.inputTokens ?? 0,
        rawInputTokens: event.raw_input_tokens ?? event.rawInputTokens ?? 0,
        cacheRead: event.cache_read ?? event.cacheRead ?? 0,
        cacheWrite: event.cache_write ?? event.cacheWrite ?? 0,
      };

    case "result":
      return {
        type: "result",
        content: event.content,
        cost: event.cost,
        duration: event.duration,
        turns: event.turns,
        inputTokens: event.input_tokens ?? event.inputTokens ?? 0,
        outputTokens: event.output_tokens ?? event.outputTokens ?? 0,
        cacheRead: event.cache_read ?? event.cacheRead ?? 0,
        cacheWrite: event.cache_write ?? event.cacheWrite ?? 0,
      };

    case "done":
      return {
        type: "done",
      };

    case "interrupted":
      return {
        type: "interrupted",
      };

    case "closed":
      return {
        type: "closed",
        code: event.code ?? 0,
      };

    case "error":
      return {
        type: "error",
        message: event.message || "Unknown error",
      };

    case "subagent_start":
      return {
        type: "subagent_start",
        id: event.id || "",
        agentType: event.agent_type || "unknown",
        description: event.description || "",
      };

    case "subagent_progress":
      return {
        type: "subagent_progress",
        subagentId: event.subagent_id || "",
        toolName: event.tool_name ?? event.toolName ?? "unknown",
        toolDetail: event.tool_detail || "",
        toolCount: event.tool_count ?? 0,
      };

    case "subagent_end":
      return {
        type: "subagent_end",
        id: event.id || "",
        agentType: event.agent_type || "unknown",
        duration: event.duration ?? 0,
        toolCount: event.tool_count ?? 0,
        result: event.result || "",
      };

    default: {
      // Unknown event type - this shouldn't happen but handle gracefully
      // Return a minimal valid event to satisfy the type system
      const unknownEvent = event as { type: string };
      console.warn(`[normalizeClaudeEvent] Unknown event type: ${unknownEvent.type}`);
      return {
        type: "status",
        message: `Unknown event: ${unknownEvent.type}`,
        isCompaction: false,
        preTokens: 0,
        postTokens: 0,
      };
    }
  }
}
