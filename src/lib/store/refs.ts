/**
 * Mutable refs for streaming JSON accumulation.
 *
 * These refs are intentionally NOT reactive. They are used for performance-critical
 * JSON accumulation during streaming, where triggering reactivity on every
 * character would cause excessive re-renders.
 *
 * Event handlers mutate these directly, then dispatch actions to update
 * the reactive store when meaningful state changes occur.
 */

import type { StreamingRefs } from "./types";

/**
 * Create fresh streaming refs.
 * Called once when the store is initialized.
 */
export function createStreamingRefs(): StreamingRefs {
  return {
    toolInputRef: { current: "" },
    todoJsonRef: { current: "" },
    questionJsonRef: { current: "" },
    isCollectingTodoRef: { current: false },
    isCollectingQuestionRef: { current: false },
    pendingResultsRef: { current: new Map() },
    lastToolBlockIndexRef: { current: null },
    toolIdToBlockIndexRef: { current: new Map() },
    bgTaskToToolUseIdRef: { current: new Map() },
    bgTaskAliasToCanonicalRef: { current: new Map() },
    bgPendingFinalTaskKeysRef: { current: new Set() },
    pendingBgTaskCompletionsRef: { current: new Map() },
    pendingBgTaskResultsRef: { current: new Map() },
    bgResultMessageIdsRef: { current: new Set() },
    bgFinalizedTaskIdsRef: { current: new Set() },
    bgFinalizedTaskOrderRef: { current: [] },
  };
}

/**
 * Reset all refs to initial state.
 * Called at the start of a new message/response.
 */
export function resetStreamingRefs(refs: StreamingRefs): void {
  refs.toolInputRef.current = "";
  refs.todoJsonRef.current = "";
  refs.questionJsonRef.current = "";
  refs.isCollectingTodoRef.current = false;
  refs.isCollectingQuestionRef.current = false;
  refs.pendingResultsRef.current.clear();
  refs.lastToolBlockIndexRef.current = null;
  refs.toolIdToBlockIndexRef.current.clear();
  // Keep bgTaskToToolUseIdRef and pending bg task maps across turns because
  // background task events can arrive long after foreground streaming ends.
  // Keep bgTaskAliasToCanonicalRef/bgPendingFinalTaskKeysRef across turns to
  // correlate late bg_task_result events and lock input until final output arrives.
  // Keep bgResultMessageIdsRef across turns so later updates for the same
  // background task can replace the existing message instead of duplicating.
  // Keep bgFinalizedTaskIdsRef across turns so late completion summaries do not
  // overwrite already-delivered final background results.
  // Keep bgFinalizedTaskOrderRef with bgFinalizedTaskIdsRef for bounded pruning.
}
