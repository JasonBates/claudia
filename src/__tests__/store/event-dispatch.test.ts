/**
 * Unit tests for event dispatch functions.
 *
 * These tests verify that event handlers dispatch the correct actions
 * to the store. Unlike the old EventHandlerDeps pattern which required
 * mocking 40+ setters, we only need to mock the dispatch function.
 */

import { describe, it, expect, vi } from "vitest";
import {
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
  handleToolResult,
  handlePermissionRequest,
  handleSubagentStart,
  handleSubagentProgress,
  handleSubagentEnd,
  handleBgTaskRegistered,
  handleBgTaskCompleted,
  handleBgTaskResult,
  type EventContext,
} from "../../lib/store/event-dispatch";
import { createStreamingRefs } from "../../lib/store/refs";
import type { NormalizedEvent } from "../../lib/claude-event-normalizer";
import type { ToolUse } from "../../lib/types";

/**
 * Create a mock EventContext for testing.
 * Much simpler than the old createMockDeps() which had 40+ properties!
 */
function createMockContext(overrides: Partial<EventContext> = {}): EventContext {
  return {
    dispatch: vi.fn(),
    refs: createStreamingRefs(),
    generateMessageId: () => `msg-${Date.now()}`,
    sendPermissionResponse: vi.fn().mockResolvedValue(undefined),
    getCurrentMode: () => "request",
    getSessionInfo: () => ({}),
    getLaunchSessionId: () => null,
    getPlanFilePath: () => null,
    getPlanningToolId: () => null,
    isPlanning: () => false,
    getCompactionPreTokens: () => null,
    getCompactionMessageId: () => null,
    getCurrentToolUses: () => [],
    ...overrides,
  };
}

describe("Event Dispatch Functions", () => {
  // =========================================================================
  // Status & Session Handlers
  // =========================================================================
  describe("handleStatus", () => {
    it("should dispatch ADD_MESSAGE for regular status", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "status",
        message: "Processing...",
        isCompaction: false,
        preTokens: 0,
        postTokens: 0,
      };

      handleStatus(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_MESSAGE",
          payload: expect.objectContaining({
            role: "system",
            content: "Processing...",
            variant: "status",
          }),
        })
      );
    });

    it("should dispatch START_COMPACTION when message contains 'Compacting'", () => {
      const ctx = createMockContext({
        getSessionInfo: () => ({ totalContext: 100000 }),
      });
      const event: NormalizedEvent = {
        type: "status",
        message: "Compacting conversation...",
        isCompaction: false,
        preTokens: 0,
        postTokens: 0,
      };

      handleStatus(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "START_COMPACTION",
          payload: expect.objectContaining({
            preTokens: 100000,
          }),
        })
      );
    });

    it("should dispatch COMPLETE_COMPACTION for compaction complete event", () => {
      const ctx = createMockContext({
        getCompactionPreTokens: () => 100000,
        getSessionInfo: () => ({ baseContext: 20000 }),
      });
      const event: NormalizedEvent = {
        type: "status",
        message: "Compaction complete",
        isCompaction: true,
        preTokens: 0,
        postTokens: 30000,
      };

      handleStatus(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "COMPLETE_COMPACTION",
          payload: {
            preTokens: 100000,
            postTokens: 30000,
            baseContext: 20000,
          },
        })
      );
    });

    it("should do nothing when message is empty", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "status",
        message: "",
        isCompaction: false,
        preTokens: 0,
        postTokens: 0,
      };

      handleStatus(event, ctx);

      expect(ctx.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("handleReady", () => {
    it("should dispatch SET_SESSION_ACTIVE and UPDATE_SESSION_INFO", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "ready",
        sessionId: "sess-123",
        model: "claude-3",
        tools: 0,
      };

      handleReady(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_SESSION_ACTIVE",
        payload: true,
      });
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION_INFO",
        payload: { sessionId: "sess-123", model: "claude-3" },
      });
    });

    it("should dispatch SET_LAUNCH_SESSION_ID on first ready", () => {
      const ctx = createMockContext({
        getLaunchSessionId: () => null,
      });
      const event: NormalizedEvent = {
        type: "ready",
        sessionId: "sess-123",
        model: undefined,
        tools: 0,
      };

      handleReady(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_LAUNCH_SESSION_ID",
        payload: "sess-123",
      });
    });

    it("should not set launch session ID if already set", () => {
      const ctx = createMockContext({
        getLaunchSessionId: () => "existing-session",
      });
      const event: NormalizedEvent = {
        type: "ready",
        sessionId: "new-session",
        model: undefined,
        tools: 0,
      };

      handleReady(event, ctx);

      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_LAUNCH_SESSION_ID" })
      );
    });

    it("should support camelCase sessionId from JS bridge", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "ready",
        sessionId: "sess-456",
        model: "claude-4",
        tools: 0,
      };

      handleReady(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION_INFO",
        payload: { sessionId: "sess-456", model: "claude-4" },
      });
    });
  });

  describe("handleClosed", () => {
    it("should dispatch SET_SESSION_ACTIVE false and SET_SESSION_ERROR", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = { type: "closed", code: 1 };

      handleClosed(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_SESSION_ACTIVE",
        payload: false,
      });
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_SESSION_ERROR",
        payload: "Session closed (code 1)",
      });
    });
  });

  describe("handleError", () => {
    it("should dispatch SET_SESSION_ERROR and FINISH_STREAMING", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "error",
        message: "Something went wrong",
      };

      handleError(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_SESSION_ERROR",
        payload: "Something went wrong",
      });
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "FINISH_STREAMING" })
      );
    });
  });

  // =========================================================================
  // Text & Thinking Handlers
  // =========================================================================
  describe("handleThinkingStart", () => {
    it("should dispatch SET_STREAMING_THINKING with empty string", () => {
      const ctx = createMockContext();

      handleThinkingStart(ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_STREAMING_THINKING",
        payload: "",
      });
    });
  });

  describe("handleThinkingDelta", () => {
    it("should dispatch APPEND_STREAMING_THINKING with thinking text", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "thinking_delta",
        thinking: "Let me think...",
      };

      handleThinkingDelta(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "APPEND_STREAMING_THINKING",
        payload: "Let me think...",
      });
    });
  });

  describe("handleTextDelta", () => {
    it("should dispatch APPEND_STREAMING_CONTENT with text", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "text_delta",
        text: "Hello, world!",
      };

      handleTextDelta(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "APPEND_STREAMING_CONTENT",
        payload: "Hello, world!",
      });
    });

    it("should detect and dispatch SET_PLAN_FILE_PATH from text", () => {
      const ctx = createMockContext({
        getPlanFilePath: () => null,
      });
      const event: NormalizedEvent = {
        type: "text_delta",
        text: "I've written the plan file /path/to/plan.md for you.",
      };

      handleTextDelta(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_PLAN_FILE_PATH",
        payload: "/path/to/plan.md",
      });
    });

    it("should not set plan file path if already set", () => {
      const ctx = createMockContext({
        getPlanFilePath: () => "/existing/plan.md",
      });
      const event: NormalizedEvent = {
        type: "text_delta",
        text: "plan file /new/plan.md",
      };

      handleTextDelta(event, ctx);

      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "SET_PLAN_FILE_PATH" })
      );
    });
  });

  // =========================================================================
  // Tool Handlers
  // =========================================================================
  describe("handleToolStart", () => {
    it("should dispatch ADD_TOOL for regular tools", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "tool_start",
        id: "tool-123",
        name: "Read",
      };

      handleToolStart(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "ADD_TOOL",
        payload: expect.objectContaining({
          id: "tool-123",
          name: "Read",
          isLoading: true,
        }),
      });
    });

    it("should set up TodoWrite collection", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "tool_start",
        id: "todo-123",
        name: "TodoWrite",
      };

      handleToolStart(event, ctx);

      expect(ctx.refs.isCollectingTodoRef.current).toBe(true);
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_TODO_PANEL_VISIBLE",
        payload: true,
      });
    });

    it("should skip AskUserQuestion (handled via control protocol)", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "tool_start",
        id: "question-123",
        name: "AskUserQuestion",
      };

      handleToolStart(event, ctx);

      // AskUserQuestion is now handled via control protocol, not tool stream
      // It should return early without dispatching or adding a tool
      expect(ctx.dispatch).not.toHaveBeenCalled();
    });

    it("should dispatch SET_PLANNING_ACTIVE for EnterPlanMode", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "tool_start",
        id: "plan-123",
        name: "EnterPlanMode",
      };

      handleToolStart(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_PLANNING_ACTIVE",
        payload: true,
      });
    });

    it("should return early for ExitPlanMode without dispatching (handled via permission_request)", () => {
      const ctx = createMockContext({
        getPlanningToolId: () => "planning-123",
      });
      const event: NormalizedEvent = {
        type: "tool_start",
        id: "exit-plan-123",
        name: "ExitPlanMode",
      };

      handleToolStart(event, ctx);

      // ExitPlanMode is handled via permission_request, not tool_start
      // Should return early without dispatching anything
      expect(ctx.dispatch).not.toHaveBeenCalled();
    });

    it("should apply pending result if tool_result arrived first", () => {
      const ctx = createMockContext();
      ctx.refs.pendingResultsRef.current.set("tool-123", {
        result: "file content",
        isError: false,
      });

      const event: NormalizedEvent = {
        type: "tool_start",
        id: "tool-123",
        name: "Read",
      };

      handleToolStart(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "ADD_TOOL",
        payload: expect.objectContaining({
          id: "tool-123",
          isLoading: false,
          result: "file content",
        }),
      });
      expect(ctx.refs.pendingResultsRef.current.has("tool-123")).toBe(false);
    });
  });

  describe("handleToolInput", () => {
    it("should dispatch UPDATE_LAST_TOOL_INPUT for regular tool", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "tool_input",
        json: '{"file_path": "/test.txt"}',
      };

      handleToolInput(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_LAST_TOOL_INPUT",
        payload: expect.objectContaining({ file_path: "/test.txt" }),
      });
    });

    it("should collect todo JSON and dispatch SET_TODOS", () => {
      const ctx = createMockContext();
      ctx.refs.isCollectingTodoRef.current = true;

      const event: NormalizedEvent = {
        type: "tool_input",
        json: '{"todos": [{"content": "Task 1", "status": "pending"}]}',
      };

      handleToolInput(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_TODOS",
        payload: [{ content: "Task 1", status: "pending" }],
      });
    });

    // Note: AskUserQuestion is now handled via control protocol (ask_user_question event)
    // rather than via tool_input JSON collection
  });

  describe("handleToolResult", () => {
    it("should dispatch UPDATE_TOOL with result", () => {
      const tool: ToolUse = { id: "tool-123", name: "Read", input: {} };
      const ctx = createMockContext({
        getCurrentToolUses: () => [tool],
      });
      const event: NormalizedEvent = {
        type: "tool_result",
        toolUseId: "tool-123",
        stdout: "file content",
        stderr: "",
        isError: false,
      };

      handleToolResult(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_TOOL",
        payload: {
          id: "tool-123",
          updates: { result: "file content", isLoading: false },
        },
      });
    });

    it("should store pending result when tool does not exist", () => {
      const ctx = createMockContext({
        getCurrentToolUses: () => [],
      });
      const event: NormalizedEvent = {
        type: "tool_result",
        toolUseId: "tool-123",
        stdout: "early result",
        stderr: "",
        isError: false,
      };

      handleToolResult(event, ctx);

      expect(ctx.refs.pendingResultsRef.current.get("tool-123")).toEqual({
        result: "early result",
        isError: false,
      });
      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "UPDATE_TOOL" })
      );
    });

    it("should skip duplicate events without tool_use_id", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "tool_result",
        toolUseId: undefined,
        stdout: "duplicate content",
        stderr: "",
        isError: false,
      };

      handleToolResult(event, ctx);

      expect(ctx.dispatch).not.toHaveBeenCalled();
    });

    it("should set plan content when Read tool reads plan file", () => {
      const tool: ToolUse = {
        id: "tool-123",
        name: "Read",
        input: { file_path: "/path/to/plan.md" },
      };
      const ctx = createMockContext({
        getCurrentToolUses: () => [tool],
        getPlanFilePath: () => "/path/to/plan.md",
      });
      const event: NormalizedEvent = {
        type: "tool_result",
        toolUseId: "tool-123",
        stdout: "# Plan content",
        stderr: "",
        isError: false,
      };

      handleToolResult(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_PLAN_CONTENT",
        payload: "# Plan content",
      });
    });
  });

  // =========================================================================
  // Permission Handler
  // =========================================================================
  describe("handlePermissionRequest", () => {
    it("should dispatch ENQUEUE_PERMISSION in request mode", () => {
      const ctx = createMockContext({
        getCurrentMode: () => "request",
      });
      const event: NormalizedEvent = {
        type: "permission_request",
        requestId: "req-123",
        toolName: "Bash",
        toolInput: { command: "ls" },
        description: "Run command",
      };

      handlePermissionRequest(event as Parameters<typeof handlePermissionRequest>[0], ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "ENQUEUE_PERMISSION",
        payload: expect.objectContaining({
          requestId: "req-123",
          toolName: "Bash",
          description: "Run command",
        }),
      });
    });

    it("should auto-accept in auto mode", () => {
      const ctx = createMockContext({
        getCurrentMode: () => "auto",
      });
      const event: NormalizedEvent = {
        type: "permission_request",
        requestId: "req-123",
        toolName: "Bash",
        toolInput: undefined,
        description: "",
      };

      handlePermissionRequest(event as Parameters<typeof handlePermissionRequest>[0], ctx);

      expect(ctx.sendPermissionResponse).toHaveBeenCalledWith(
        "req-123",
        true,
        false,
        undefined
      );
      expect(ctx.dispatch).not.toHaveBeenCalled();
    });

    it("should route ExitPlanMode to plan approval flow (not auto-accept)", () => {
      const ctx = createMockContext({
        getCurrentMode: () => "auto",
        getPlanningToolId: () => "planning-123",
      });
      const event: NormalizedEvent = {
        type: "permission_request",
        requestId: "exit-req-123",
        toolName: "ExitPlanMode",
        toolInput: { plan: "Test plan" },
        description: "",
      };

      handlePermissionRequest(event as Parameters<typeof handlePermissionRequest>[0], ctx);

      // Should NOT auto-accept - ExitPlanMode requires user approval
      expect(ctx.sendPermissionResponse).not.toHaveBeenCalled();
      // Should dispatch plan approval actions
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_PLAN_PERMISSION_REQUEST_ID",
        payload: "exit-req-123",
      });
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "SET_PLAN_READY",
        payload: true,
      });
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_TOOL",
        payload: { id: "planning-123", updates: { isLoading: false } },
      });
    });
  });

  // =========================================================================
  // Subagent Handlers
  // =========================================================================
  describe("handleSubagentStart", () => {
    it("should dispatch UPDATE_TOOL_SUBAGENT with subagent info", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "subagent_start",
        id: "task-123",
        agentType: "Explore",
        description: "Finding files",
      };

      handleSubagentStart(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_TOOL_SUBAGENT",
        payload: {
          id: "task-123",
          subagent: expect.objectContaining({
            agentType: "Explore",
            description: "Finding files",
            status: "running",
          }),
        },
      });
    });
  });

  describe("handleSubagentProgress", () => {
    it("should dispatch UPDATE_TOOL_SUBAGENT with nested tool", () => {
      const tool: ToolUse = {
        id: "task-123",
        name: "Task",
        input: {},
        subagent: {
          agentType: "Explore",
          description: "Finding files",
          status: "running",
          startTime: Date.now(),
          nestedTools: [],
        },
      };
      const ctx = createMockContext({
        getCurrentToolUses: () => [tool],
      });
      const event: NormalizedEvent = {
        type: "subagent_progress",
        subagentId: "task-123",
        toolName: "Glob",
        toolDetail: "**/*.ts",
        toolCount: 1,
      };

      handleSubagentProgress(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_TOOL_SUBAGENT",
        payload: {
          id: "task-123",
          subagent: {
            nestedTools: [{ name: "Glob", input: "**/*.ts" }],
          },
        },
      });
    });
  });

  describe("handleSubagentEnd", () => {
    it("should dispatch UPDATE_TOOL_SUBAGENT with completion info", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "subagent_end",
        id: "task-123",
        agentType: "Explore",
        duration: 5000,
        toolCount: 10,
        result: "",
      };

      handleSubagentEnd(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_TOOL_SUBAGENT",
        payload: {
          id: "task-123",
          subagent: {
            status: "complete",
            duration: 5000,
            toolCount: 10,
          },
        },
      });
    });
  });

  describe("background task handlers", () => {
    it("should not attach bg_task_registered to original Task tool cards", () => {
      const ctx = createMockContext();

      handleBgTaskRegistered(
        {
          type: "bg_task_registered",
          taskId: "task-123",
          toolUseId: "tool-123",
          agentType: "Explore",
          description: "Investigate",
        },
        ctx
      );

      expect(ctx.dispatch).not.toHaveBeenCalled();
    });

    it("should keep bg_task_completed in task output message without queueing tool updates", () => {
      const ctx = createMockContext();

      handleBgTaskCompleted(
        {
          type: "bg_task_completed",
          taskId: "task-xyz",
          toolUseId: undefined,
          agentType: "Plan",
          duration: 2000,
          toolCount: 2,
          summary: "Summary",
        },
        ctx
      );

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "ADD_MESSAGE",
        payload: {
          id: "bg-result-task-xyz",
          role: "assistant",
          content: "Local agent: xyz\nCompleted: Pending results\n\nSummary",
          variant: "background_task_running",
        },
      });
    });

    it("should always surface a completion message for bg_task_completed", () => {
      const ctx = createMockContext();

      handleBgTaskCompleted(
        {
          type: "bg_task_completed",
          taskId: "task-msg",
          toolUseId: undefined,
          agentType: "Bash",
          duration: 1000,
          toolCount: 1,
          summary: "Agent completed",
        },
        ctx
      );

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "ADD_MESSAGE",
        payload: {
          id: "bg-result-task-msg",
          role: "assistant",
          content: "Local agent: msg\nCompleted: Pending results\n\nAgent completed",
          variant: "background_task_running",
        },
      });
    });

    it("should keep bg_task_result text in task output message while completing original task card", () => {
      const ctx = createMockContext();
      ctx.refs.bgTaskToToolUseIdRef?.current.set("task-abc", "tool-abc");

      handleBgTaskResult(
        {
          type: "bg_task_result",
          taskId: "task-abc",
          toolUseId: undefined,
          result: "Final report",
          status: "completed",
          agentType: "Explore",
          duration: 9000,
          toolCount: 8,
        },
        ctx
      );

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "ADD_MESSAGE",
        payload: {
          id: "bg-result-task-abc",
          role: "assistant",
          content: "Local agent: abc\nCompleted: Success\n\nFinal report",
          variant: "background_task_complete",
        },
      });
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_TOOL_SUBAGENT",
          payload: expect.objectContaining({
            id: "tool-abc",
            subagent: expect.objectContaining({
              status: "complete",
              duration: 9000,
              toolCount: 8,
            }),
          }),
        })
      );
      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_TOOL",
          payload: expect.objectContaining({
            updates: expect.objectContaining({
              result: expect.anything(),
            }),
          }),
        })
      );
    });

    it("should mark original task card complete on bg_task_completed when toolUseId is present", () => {
      const ctx = createMockContext();

      handleBgTaskCompleted(
        {
          type: "bg_task_completed",
          taskId: "task-777",
          toolUseId: "tool-777",
          agentType: "Explore",
          duration: 1500,
          toolCount: 3,
          summary: "Summary",
        },
        ctx
      );

      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_TOOL_SUBAGENT",
          payload: expect.objectContaining({
            id: "tool-777",
            subagent: expect.objectContaining({
              status: "complete",
              duration: 1500,
              toolCount: 3,
            }),
          }),
        })
      );
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_TOOL",
          payload: expect.objectContaining({
            id: "tool-777",
            updates: expect.objectContaining({
              isLoading: false,
            }),
          }),
        })
      );
      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_TOOL",
          payload: expect.objectContaining({
            updates: expect.objectContaining({
              result: expect.anything(),
            }),
          }),
        })
      );
    });

    it("should merge completion/result into one task output when correlated by toolUseId", () => {
      const ctx = createMockContext();

      handleBgTaskCompleted(
        {
          type: "bg_task_completed",
          taskId: "task-merge-a",
          toolUseId: "tool-merge-1",
          agentType: "Explore",
          duration: 1000,
          toolCount: 1,
          summary: "Background summary",
        },
        ctx
      );

      (ctx.dispatch as ReturnType<typeof vi.fn>).mockClear();

      // Final result arrives with different/missing taskId but same toolUseId.
      handleBgTaskResult(
        {
          type: "bg_task_result",
          taskId: "",
          toolUseId: "tool-merge-1",
          result: "Background final",
          status: "completed",
          agentType: "Explore",
          duration: 2200,
          toolCount: 3,
        },
        ctx
      );

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_MESSAGE",
        payload: {
          id: "bg-result-task-merge-a",
          updates: {
            content: "Local agent: mergea\nCompleted: Success\n\nBackground final",
            variant: "background_task_complete",
          },
        },
      });
    });

    it("should track pending background output lock until final result arrives", () => {
      const ctx = createMockContext();

      handleBgTaskCompleted(
        {
          type: "bg_task_completed",
          taskId: "task-lock-1",
          toolUseId: "tool-lock-1",
          agentType: "Explore",
          duration: 1000,
          toolCount: 1,
          summary: "In progress",
        },
        ctx
      );

      expect(ctx.refs.bgPendingFinalTaskKeysRef?.current.has("task-lock-1")).toBe(true);

      handleBgTaskResult(
        {
          type: "bg_task_result",
          taskId: "",
          toolUseId: "tool-lock-1",
          result: "Done",
          status: "completed",
          agentType: "Explore",
          duration: 2400,
          toolCount: 2,
        },
        ctx
      );

      expect(ctx.refs.bgPendingFinalTaskKeysRef?.current.has("task-lock-1")).toBe(false);
    });

    it("should ignore late completion summary after final bg_task_result", () => {
      const ctx = createMockContext();

      handleBgTaskResult(
        {
          type: "bg_task_result",
          taskId: "task-late",
          toolUseId: undefined,
          result: "Final output",
          status: "completed",
          agentType: "Explore",
          duration: 1200,
          toolCount: 2,
        },
        ctx
      );

      (ctx.dispatch as ReturnType<typeof vi.fn>).mockClear();

      handleBgTaskCompleted(
        {
          type: "bg_task_completed",
          taskId: "task-late",
          toolUseId: undefined,
          agentType: "Explore",
          duration: 1400,
          toolCount: 2,
          summary: "Completed summary",
        },
        ctx
      );

      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_MESSAGE",
          payload: expect.objectContaining({ id: "bg-result-task-late" }),
        })
      );
      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ADD_MESSAGE",
          payload: expect.objectContaining({ id: "bg-result-task-late" }),
        })
      );
      expect(ctx.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "UPDATE_TOOL",
          payload: expect.objectContaining({
            updates: expect.objectContaining({ result: "Completed summary" }),
          }),
        })
      );
    });

    it("should keep one final background message per task across 5 interleaved tasks", () => {
      const ctx = createMockContext();
      const taskIds = ["task-a", "task-b", "task-c", "task-d", "task-e"];

      for (const taskId of taskIds) {
        handleBgTaskCompleted(
          {
            type: "bg_task_completed",
            taskId,
            toolUseId: undefined,
            agentType: "Explore",
            duration: 1000,
            toolCount: 1,
            summary: `Completed ${taskId}`,
          },
          ctx
        );
      }

      const resultOrder = ["task-c", "task-a", "task-e", "task-b", "task-d"];
      for (const taskId of resultOrder) {
        handleBgTaskResult(
          {
            type: "bg_task_result",
            taskId,
            toolUseId: undefined,
            result: `Final ${taskId}`,
            status: "completed",
            agentType: "Explore",
            duration: 2000,
            toolCount: 3,
          },
          ctx
        );
      }

      const calls = (ctx.dispatch as ReturnType<typeof vi.fn>).mock.calls
        .map(([action]) => action)
        .filter(
          (action) =>
            action &&
            (action.type === "ADD_MESSAGE" || action.type === "UPDATE_MESSAGE") &&
            action.payload?.id?.startsWith("bg-result-")
        );

      for (const taskId of taskIds) {
        const taskMessageId = `bg-result-${taskId}`;
        const taskActions = calls.filter((action) => action.payload.id === taskMessageId);
        expect(taskActions.length).toBeGreaterThan(0);

        const lastTaskAction = taskActions[taskActions.length - 1];
        const content =
          lastTaskAction.type === "ADD_MESSAGE"
            ? lastTaskAction.payload.content
            : lastTaskAction.payload.updates.content;
        const variant =
          lastTaskAction.type === "ADD_MESSAGE"
            ? lastTaskAction.payload.variant
            : lastTaskAction.payload.updates.variant;
        expect(content).toContain(`Final ${taskId}`);
        expect(variant).toBe("background_task_complete");
      }
    });
  });

  // =========================================================================
  // Result Handlers
  // =========================================================================
  describe("handleResult", () => {
    it("should dispatch UPDATE_SESSION_INFO and FINISH_STREAMING", () => {
      const ctx = createMockContext({
        getSessionInfo: () => ({ totalContext: 1000, outputTokens: 500 }),
      });
      const event: NormalizedEvent = {
        type: "result",
        content: undefined,
        cost: undefined,
        duration: undefined,
        turns: undefined,
        inputTokens: 0,
        outputTokens: 200,
        cacheRead: 0,
        cacheWrite: 0,
      };

      handleResult(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION_INFO",
        payload: {
          totalContext: 1200, // 1000 + 200
          outputTokens: 700, // 500 + 200
        },
      });
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "FINISH_STREAMING" })
      );
    });
  });

  describe("handleDone", () => {
    it("should dispatch FINISH_STREAMING", () => {
      const ctx = createMockContext();

      handleDone(ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "FINISH_STREAMING" })
      );
    });
  });

  describe("handleContextUpdate", () => {
    it("should dispatch UPDATE_SESSION_INFO with context info", () => {
      const ctx = createMockContext({
        getSessionInfo: () => ({ baseContext: 1000 }),
      });
      const event: NormalizedEvent = {
        type: "context_update",
        inputTokens: 5000,
        rawInputTokens: 0,
        cacheRead: 3000,
        cacheWrite: 0,
      };

      handleContextUpdate(event, ctx);

      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: "UPDATE_SESSION_INFO",
        payload: {
          totalContext: 5000,
          baseContext: 3000, // max(1000, 3000)
        },
      });
    });

    it("should do nothing when input_tokens is 0", () => {
      const ctx = createMockContext();
      const event: NormalizedEvent = {
        type: "context_update",
        inputTokens: 0,
        rawInputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };

      handleContextUpdate(event, ctx);

      expect(ctx.dispatch).not.toHaveBeenCalled();
    });
  });
});
