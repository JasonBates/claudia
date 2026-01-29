/**
 * Unit tests for the conversation reducer.
 *
 * These tests verify that the reducer correctly handles all action types
 * and produces the expected state transitions. The reducer is pure, making
 * tests straightforward: state in, action, state out.
 */

import { describe, it, expect } from "vitest";
import { conversationReducer } from "../../lib/store/reducer";
import { createInitialState } from "../../lib/store/types";
import type { Action } from "../../lib/store/actions";
import type { Message, ToolUse, ContentBlock, Todo, Question } from "../../lib/types";
import type { PermissionRequest, SessionInfo } from "../../lib/event-handlers";

describe("conversationReducer", () => {
  // =========================================================================
  // Message Actions
  // =========================================================================
  describe("Message Actions", () => {
    it("ADD_MESSAGE should append message to messages array", () => {
      const state = createInitialState();
      const message: Message = {
        id: "msg-1",
        role: "user",
        content: "Hello",
      };

      const newState = conversationReducer(state, {
        type: "ADD_MESSAGE",
        payload: message,
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toEqual(message);
    });

    it("ADD_MESSAGE should preserve existing messages", () => {
      const existingMessage: Message = {
        id: "msg-1",
        role: "user",
        content: "First",
      };
      const state = {
        ...createInitialState(),
        messages: [existingMessage],
      };
      const newMessage: Message = {
        id: "msg-2",
        role: "assistant",
        content: "Second",
      };

      const newState = conversationReducer(state, {
        type: "ADD_MESSAGE",
        payload: newMessage,
      });

      expect(newState.messages).toHaveLength(2);
      expect(newState.messages[0]).toEqual(existingMessage);
      expect(newState.messages[1]).toEqual(newMessage);
    });

    it("UPDATE_MESSAGE should update specific message by id", () => {
      const state = {
        ...createInitialState(),
        messages: [
          { id: "msg-1", role: "user" as const, content: "Hello" },
          { id: "msg-2", role: "assistant" as const, content: "World" },
        ],
      };

      const newState = conversationReducer(state, {
        type: "UPDATE_MESSAGE",
        payload: { id: "msg-1", updates: { content: "Updated" } },
      });

      expect(newState.messages[0].content).toBe("Updated");
      expect(newState.messages[1].content).toBe("World");
    });

    it("SET_MESSAGES should replace entire messages array", () => {
      const state = {
        ...createInitialState(),
        messages: [{ id: "old", role: "user" as const, content: "Old" }],
      };
      const newMessages: Message[] = [
        { id: "new-1", role: "user", content: "New 1" },
        { id: "new-2", role: "assistant", content: "New 2" },
      ];

      const newState = conversationReducer(state, {
        type: "SET_MESSAGES",
        payload: newMessages,
      });

      expect(newState.messages).toEqual(newMessages);
    });

    it("CLEAR_MESSAGES should empty messages array", () => {
      const state = {
        ...createInitialState(),
        messages: [
          { id: "msg-1", role: "user" as const, content: "Hello" },
          { id: "msg-2", role: "assistant" as const, content: "World" },
        ],
      };

      const newState = conversationReducer(state, { type: "CLEAR_MESSAGES" });

      expect(newState.messages).toEqual([]);
    });
  });

  // =========================================================================
  // Streaming Actions
  // =========================================================================
  describe("Streaming Actions", () => {
    it("APPEND_STREAMING_CONTENT should append text to streaming.content", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "APPEND_STREAMING_CONTENT",
        payload: "Hello ",
      });

      expect(newState.streaming.content).toBe("Hello ");
    });

    it("APPEND_STREAMING_CONTENT should accumulate text across calls", () => {
      let state = createInitialState();

      state = conversationReducer(state, {
        type: "APPEND_STREAMING_CONTENT",
        payload: "Hello ",
      });
      state = conversationReducer(state, {
        type: "APPEND_STREAMING_CONTENT",
        payload: "World!",
      });

      expect(state.streaming.content).toBe("Hello World!");
    });

    it("APPEND_STREAMING_CONTENT should update or create text block", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "APPEND_STREAMING_CONTENT",
        payload: "Hello",
      });

      expect(newState.streaming.blocks).toHaveLength(1);
      expect(newState.streaming.blocks[0]).toEqual({
        type: "text",
        content: "Hello",
      });
    });

    it("APPEND_STREAMING_CONTENT should append to existing text block", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          ...createInitialState().streaming,
          content: "Hello ",
          blocks: [{ type: "text" as const, content: "Hello " }],
        },
      };

      const newState = conversationReducer(state, {
        type: "APPEND_STREAMING_CONTENT",
        payload: "World!",
      });

      expect(newState.streaming.blocks).toHaveLength(1);
      expect(newState.streaming.blocks[0]).toEqual({
        type: "text",
        content: "Hello World!",
      });
    });

    it("APPEND_STREAMING_CONTENT should create new block after tool block", () => {
      const toolUse: ToolUse = {
        id: "tool-1",
        name: "Read",
        input: {},
        isLoading: true,
      };
      const state = {
        ...createInitialState(),
        streaming: {
          ...createInitialState().streaming,
          blocks: [{ type: "tool_use" as const, tool: toolUse }],
        },
      };

      const newState = conversationReducer(state, {
        type: "APPEND_STREAMING_CONTENT",
        payload: "After tool",
      });

      expect(newState.streaming.blocks).toHaveLength(2);
      expect(newState.streaming.blocks[1]).toEqual({
        type: "text",
        content: "After tool",
      });
    });

    it("SET_STREAMING_CONTENT should replace content", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          ...createInitialState().streaming,
          content: "Old content",
        },
      };

      const newState = conversationReducer(state, {
        type: "SET_STREAMING_CONTENT",
        payload: "New content",
      });

      expect(newState.streaming.content).toBe("New content");
    });

    it("APPEND_STREAMING_THINKING should append thinking text", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "APPEND_STREAMING_THINKING",
        payload: "Thinking...",
      });

      expect(newState.streaming.thinking).toBe("Thinking...");
      expect(newState.streaming.blocks).toHaveLength(1);
      expect(newState.streaming.blocks[0]).toEqual({
        type: "thinking",
        content: "Thinking...",
      });
    });

    it("SET_STREAMING_LOADING should set isLoading flag", () => {
      const state = createInitialState();

      let newState = conversationReducer(state, {
        type: "SET_STREAMING_LOADING",
        payload: true,
      });
      expect(newState.streaming.isLoading).toBe(true);

      newState = conversationReducer(newState, {
        type: "SET_STREAMING_LOADING",
        payload: false,
      });
      expect(newState.streaming.isLoading).toBe(false);
    });

    it("FINISH_STREAMING should move streaming content to messages", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          content: "Response text",
          blocks: [{ type: "text" as const, content: "Response text" }],
          thinking: "",
          isLoading: true,
        },
        tools: { current: [] },
      };

      const newState = conversationReducer(state, {
        type: "FINISH_STREAMING",
        payload: { generateId: () => "msg-1" },
      });

      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toMatchObject({
        id: "msg-1",
        role: "assistant",
        content: "Response text",
      });
      expect(newState.streaming.content).toBe("");
      expect(newState.streaming.blocks).toEqual([]);
      expect(newState.streaming.isLoading).toBe(false);
    });

    it("FINISH_STREAMING should include tools in message", () => {
      const tool: ToolUse = {
        id: "tool-1",
        name: "Read",
        input: { file_path: "/test.txt" },
        result: "file content",
        isLoading: false,
      };
      const state = {
        ...createInitialState(),
        streaming: {
          content: "Let me read that",
          blocks: [
            { type: "text" as const, content: "Let me read that" },
            { type: "tool_use" as const, tool },
          ],
          thinking: "",
          isLoading: true,
        },
        tools: { current: [tool] },
      };

      const newState = conversationReducer(state, {
        type: "FINISH_STREAMING",
        payload: { generateId: () => "msg-1" },
      });

      expect(newState.messages[0].toolUses).toHaveLength(1);
      expect(newState.messages[0].toolUses![0]).toEqual(tool);
      expect(newState.tools.current).toEqual([]);
    });

    it("FINISH_STREAMING should mark message as interrupted", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          content: "Interrupted response",
          blocks: [{ type: "text" as const, content: "Interrupted response" }],
          thinking: "",
          isLoading: true,
        },
        tools: { current: [] },
      };

      const newState = conversationReducer(state, {
        type: "FINISH_STREAMING",
        payload: { interrupted: true, generateId: () => "msg-1" },
      });

      expect(newState.messages[0].interrupted).toBe(true);
    });

    it("FINISH_STREAMING should not add message if no content", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          content: "",
          blocks: [],
          thinking: "",
          isLoading: true,
        },
        tools: { current: [] },
      };

      const newState = conversationReducer(state, {
        type: "FINISH_STREAMING",
        payload: { generateId: () => "msg-1" },
      });

      expect(newState.messages).toHaveLength(0);
    });

    it("RESET_STREAMING should reset streaming state and set loading", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          content: "Some content",
          blocks: [{ type: "text" as const, content: "Some content" }],
          thinking: "Some thinking",
          isLoading: false,
        },
        tools: { current: [{ id: "t-1", name: "Test", input: {} }] },
        session: { ...createInitialState().session, error: "Old error" },
      };

      const newState = conversationReducer(state, { type: "RESET_STREAMING" });

      expect(newState.streaming.content).toBe("");
      expect(newState.streaming.blocks).toEqual([]);
      expect(newState.streaming.thinking).toBe("");
      expect(newState.streaming.isLoading).toBe(true);
      expect(newState.tools.current).toEqual([]);
      expect(newState.session.error).toBeNull();
    });
  });

  // =========================================================================
  // Tool Actions
  // =========================================================================
  describe("Tool Actions", () => {
    it("ADD_TOOL should add tool to current array and blocks", () => {
      const state = createInitialState();
      const tool: ToolUse = {
        id: "tool-1",
        name: "Read",
        input: {},
        isLoading: true,
      };

      const newState = conversationReducer(state, {
        type: "ADD_TOOL",
        payload: tool,
      });

      expect(newState.tools.current).toHaveLength(1);
      expect(newState.tools.current[0]).toEqual(tool);
      expect(newState.streaming.blocks).toHaveLength(1);
      expect(newState.streaming.blocks[0]).toEqual({
        type: "tool_use",
        tool,
      });
    });

    it("UPDATE_TOOL should update tool by id in both tools and blocks", () => {
      const tool: ToolUse = {
        id: "tool-1",
        name: "Read",
        input: {},
        isLoading: true,
      };
      const state = {
        ...createInitialState(),
        tools: { current: [tool] },
        streaming: {
          ...createInitialState().streaming,
          blocks: [{ type: "tool_use" as const, tool }],
        },
      };

      const newState = conversationReducer(state, {
        type: "UPDATE_TOOL",
        payload: {
          id: "tool-1",
          updates: { result: "file content", isLoading: false },
        },
      });

      expect(newState.tools.current[0].result).toBe("file content");
      expect(newState.tools.current[0].isLoading).toBe(false);

      const toolBlock = newState.streaming.blocks[0] as {
        type: "tool_use";
        tool: ToolUse;
      };
      expect(toolBlock.tool.result).toBe("file content");
      expect(toolBlock.tool.isLoading).toBe(false);
    });

    it("UPDATE_LAST_TOOL_INPUT should update last tool's input", () => {
      const tool1: ToolUse = {
        id: "tool-1",
        name: "Read",
        input: { file_path: "/old.txt" },
        isLoading: true,
      };
      const tool2: ToolUse = {
        id: "tool-2",
        name: "Edit",
        input: {},
        isLoading: true,
      };
      const state = {
        ...createInitialState(),
        tools: { current: [tool1, tool2] },
        streaming: {
          ...createInitialState().streaming,
          blocks: [
            { type: "tool_use" as const, tool: tool1 },
            { type: "tool_use" as const, tool: tool2 },
          ],
        },
      };

      const newState = conversationReducer(state, {
        type: "UPDATE_LAST_TOOL_INPUT",
        payload: { file_path: "/new.txt" },
      });

      expect(newState.tools.current[0].input).toEqual({
        file_path: "/old.txt",
      });
      expect(newState.tools.current[1].input).toEqual({
        file_path: "/new.txt",
      });
    });

    it("SET_TOOLS should replace tools array", () => {
      const state = {
        ...createInitialState(),
        tools: {
          current: [{ id: "old", name: "Old", input: {}, isLoading: true }],
        },
      };
      const newTools: ToolUse[] = [
        { id: "new-1", name: "New1", input: {}, isLoading: true },
        { id: "new-2", name: "New2", input: {}, isLoading: false },
      ];

      const newState = conversationReducer(state, {
        type: "SET_TOOLS",
        payload: newTools,
      });

      expect(newState.tools.current).toEqual(newTools);
    });

    it("CLEAR_TOOLS should empty tools array", () => {
      const state = {
        ...createInitialState(),
        tools: {
          current: [
            { id: "t-1", name: "Test", input: {}, isLoading: true },
            { id: "t-2", name: "Test2", input: {}, isLoading: false },
          ],
        },
      };

      const newState = conversationReducer(state, { type: "CLEAR_TOOLS" });

      expect(newState.tools.current).toEqual([]);
    });
  });

  // =========================================================================
  // Todo Actions
  // =========================================================================
  describe("Todo Actions", () => {
    it("SET_TODOS should set todo items", () => {
      const state = createInitialState();
      const todos: Todo[] = [
        { content: "Task 1", status: "pending" },
        { content: "Task 2", status: "in_progress" },
      ];

      const newState = conversationReducer(state, {
        type: "SET_TODOS",
        payload: todos,
      });

      expect(newState.todo.items).toEqual(todos);
    });

    it("SET_TODO_PANEL_VISIBLE should toggle panel visibility", () => {
      const state = createInitialState();

      let newState = conversationReducer(state, {
        type: "SET_TODO_PANEL_VISIBLE",
        payload: true,
      });
      expect(newState.todo.showPanel).toBe(true);

      newState = conversationReducer(newState, {
        type: "SET_TODO_PANEL_VISIBLE",
        payload: false,
      });
      expect(newState.todo.showPanel).toBe(false);
    });

    it("SET_TODO_PANEL_HIDING should set hiding animation state", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_TODO_PANEL_HIDING",
        payload: true,
      });

      expect(newState.todo.isHiding).toBe(true);
    });
  });

  // =========================================================================
  // Question Actions
  // =========================================================================
  describe("Question Actions", () => {
    it("SET_QUESTIONS should set pending questions", () => {
      const state = createInitialState();
      const questions: Question[] = [
        {
          question: "What?",
          header: "Question",
          options: [],
          multiSelect: false,
        },
      ];

      const newState = conversationReducer(state, {
        type: "SET_QUESTIONS",
        payload: questions,
      });

      expect(newState.question.pending).toEqual(questions);
    });

    it("SET_QUESTION_PANEL_VISIBLE should toggle panel visibility", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_QUESTION_PANEL_VISIBLE",
        payload: true,
      });

      expect(newState.question.showPanel).toBe(true);
    });
  });

  // =========================================================================
  // Planning Actions
  // =========================================================================
  describe("Planning Actions", () => {
    it("SET_PLANNING_ACTIVE should toggle planning mode", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_PLANNING_ACTIVE",
        payload: true,
      });

      expect(newState.planning.isActive).toBe(true);
    });

    it("SET_PLAN_FILE_PATH should set plan file path", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_PLAN_FILE_PATH",
        payload: "/path/to/plan.md",
      });

      expect(newState.planning.filePath).toBe("/path/to/plan.md");
    });

    it("SET_PLAN_APPROVAL_VISIBLE should toggle approval modal", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_PLAN_APPROVAL_VISIBLE",
        payload: true,
      });

      expect(newState.planning.showApproval).toBe(true);
    });

    it("SET_PLAN_CONTENT should set plan content", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_PLAN_CONTENT",
        payload: "# My Plan\n\n1. Do this\n2. Do that",
      });

      expect(newState.planning.content).toBe("# My Plan\n\n1. Do this\n2. Do that");
    });

    it("EXIT_PLANNING should reset all planning state", () => {
      const state = {
        ...createInitialState(),
        planning: {
          isActive: true,
          filePath: "/path/to/plan.md",
          showApproval: true,
          content: "Plan content",
        },
      };

      const newState = conversationReducer(state, { type: "EXIT_PLANNING" });

      expect(newState.planning.isActive).toBe(false);
      expect(newState.planning.filePath).toBeNull();
      expect(newState.planning.showApproval).toBe(false);
      expect(newState.planning.content).toBe("");
    });
  });

  // =========================================================================
  // Permission Actions
  // =========================================================================
  describe("Permission Actions", () => {
    it("SET_PENDING_PERMISSION should set permission request", () => {
      const state = createInitialState();
      const permission: PermissionRequest = {
        requestId: "req-1",
        toolName: "Bash",
        description: "Run command",
      };

      const newState = conversationReducer(state, {
        type: "SET_PENDING_PERMISSION",
        payload: permission,
      });

      expect(newState.permission.pending).toEqual(permission);
    });

    it("SET_PENDING_PERMISSION should clear permission with null", () => {
      const state = {
        ...createInitialState(),
        permission: {
          pending: {
            requestId: "req-1",
            toolName: "Bash",
            description: "Run command",
          },
        },
      };

      const newState = conversationReducer(state, {
        type: "SET_PENDING_PERMISSION",
        payload: null,
      });

      expect(newState.permission.pending).toBeNull();
    });
  });

  // =========================================================================
  // Session Actions
  // =========================================================================
  describe("Session Actions", () => {
    it("SET_SESSION_ACTIVE should toggle session active state", () => {
      const state = createInitialState();

      let newState = conversationReducer(state, {
        type: "SET_SESSION_ACTIVE",
        payload: true,
      });
      expect(newState.session.active).toBe(true);

      newState = conversationReducer(newState, {
        type: "SET_SESSION_ACTIVE",
        payload: false,
      });
      expect(newState.session.active).toBe(false);
    });

    it("UPDATE_SESSION_INFO should merge session info", () => {
      const state = {
        ...createInitialState(),
        session: {
          ...createInitialState().session,
          info: { sessionId: "sess-1", model: "claude-3" },
        },
      };

      const newState = conversationReducer(state, {
        type: "UPDATE_SESSION_INFO",
        payload: { totalContext: 5000 },
      });

      expect(newState.session.info).toEqual({
        sessionId: "sess-1",
        model: "claude-3",
        totalContext: 5000,
      });
    });

    it("SET_SESSION_INFO should replace session info", () => {
      const state = {
        ...createInitialState(),
        session: {
          ...createInitialState().session,
          info: { sessionId: "old", model: "old-model", totalContext: 1000 },
        },
      };
      const newInfo: SessionInfo = {
        sessionId: "new",
        model: "claude-4",
      };

      const newState = conversationReducer(state, {
        type: "SET_SESSION_INFO",
        payload: newInfo,
      });

      expect(newState.session.info).toEqual(newInfo);
    });

    it("SET_SESSION_ERROR should set error message", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_SESSION_ERROR",
        payload: "Connection failed",
      });

      expect(newState.session.error).toBe("Connection failed");
    });

    it("SET_SESSION_ERROR should clear error with null", () => {
      const state = {
        ...createInitialState(),
        session: {
          ...createInitialState().session,
          error: "Old error",
        },
      };

      const newState = conversationReducer(state, {
        type: "SET_SESSION_ERROR",
        payload: null,
      });

      expect(newState.session.error).toBeNull();
    });

    it("SET_LAUNCH_SESSION_ID should set launch session ID", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_LAUNCH_SESSION_ID",
        payload: "launch-session-123",
      });

      expect(newState.session.launchSessionId).toBe("launch-session-123");
    });
  });

  // =========================================================================
  // Compaction Actions
  // =========================================================================
  describe("Compaction Actions", () => {
    it("SET_COMPACTION_PRE_TOKENS should set pre-compaction tokens", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_COMPACTION_PRE_TOKENS",
        payload: 100000,
      });

      expect(newState.compaction.preTokens).toBe(100000);
    });

    it("SET_COMPACTION_MESSAGE_ID should set compaction message ID", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_COMPACTION_MESSAGE_ID",
        payload: "compaction-123",
      });

      expect(newState.compaction.messageId).toBe("compaction-123");
    });

    it("SET_WARNING_DISMISSED should toggle warning dismissed state", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_WARNING_DISMISSED",
        payload: true,
      });

      expect(newState.compaction.warningDismissed).toBe(true);
    });

    it("START_COMPACTION should add compaction message and set tokens", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "START_COMPACTION",
        payload: {
          preTokens: 100000,
          messageId: "compaction-1",
          generateId: () => "compaction-1",
        },
      });

      expect(newState.compaction.preTokens).toBe(100000);
      expect(newState.compaction.messageId).toBe("compaction-1");
      expect(newState.messages).toHaveLength(1);
      expect(newState.messages[0]).toEqual({
        id: "compaction-1",
        role: "system",
        content: "100k → ...",
        variant: "compaction",
      });
    });

    it("COMPLETE_COMPACTION should update compaction message and reset state", () => {
      const state = {
        ...createInitialState(),
        messages: [
          {
            id: "compaction-1",
            role: "system" as const,
            content: "100k → ...",
            variant: "compaction" as const,
          },
        ],
        compaction: {
          preTokens: 100000,
          messageId: "compaction-1",
          warningDismissed: true,
        },
      };

      const newState = conversationReducer(state, {
        type: "COMPLETE_COMPACTION",
        payload: {
          preTokens: 100000,
          postTokens: 30000,
          baseContext: 20000,
        },
      });

      expect(newState.compaction.preTokens).toBeNull();
      expect(newState.compaction.messageId).toBeNull();
      expect(newState.compaction.warningDismissed).toBe(false);
      expect(newState.messages[0].content).toBe("100k → 50k");
      expect(newState.session.info.totalContext).toBe(50000); // baseContext + postTokens
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe("Edge Cases", () => {
    it("should return same state for unknown action type", () => {
      const state = createInitialState();
      // @ts-expect-error - Testing unknown action type
      const newState = conversationReducer(state, { type: "UNKNOWN_ACTION" });
      expect(newState).toBe(state);
    });

    it("UPDATE_MESSAGE should handle non-existent message ID gracefully", () => {
      const state = {
        ...createInitialState(),
        messages: [{ id: "msg-1", role: "user" as const, content: "Hello" }],
      };

      const newState = conversationReducer(state, {
        type: "UPDATE_MESSAGE",
        payload: { id: "non-existent", updates: { content: "Updated" } },
      });

      // Should not change anything
      expect(newState.messages).toEqual(state.messages);
    });

    it("UPDATE_TOOL should handle non-existent tool ID gracefully", () => {
      const tool: ToolUse = {
        id: "tool-1",
        name: "Read",
        input: {},
        isLoading: true,
      };
      const state = {
        ...createInitialState(),
        tools: { current: [tool] },
        streaming: {
          ...createInitialState().streaming,
          blocks: [{ type: "tool_use" as const, tool }],
        },
      };

      const newState = conversationReducer(state, {
        type: "UPDATE_TOOL",
        payload: { id: "non-existent", updates: { result: "test" } },
      });

      // Should not change anything
      expect(newState.tools.current[0].result).toBeUndefined();
    });

    it("UPDATE_LAST_TOOL_INPUT should handle empty tools array", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "UPDATE_LAST_TOOL_INPUT",
        payload: { file_path: "/test.txt" },
      });

      // Should not crash, state unchanged
      expect(newState.tools.current).toEqual([]);
    });
  });

  // =========================================================================
  // New Actions (Phase 4)
  // =========================================================================
  describe("New Actions", () => {
    it("SET_SHOW_THINKING should set showThinking", () => {
      const state = createInitialState();

      const newState = conversationReducer(state, {
        type: "SET_SHOW_THINKING",
        payload: true,
      });

      expect(newState.streaming.showThinking).toBe(true);
    });

    it("TOGGLE_SHOW_THINKING should toggle showThinking", () => {
      const state = createInitialState();
      expect(state.streaming.showThinking).toBe(false);

      let newState = conversationReducer(state, { type: "TOGGLE_SHOW_THINKING" });
      expect(newState.streaming.showThinking).toBe(true);

      newState = conversationReducer(newState, { type: "TOGGLE_SHOW_THINKING" });
      expect(newState.streaming.showThinking).toBe(false);
    });

    it("CLEAR_QUESTION_PANEL should reset question state", () => {
      const state = {
        ...createInitialState(),
        question: {
          pending: [{ question: "What?", header: "Q", options: [], multiSelect: false }],
          showPanel: true,
        },
      };

      const newState = conversationReducer(state, { type: "CLEAR_QUESTION_PANEL" });

      expect(newState.question.pending).toEqual([]);
      expect(newState.question.showPanel).toBe(false);
    });

    it("FINISH_STREAMING should preserve showThinking", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          content: "Response",
          blocks: [{ type: "text" as const, content: "Response" }],
          thinking: "",
          isLoading: true,
          showThinking: true, // This should be preserved
        },
        tools: { current: [] },
      };

      const newState = conversationReducer(state, {
        type: "FINISH_STREAMING",
        payload: { generateId: () => "msg-1" },
      });

      expect(newState.streaming.showThinking).toBe(true);
    });

    it("RESET_STREAMING should preserve showThinking", () => {
      const state = {
        ...createInitialState(),
        streaming: {
          ...createInitialState().streaming,
          showThinking: true, // This should be preserved
        },
      };

      const newState = conversationReducer(state, { type: "RESET_STREAMING" });

      expect(newState.streaming.showThinking).toBe(true);
      expect(newState.streaming.isLoading).toBe(true);
      expect(newState.streaming.content).toBe("");
    });
  });
});
