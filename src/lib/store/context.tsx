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
import type { ToolUse, ContentBlock, Message, Todo, Question, SubagentInfo } from "../types";
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
  /** Question request ID for control protocol response */
  questionRequestId: () => string | null;
  /** Whether planning mode is active */
  isPlanning: () => boolean;
  /** Plan file path */
  planFilePath: () => string | null;
  /** Plan content */
  planContent: () => string;
  /** Planning tool ID */
  planningToolId: () => string | null;
  /** Nested tools used during planning */
  planningNestedTools: () => { name: string; input?: string }[];
  /** Whether plan is ready for approval */
  planReady: () => boolean;
  /** Path of plan file that needs refresh (after Edit) */
  planNeedsRefresh: () => string | null;
  /** Permission request ID for plan approval (to send control_response) */
  planPermissionRequestId: () => string | null;
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
   *
   * Most actions go through the reducer + reconcile pattern.
   * Tool-related actions use direct path updates to ensure proper reactivity.
   *
   * IMPORTANT: SolidJS's <For> component only re-renders items when their
   * REFERENCE changes, not when nested properties change. We must REPLACE
   * the entire block/tool object (creating a new reference) to trigger re-renders.
   */
  const dispatch = (action: Action): void => {
    batch(() => {
      // Track tool block index when adding tools for O(1) updates
      if (action.type === "ADD_TOOL") {
        // After reducer runs, the new block will be at the end
        // Set the index BEFORE reconcile so we know where it will be
        refs.lastToolBlockIndexRef.current = state.streaming.blocks.length;
      }

      // Clear tool index when streaming finishes
      if (action.type === "FINISH_STREAMING" || action.type === "RESET_STREAMING") {
        refs.lastToolBlockIndexRef.current = null;
      }

      // Handle tool-related actions with path-based updates for proper reactivity
      // We REPLACE entire objects to ensure <For> sees the change
      if (action.type === "UPDATE_TOOL" || action.type === "UPDATE_TOOL_SUBAGENT" || action.type === "UPDATE_LAST_TOOL_INPUT") {

        if (action.type === "UPDATE_LAST_TOOL_INPUT") {
          const parsedInput = action.payload;
          const tools = state.tools.current;
          if (tools.length === 0) return;

          // Update last tool in tools.current - REPLACE the tool object
          const lastToolIdx = tools.length - 1;
          const lastTool = tools[lastToolIdx];
          setState("tools", "current", lastToolIdx, { ...lastTool, input: parsedInput });

          // Use tracked index for O(1) update instead of O(n) search
          const blockIdx = refs.lastToolBlockIndexRef.current;
          if (blockIdx !== null && blockIdx < state.streaming.blocks.length) {
            const block = state.streaming.blocks[blockIdx];
            if (block.type === "tool_use") {
              const toolBlock = block as { type: "tool_use"; tool: ToolUse };
              setState("streaming", "blocks", blockIdx, {
                type: "tool_use" as const,
                tool: { ...toolBlock.tool, input: parsedInput }
              });
              return;
            }
          }

          // Fallback to O(n) search if index is stale (shouldn't happen normally)
          for (let i = state.streaming.blocks.length - 1; i >= 0; i--) {
            const block = state.streaming.blocks[i];
            if (block.type === "tool_use") {
              const toolBlock = block as { type: "tool_use"; tool: ToolUse };
              setState("streaming", "blocks", i, {
                type: "tool_use" as const,
                tool: { ...toolBlock.tool, input: parsedInput }
              });
              break;
            }
          }
          return;
        }

        const { id } = action.payload as { id: string };

        if (action.type === "UPDATE_TOOL") {
          const { updates } = action.payload as { id: string; updates: Partial<ToolUse> };

          // Find indices first - early return if tool doesn't exist anywhere
          const toolIdx = state.tools.current.findIndex(t => t.id === id);
          let blockIdx = -1;
          for (let i = 0; i < state.streaming.blocks.length; i++) {
            const block = state.streaming.blocks[i];
            if (block.type === "tool_use" && (block as { type: "tool_use"; tool: ToolUse }).tool.id === id) {
              blockIdx = i;
              break;
            }
          }

          // Early return if tool not found in either location
          if (toolIdx === -1 && blockIdx === -1) return;

          // Update tools.current if found
          if (toolIdx !== -1) {
            const tool = state.tools.current[toolIdx];
            setState("tools", "current", toolIdx, { ...tool, ...updates });
          }

          // Update streaming.blocks if found (this is what the UI reads)
          if (blockIdx !== -1) {
            const toolBlock = state.streaming.blocks[blockIdx] as { type: "tool_use"; tool: ToolUse };
            setState("streaming", "blocks", blockIdx, {
              type: "tool_use" as const,
              tool: { ...toolBlock.tool, ...updates }
            });
          }
        } else if (action.type === "UPDATE_TOOL_SUBAGENT") {
          const { subagent } = action.payload;

          // Find in tools.current (active streaming)
          const toolIdx = state.tools.current.findIndex(t => t.id === id);

          // Find in streaming.blocks (active streaming)
          let blockIdx = -1;
          for (let i = 0; i < state.streaming.blocks.length; i++) {
            const block = state.streaming.blocks[i];
            if (block.type === "tool_use" && (block as { type: "tool_use"; tool: ToolUse }).tool.id === id) {
              blockIdx = i;
              break;
            }
          }

          // Find in finalized messages (for late-arriving subagent_end events)
          let msgIdx = -1;
          let msgBlockIdx = -1;
          if (toolIdx === -1 && blockIdx === -1) {
            // Search in finalized messages (reverse order - most recent first)
            for (let m = state.messages.length - 1; m >= 0 && msgIdx === -1; m--) {
              const msg = state.messages[m];
              if (msg.contentBlocks) {
                for (let b = 0; b < msg.contentBlocks.length; b++) {
                  const block = msg.contentBlocks[b];
                  if (block.type === "tool_use" && (block as { type: "tool_use"; tool: ToolUse }).tool.id === id) {
                    msgIdx = m;
                    msgBlockIdx = b;
                    break;
                  }
                }
              }
            }
          }

          // Early return if tool not found anywhere
          if (toolIdx === -1 && blockIdx === -1 && msgIdx === -1) return;

          // Update tools.current if found
          if (toolIdx !== -1) {
            const tool = state.tools.current[toolIdx];
            const newSubagent = tool.subagent
              ? { ...tool.subagent, ...subagent }
              : (subagent as SubagentInfo);
            setState("tools", "current", toolIdx, { ...tool, subagent: newSubagent });
          }

          // Update streaming.blocks if found
          if (blockIdx !== -1) {
            const toolBlock = state.streaming.blocks[blockIdx] as { type: "tool_use"; tool: ToolUse };
            const newSubagent = toolBlock.tool.subagent
              ? { ...toolBlock.tool.subagent, ...subagent }
              : (subagent as SubagentInfo);
            setState("streaming", "blocks", blockIdx, {
              type: "tool_use" as const,
              tool: { ...toolBlock.tool, subagent: newSubagent }
            });
          }

          // Update finalized message if found (handles late-arriving subagent_end)
          if (msgIdx !== -1 && msgBlockIdx !== -1) {
            const msgBlocks = state.messages[msgIdx].contentBlocks!;
            const toolBlock = msgBlocks[msgBlockIdx] as { type: "tool_use"; tool: ToolUse };
            const newSubagent = toolBlock.tool.subagent
              ? { ...toolBlock.tool.subagent, ...subagent }
              : (subagent as SubagentInfo);
            const newBlocks = [...msgBlocks];
            newBlocks[msgBlockIdx] = {
              type: "tool_use" as const,
              tool: { ...toolBlock.tool, subagent: newSubagent }
            };
            setState("messages", msgIdx, "contentBlocks", newBlocks);
          }
        }
        return;
      }

      // All other actions go through reducer + reconcile
      const newState = conversationReducer(state, action);
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
    questionRequestId: () => state.question.requestId,
    isPlanning: () => state.planning.isActive,
    planFilePath: () => state.planning.filePath,
    planContent: () => state.planning.content,
    planningToolId: () => state.planning.toolId,
    planningNestedTools: () => state.planning.nestedTools,
    planReady: () => state.planning.isReady,
    planNeedsRefresh: () => state.planning.needsRefresh,
    planPermissionRequestId: () => state.planning.permissionRequestId,
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
