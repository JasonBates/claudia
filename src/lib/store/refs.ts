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
}
