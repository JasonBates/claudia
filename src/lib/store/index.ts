/**
 * Store module - centralized state management for the application.
 *
 * This module replaces the distributed state across multiple hooks with
 * a single, centralized store using a reducer pattern.
 *
 * @example
 * ```tsx
 * // In App.tsx
 * import { StoreProvider } from "./lib/store";
 *
 * <StoreProvider>
 *   <App />
 * </StoreProvider>
 *
 * // In components
 * import { useStore, actions } from "./lib/store";
 *
 * const { dispatch, messages } = useStore();
 * dispatch(actions.addMessage(newMsg));
 * ```
 */

// Types
export type { ConversationState, StreamingRefs, UpdateInfo, UpdateStatus } from "./types";
export { createInitialState } from "./types";

// Actions
export type { Action } from "./actions";
export { actions } from "./actions";

// Reducer
export { conversationReducer } from "./reducer";

// Refs
export { createStreamingRefs, resetStreamingRefs } from "./refs";

// Context
export type { StoreContextValue } from "./context";
export { StoreProvider, useStore } from "./context";

// Event dispatch (new pattern replacing EventHandlerDeps)
export type { EventContext } from "./event-dispatch";
export { createEventDispatcher } from "./event-dispatch";
export {
  handleStatus,
  handleReady,
  handleClosed,
  handleError,
  handleContextUpdate,
  handleResult,
  handleDone,
  handleThinkingStart,
  handleThinkingDelta,
  handleTextDelta,
  handleToolStart,
  handleToolInput,
  handleToolPending,
  handleToolResult,
  handlePermissionRequest,
  handleAskUserQuestion,
  handleSubagentStart,
  handleSubagentProgress,
  handleSubagentEnd,
  handleBgTaskRegistered,
  handleBgTaskCompleted,
  handleBgTaskResult,
} from "./event-dispatch";
