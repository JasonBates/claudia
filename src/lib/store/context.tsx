/**
 * Store context and provider for centralized state management.
 *
 * This module provides the StoreProvider component and useStore hook
 * that make the centralized state available throughout the application.
 *
 * The store uses SolidJS's createStore for fine-grained reactivity,
 * with actions dispatched through a reducer for predictable updates.
 */

import {
  createContext,
  useContext,
  batch,
  type ParentComponent,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { ConversationState, StreamingRefs } from "./types";
import { createInitialState } from "./types";
import { createStreamingRefs } from "./refs";
import type { Action } from "./actions";
import { conversationReducer } from "./reducer";
import type { ToolUse, ContentBlock, Message, Todo, Question } from "../types";
import type { SessionInfo, PermissionRequest } from "../event-handlers";

/**
 * Store context value - provides state, dispatch, and convenience accessors.
 */
export interface StoreContextValue {
  /** The reactive state object */
  state: ConversationState;
  /** Dispatch an action to update state */
  dispatch: (action: Action) => void;
  /** Mutable refs for streaming JSON accumulation */
  refs: StreamingRefs;

  // === Convenience Accessors ===
  // These provide direct access to commonly-used state slices

  /** Messages in conversation */
  messages: () => Message[];
  /** Current streaming text content */
  streamingContent: () => string;
  /** Current streaming content blocks */
  streamingBlocks: () => ContentBlock[];
  /** Current streaming thinking content */
  streamingThinking: () => string;
  /** Whether to show thinking content */
  showThinking: () => boolean;
  /** Whether a response is being streamed */
  isLoading: () => boolean;
  /** Current tool uses in progress */
  currentToolUses: () => ToolUse[];
  /** Current error message */
  error: () => string | null;
  /** Session info (model, tokens, etc.) */
  sessionInfo: () => SessionInfo;
  /** Whether session is active */
  sessionActive: () => boolean;
  /** Launch session ID */
  launchSessionId: () => string | null;
  /** Current todo items */
  currentTodos: () => Todo[];
  /** Whether todo panel is visible */
  showTodoPanel: () => boolean;
  /** Whether todo panel is hiding */
  todoPanelHiding: () => boolean;
  /** Pending questions */
  pendingQuestions: () => Question[];
  /** Whether question panel is visible */
  showQuestionPanel: () => boolean;
  /** Whether planning mode is active */
  isPlanning: () => boolean;
  /** Plan file path */
  planFilePath: () => string | null;
  /** Whether plan approval is visible */
  showPlanApproval: () => boolean;
  /** Plan content */
  planContent: () => string;
  /** Pending permission request */
  pendingPermission: () => PermissionRequest | null;
  /** Pre-compaction token count */
  lastCompactionPreTokens: () => number | null;
  /** Compaction message ID */
  compactionMessageId: () => string | null;
  /** Warning dismissed state */
  warningDismissed: () => boolean;

  // === ID Generation ===
  /** Generate a unique message ID */
  generateMessageId: () => string;
}

const StoreContext = createContext<StoreContextValue>();

/**
 * Store provider component.
 * Wrap your app with this to make the store available via useStore().
 */
export const StoreProvider: ParentComponent = (props) => {
  const [state, setState] = createStore<ConversationState>(createInitialState());
  const refs = createStreamingRefs();

  // Message ID counter for unique IDs
  let messageIdCounter = 0;
  const generateMessageId = () => {
    messageIdCounter++;
    return `msg-${Date.now()}-${messageIdCounter}`;
  };

  /**
   * Dispatch an action to update state.
   * Actions are processed through the reducer for predictable updates.
   */
  const dispatch = (action: Action): void => {
    batch(() => {
      const newState = conversationReducer(state, action);
      // Use reconcile for efficient updates that preserve referential equality
      // where possible, enabling fine-grained reactivity
      setState(reconcile(newState));
    });
  };

  const value: StoreContextValue = {
    state,
    dispatch,
    refs,

    // Convenience accessors
    messages: () => state.messages,
    streamingContent: () => state.streaming.content,
    streamingBlocks: () => state.streaming.blocks,
    streamingThinking: () => state.streaming.thinking,
    showThinking: () => state.streaming.showThinking,
    isLoading: () => state.streaming.isLoading,
    currentToolUses: () => state.tools.current,
    error: () => state.session.error,
    sessionInfo: () => state.session.info,
    sessionActive: () => state.session.active,
    launchSessionId: () => state.session.launchSessionId,
    currentTodos: () => state.todo.items,
    showTodoPanel: () => state.todo.showPanel,
    todoPanelHiding: () => state.todo.isHiding,
    pendingQuestions: () => state.question.pending,
    showQuestionPanel: () => state.question.showPanel,
    isPlanning: () => state.planning.isActive,
    planFilePath: () => state.planning.filePath,
    showPlanApproval: () => state.planning.showApproval,
    planContent: () => state.planning.content,
    pendingPermission: () => state.permission.pending,
    lastCompactionPreTokens: () => state.compaction.preTokens,
    compactionMessageId: () => state.compaction.messageId,
    warningDismissed: () => state.compaction.warningDismissed,

    generateMessageId,
  };

  return (
    <StoreContext.Provider value={value}>
      {props.children}
    </StoreContext.Provider>
  );
};

/**
 * Hook to access the store.
 * Must be used within a StoreProvider.
 *
 * @example
 * ```tsx
 * const { state, dispatch, messages } = useStore();
 *
 * // Read state
 * const allMessages = messages();
 *
 * // Dispatch actions
 * dispatch({ type: "ADD_MESSAGE", payload: newMessage });
 * ```
 */
export function useStore(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within StoreProvider");
  }
  return context;
}
