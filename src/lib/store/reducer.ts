/**
 * Pure reducer function for centralized state management.
 *
 * The reducer handles all state transitions in a predictable way.
 * Given a current state and an action, it returns a new state.
 * This makes state changes testable and debuggable.
 */

import type { ConversationState } from "./types";
import type { Action } from "./actions";
import type { ToolUse, ContentBlock, Message, SubagentInfo } from "../types";

/**
 * Pure reducer function - given current state and action, returns new state.
 * Uses spread operators for immutable updates.
 */
export function conversationReducer(
  state: ConversationState,
  action: Action
): ConversationState {
  switch (action.type) {
    // =========================================================================
    // Message Actions
    // =========================================================================
    case "ADD_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };

    case "UPDATE_MESSAGE": {
      const { id, updates } = action.payload;
      return {
        ...state,
        messages: state.messages.map((msg) =>
          msg.id === id ? { ...msg, ...updates } : msg
        ),
      };
    }

    case "SET_MESSAGES":
      return {
        ...state,
        messages: action.payload,
      };

    case "CLEAR_MESSAGES":
      return {
        ...state,
        messages: [],
      };

    // =========================================================================
    // Streaming Actions
    // =========================================================================
    case "APPEND_STREAMING_CONTENT": {
      const text = action.payload;
      const newContent = state.streaming.content + text;

      // Update or add text block
      const blocks = [...state.streaming.blocks];
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock?.type === "text") {
        blocks[blocks.length - 1] = {
          type: "text",
          content: (lastBlock as { type: "text"; content: string }).content + text,
        };
      } else {
        blocks.push({ type: "text", content: text });
      }

      return {
        ...state,
        streaming: {
          ...state.streaming,
          content: newContent,
          blocks,
        },
      };
    }

    case "SET_STREAMING_CONTENT":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          content: action.payload,
        },
      };

    case "APPEND_STREAMING_THINKING": {
      const thinking = action.payload;
      const newThinking = state.streaming.thinking + thinking;

      // Update or add thinking block
      const blocks = [...state.streaming.blocks];
      const lastBlock = blocks[blocks.length - 1];
      if (lastBlock?.type === "thinking") {
        blocks[blocks.length - 1] = {
          type: "thinking",
          content: (lastBlock as { type: "thinking"; content: string }).content + thinking,
        };
      } else {
        blocks.push({ type: "thinking", content: thinking });
      }

      return {
        ...state,
        streaming: {
          ...state.streaming,
          thinking: newThinking,
          blocks,
        },
      };
    }

    case "SET_STREAMING_THINKING":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          thinking: action.payload,
        },
      };

    case "SET_STREAMING_LOADING":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          isLoading: action.payload,
        },
      };

    case "ADD_STREAMING_BLOCK":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          blocks: [...state.streaming.blocks, action.payload],
        },
      };

    case "SET_STREAMING_BLOCKS":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          blocks: action.payload,
        },
      };

    case "FINISH_STREAMING": {
      // Move streaming content to messages if there's any content
      const content = state.streaming.content;
      const tools = [...state.tools.current];
      const blocks = [...state.streaming.blocks];

      let newMessages = state.messages;
      if (content || tools.length > 0 || blocks.length > 0) {
        const generateId = action.payload?.generateId || (() => `msg-${Date.now()}`);
        const assistantMessage: Message = {
          id: generateId(),
          role: "assistant",
          content,
          toolUses: tools.length > 0 ? tools : undefined,
          contentBlocks: blocks.length > 0 ? blocks : undefined,
          interrupted: action.payload?.interrupted,
        };
        newMessages = [...state.messages, assistantMessage];
      }

      // Reset streaming state
      return {
        ...state,
        messages: newMessages,
        streaming: {
          content: "",
          blocks: [],
          thinking: "",
          isLoading: false,
          showThinking: state.streaming.showThinking,
        },
        tools: {
          current: [],
        },
      };
    }

    case "RESET_STREAMING":
      return {
        ...state,
        streaming: {
          content: "",
          blocks: [],
          thinking: "",
          isLoading: true,
          showThinking: state.streaming.showThinking,
        },
        tools: {
          current: [],
        },
        session: {
          ...state.session,
          error: null,
        },
      };

    case "SET_SHOW_THINKING":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          showThinking: action.payload,
        },
      };

    case "TOGGLE_SHOW_THINKING":
      return {
        ...state,
        streaming: {
          ...state.streaming,
          showThinking: !state.streaming.showThinking,
        },
      };

    // =========================================================================
    // Tool Actions
    // =========================================================================
    case "ADD_TOOL": {
      const newTool = action.payload;
      return {
        ...state,
        tools: {
          current: [...state.tools.current, newTool],
        },
        streaming: {
          ...state.streaming,
          blocks: [...state.streaming.blocks, { type: "tool_use", tool: newTool }],
        },
      };
    }

    case "UPDATE_TOOL": {
      const { id, updates } = action.payload;

      // Update in tools.current
      const updatedTools = state.tools.current.map((tool) =>
        tool.id === id ? { ...tool, ...updates } : tool
      );

      // Update in streaming blocks
      const updatedBlocks = state.streaming.blocks.map((block) => {
        if (block.type === "tool_use" && (block as { type: "tool_use"; tool: ToolUse }).tool.id === id) {
          const toolBlock = block as { type: "tool_use"; tool: ToolUse };
          return {
            type: "tool_use" as const,
            tool: { ...toolBlock.tool, ...updates },
          };
        }
        return block;
      });

      return {
        ...state,
        tools: {
          current: updatedTools,
        },
        streaming: {
          ...state.streaming,
          blocks: updatedBlocks,
        },
      };
    }

    case "UPDATE_TOOL_SUBAGENT": {
      const { id, subagent } = action.payload;

      // Update in tools.current
      const updatedTools = state.tools.current.map((tool) => {
        if (tool.id === id) {
          return {
            ...tool,
            subagent: tool.subagent
              ? { ...tool.subagent, ...subagent }
              : (subagent as unknown as SubagentInfo),
          };
        }
        return tool;
      });

      // Update in streaming blocks
      const updatedBlocks = state.streaming.blocks.map((block) => {
        if (block.type === "tool_use") {
          const toolBlock = block as { type: "tool_use"; tool: ToolUse };
          if (toolBlock.tool.id === id) {
            return {
              type: "tool_use" as const,
              tool: {
                ...toolBlock.tool,
                subagent: toolBlock.tool.subagent
                  ? { ...toolBlock.tool.subagent, ...subagent }
                  : (subagent as unknown as SubagentInfo),
              },
            };
          }
        }
        return block;
      });

      return {
        ...state,
        tools: {
          current: updatedTools,
        },
        streaming: {
          ...state.streaming,
          blocks: updatedBlocks,
        },
      };
    }

    case "UPDATE_LAST_TOOL_INPUT": {
      const parsedInput = action.payload;
      const tools = state.tools.current;
      if (tools.length === 0) return state;

      // Update last tool in tools.current
      const updatedTools = [...tools];
      updatedTools[updatedTools.length - 1] = {
        ...updatedTools[updatedTools.length - 1],
        input: parsedInput,
      };

      // Update last tool_use block in streaming blocks
      const updatedBlocks: ContentBlock[] = [...state.streaming.blocks];
      for (let i = updatedBlocks.length - 1; i >= 0; i--) {
        if (updatedBlocks[i].type === "tool_use") {
          const toolBlock = updatedBlocks[i] as { type: "tool_use"; tool: ToolUse };
          updatedBlocks[i] = {
            type: "tool_use",
            tool: { ...toolBlock.tool, input: parsedInput },
          };
          break;
        }
      }

      return {
        ...state,
        tools: {
          current: updatedTools,
        },
        streaming: {
          ...state.streaming,
          blocks: updatedBlocks,
        },
      };
    }

    case "SET_TOOLS":
      return {
        ...state,
        tools: {
          current: action.payload,
        },
      };

    case "CLEAR_TOOLS":
      return {
        ...state,
        tools: {
          current: [],
        },
      };

    // =========================================================================
    // Todo Actions
    // =========================================================================
    case "SET_TODOS":
      return {
        ...state,
        todo: {
          ...state.todo,
          items: action.payload,
        },
      };

    case "SET_TODO_PANEL_VISIBLE":
      return {
        ...state,
        todo: {
          ...state.todo,
          showPanel: action.payload,
        },
      };

    case "SET_TODO_PANEL_HIDING":
      return {
        ...state,
        todo: {
          ...state.todo,
          isHiding: action.payload,
        },
      };

    // =========================================================================
    // Question Actions
    // =========================================================================
    case "SET_QUESTIONS":
      return {
        ...state,
        question: {
          ...state.question,
          pending: action.payload,
        },
      };

    case "SET_QUESTION_PANEL_VISIBLE":
      return {
        ...state,
        question: {
          ...state.question,
          showPanel: action.payload,
        },
      };

    case "SET_PENDING_QUESTION_REQUEST_ID":
      return {
        ...state,
        question: {
          ...state.question,
          requestId: action.payload,
        },
      };

    case "CLEAR_QUESTION_PANEL":
      return {
        ...state,
        question: {
          pending: [],
          showPanel: false,
          requestId: null,
        },
      };

    // =========================================================================
    // Planning Actions
    // =========================================================================
    case "SET_PLANNING_ACTIVE":
      return {
        ...state,
        planning: {
          ...state.planning,
          isActive: action.payload,
        },
      };

    case "SET_PLAN_FILE_PATH":
      return {
        ...state,
        planning: {
          ...state.planning,
          filePath: action.payload,
        },
      };

    case "SET_PLAN_APPROVAL_VISIBLE":
      return {
        ...state,
        planning: {
          ...state.planning,
          showApproval: action.payload,
        },
      };

    case "SET_PLAN_CONTENT":
      return {
        ...state,
        planning: {
          ...state.planning,
          content: action.payload,
        },
      };

    case "EXIT_PLANNING":
      return {
        ...state,
        planning: {
          ...state.planning,
          isActive: false,
          showApproval: false,
          filePath: null,
          content: "",
        },
      };

    // =========================================================================
    // Permission Actions
    // =========================================================================
    case "SET_PENDING_PERMISSION":
      return {
        ...state,
        permission: {
          pending: action.payload,
        },
      };

    // =========================================================================
    // Session Actions
    // =========================================================================
    case "SET_SESSION_ACTIVE":
      return {
        ...state,
        session: {
          ...state.session,
          active: action.payload,
        },
      };

    case "UPDATE_SESSION_INFO":
      return {
        ...state,
        session: {
          ...state.session,
          info: { ...state.session.info, ...action.payload },
        },
      };

    case "SET_SESSION_INFO":
      return {
        ...state,
        session: {
          ...state.session,
          info: action.payload,
        },
      };

    case "SET_SESSION_ERROR":
      return {
        ...state,
        session: {
          ...state.session,
          error: action.payload,
        },
      };

    case "SET_LAUNCH_SESSION_ID":
      return {
        ...state,
        session: {
          ...state.session,
          launchSessionId: action.payload,
        },
      };

    // =========================================================================
    // Compaction Actions
    // =========================================================================
    case "SET_COMPACTION_PRE_TOKENS":
      return {
        ...state,
        compaction: {
          ...state.compaction,
          preTokens: action.payload,
        },
      };

    case "SET_COMPACTION_MESSAGE_ID":
      return {
        ...state,
        compaction: {
          ...state.compaction,
          messageId: action.payload,
        },
      };

    case "SET_WARNING_DISMISSED":
      return {
        ...state,
        compaction: {
          ...state.compaction,
          warningDismissed: action.payload,
        },
      };

    case "START_COMPACTION": {
      const { preTokens, messageId } = action.payload;
      const preK = Math.round(preTokens / 1000);

      const compactionMsg: Message = {
        id: messageId,
        role: "system",
        content: `${preK}k → ...`,
        variant: "compaction",
      };

      return {
        ...state,
        messages: [...state.messages, compactionMsg],
        compaction: {
          ...state.compaction,
          preTokens,
          messageId,
        },
      };
    }

    case "COMPLETE_COMPACTION": {
      const { preTokens, postTokens, baseContext } = action.payload;
      const estimatedContext = baseContext + postTokens;
      const preK = Math.round(preTokens / 1000);
      const postK = estimatedContext > 0 ? Math.round(estimatedContext / 1000) : "?";
      const content = `${preK}k → ${postK}k`;

      // Update the compaction message if it exists
      const existingMsgId = state.compaction.messageId;
      let newMessages = state.messages;
      if (existingMsgId) {
        newMessages = state.messages.map((msg) =>
          msg.id === existingMsgId ? { ...msg, content } : msg
        );
      } else {
        // Add a new compaction message if none exists
        const compactionMsg: Message = {
          id: `compaction-${Date.now()}`,
          role: "system",
          content,
          variant: "compaction",
        };
        newMessages = [...state.messages, compactionMsg];
      }

      return {
        ...state,
        messages: newMessages,
        session: {
          ...state.session,
          info: {
            ...state.session.info,
            totalContext: estimatedContext > 0 ? estimatedContext : state.session.info.totalContext,
          },
        },
        compaction: {
          preTokens: null,
          messageId: null,
          warningDismissed: false,
        },
      };
    }

    default:
      return state;
  }
}
