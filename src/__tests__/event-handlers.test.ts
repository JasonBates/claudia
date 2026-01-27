import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleStatusEvent,
  handleReadyEvent,
  handleThinkingStartEvent,
  handleThinkingDeltaEvent,
  handleTextDeltaEvent,
  handleToolStartEvent,
  handleToolInputEvent,
  handleToolPendingEvent,
  handleToolResultEvent,
  handleContextUpdateEvent,
  handleResultEvent,
  handleDoneEvent,
  handleClosedEvent,
  handleErrorEvent,
  createEventHandler,
  type EventHandlerDeps,
} from "../lib/event-handlers";
import type { ClaudeEvent } from "../lib/tauri";

/**
 * Create mock dependencies for testing event handlers.
 * All setters are mocked with vi.fn() that also updates a state object.
 */
function createMockDeps(): EventHandlerDeps & { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {
    messages: [],
    streamingContent: "",
    streamingBlocks: [],
    streamingThinking: "",
    currentToolUses: [],
    currentTodos: [],
    showTodoPanel: false,
    todoPanelHiding: false,
    pendingQuestions: [],
    showQuestionPanel: false,
    isPlanning: false,
    planFilePath: null,
    showPlanApproval: false,
    planContent: "",
    pendingPermission: null,
    sessionActive: false,
    sessionInfo: {},
    error: null,
    isLoading: false,
    lastCompactionPreTokens: null,
    compactionMessageId: null,
    warningDismissed: false,
    launchSessionId: null,
  };

  // Helper to create a setter that updates state
  const createSetter = <T>(key: string) => {
    const setter = vi.fn((update: T | ((prev: T) => T)) => {
      if (typeof update === "function") {
        state[key] = (update as (prev: T) => T)(state[key] as T);
      } else {
        state[key] = update;
      }
    });
    return setter;
  };

  return {
    state,
    setMessages: createSetter("messages"),
    setStreamingContent: createSetter("streamingContent"),
    setStreamingBlocks: createSetter("streamingBlocks"),
    setStreamingThinking: createSetter("streamingThinking"),
    setCurrentToolUses: createSetter("currentToolUses"),
    setCurrentTodos: createSetter("currentTodos"),
    setShowTodoPanel: createSetter("showTodoPanel"),
    setTodoPanelHiding: createSetter("todoPanelHiding"),
    setPendingQuestions: createSetter("pendingQuestions"),
    setShowQuestionPanel: createSetter("showQuestionPanel"),
    setIsPlanning: createSetter("isPlanning"),
    setPlanFilePath: createSetter("planFilePath"),
    setShowPlanApproval: createSetter("showPlanApproval"),
    setPlanContent: createSetter("planContent"),
    setPendingPermission: createSetter("pendingPermission"),
    setSessionActive: createSetter("sessionActive"),
    setSessionInfo: createSetter("sessionInfo"),
    setError: createSetter("error"),
    setIsLoading: createSetter("isLoading"),
    setLastCompactionPreTokens: createSetter("lastCompactionPreTokens"),
    setCompactionMessageId: createSetter("compactionMessageId"),
    setWarningDismissed: createSetter("warningDismissed"),

    // Launch session tracking
    getLaunchSessionId: () => state.launchSessionId as string | null,
    setLaunchSessionId: createSetter("launchSessionId"),

    getSessionInfo: () => state.sessionInfo as ReturnType<EventHandlerDeps["getSessionInfo"]>,
    getCurrentToolUses: () => state.currentToolUses as ReturnType<EventHandlerDeps["getCurrentToolUses"]>,
    getStreamingBlocks: () => state.streamingBlocks as ReturnType<EventHandlerDeps["getStreamingBlocks"]>,
    getPlanFilePath: () => state.planFilePath as string | null,
    getLastCompactionPreTokens: () => state.lastCompactionPreTokens as number | null,
    getCompactionMessageId: () => state.compactionMessageId as string | null,

    toolInputRef: { current: "" },
    todoJsonRef: { current: "" },
    questionJsonRef: { current: "" },
    isCollectingTodoRef: { current: false },
    isCollectingQuestionRef: { current: false },
    pendingResultsRef: { current: new Map<string, { result: string; isError: boolean }>() },

    generateMessageId: vi.fn(() => `msg-${Date.now()}`),
    finishStreaming: vi.fn(),
  };
}

describe("handleStatusEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should ignore events without message", () => {
    handleStatusEvent({ type: "status" } as ClaudeEvent & { type: "status" }, deps);
    expect(deps.setMessages).not.toHaveBeenCalled();
  });

  it("should handle compaction start", () => {
    deps.state.sessionInfo = { totalContext: 150000 };
    handleStatusEvent(
      { type: "status", message: "Compacting conversation..." } as ClaudeEvent & { type: "status" },
      deps
    );

    expect(deps.setLastCompactionPreTokens).toHaveBeenCalledWith(150000);
    expect(deps.setCompactionMessageId).toHaveBeenCalled();
    expect(deps.setMessages).toHaveBeenCalled();

    const messages = deps.state.messages as { variant?: string }[];
    expect(messages[0].variant).toBe("compaction");
  });

  it("should handle compaction completion", () => {
    deps.state.lastCompactionPreTokens = 150000;
    deps.state.compactionMessageId = "comp-123";
    deps.state.sessionInfo = { baseContext: 20000 };
    deps.state.messages = [{ id: "comp-123", role: "system", content: "150k → ...", variant: "compaction" }];

    handleStatusEvent(
      {
        type: "status",
        message: "Compaction complete",
        is_compaction: true,
        post_tokens: 15000,
      } as ClaudeEvent & { type: "status" },
      deps
    );

    expect(deps.setSessionInfo).toHaveBeenCalled();
    expect(deps.setLastCompactionPreTokens).toHaveBeenCalledWith(null);
    expect(deps.setCompactionMessageId).toHaveBeenCalledWith(null);
    expect(deps.setWarningDismissed).toHaveBeenCalledWith(false);
  });

  it("should add regular status messages", () => {
    handleStatusEvent(
      { type: "status", message: "Processing..." } as ClaudeEvent & { type: "status" },
      deps
    );

    expect(deps.setMessages).toHaveBeenCalled();
    const messages = deps.state.messages as { variant?: string; content?: string }[];
    expect(messages[0].variant).toBe("status");
    expect(messages[0].content).toBe("Processing...");
  });
});

describe("handleReadyEvent", () => {
  it("should set session active and update model info", () => {
    const deps = createMockDeps();

    handleReadyEvent(
      { type: "ready", model: "claude-opus-4-5-20250514" } as ClaudeEvent & { type: "ready" },
      deps
    );

    expect(deps.setSessionActive).toHaveBeenCalledWith(true);
    expect(deps.setSessionInfo).toHaveBeenCalled();
    expect(deps.state.sessionInfo).toEqual({
      sessionId: undefined,
      model: "claude-opus-4-5-20250514",
      totalContext: 0,
    });
  });

  it("should preserve existing totalContext", () => {
    const deps = createMockDeps();
    deps.state.sessionInfo = { totalContext: 5000 };

    handleReadyEvent(
      { type: "ready", model: "claude-sonnet-4-20250514" } as ClaudeEvent & { type: "ready" },
      deps
    );

    expect(deps.state.sessionInfo).toEqual({
      sessionId: undefined,
      model: "claude-sonnet-4-20250514",
      totalContext: 5000,
    });
  });

  it("should capture session_id in sessionInfo", () => {
    const deps = createMockDeps();

    handleReadyEvent(
      { type: "ready", model: "claude-sonnet-4", session_id: "sess-abc123" } as ClaudeEvent & { type: "ready" },
      deps
    );

    expect(deps.state.sessionInfo).toEqual({
      sessionId: "sess-abc123",
      model: "claude-sonnet-4",
      totalContext: 0,
    });
  });

  it("should set launchSessionId on first ready event", () => {
    const deps = createMockDeps();
    expect(deps.state.launchSessionId).toBeNull();

    handleReadyEvent(
      { type: "ready", model: "claude-sonnet-4", session_id: "sess-first" } as ClaudeEvent & { type: "ready" },
      deps
    );

    expect(deps.state.launchSessionId).toBe("sess-first");
  });

  it("should NOT overwrite launchSessionId on subsequent ready events", () => {
    const deps = createMockDeps();
    deps.state.launchSessionId = "sess-original";

    handleReadyEvent(
      { type: "ready", model: "claude-sonnet-4", session_id: "sess-resumed" } as ClaudeEvent & { type: "ready" },
      deps
    );

    // launchSessionId should remain the original value
    expect(deps.state.launchSessionId).toBe("sess-original");
    // But sessionInfo should have the new session ID
    expect(deps.state.sessionInfo).toEqual({
      sessionId: "sess-resumed",
      model: "claude-sonnet-4",
      totalContext: 0,
    });
  });
});

describe("handleThinkingEvents", () => {
  it("should reset thinking on start", () => {
    const deps = createMockDeps();
    deps.state.streamingThinking = "previous thinking";

    handleThinkingStartEvent(deps);

    expect(deps.setStreamingThinking).toHaveBeenCalledWith("");
  });

  it("should accumulate thinking deltas", () => {
    const deps = createMockDeps();

    handleThinkingDeltaEvent({ type: "thinking_delta", thinking: "Let me " }, deps);
    handleThinkingDeltaEvent({ type: "thinking_delta", thinking: "think..." }, deps);

    expect(deps.state.streamingThinking).toBe("Let me think...");
  });

  it("should add thinking to streaming blocks", () => {
    const deps = createMockDeps();

    handleThinkingDeltaEvent({ type: "thinking_delta", thinking: "Considering " }, deps);
    handleThinkingDeltaEvent({ type: "thinking_delta", thinking: "options" }, deps);

    const blocks = deps.state.streamingBlocks as { type: string; content: string }[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "thinking", content: "Considering options" });
  });
});

describe("handleTextDeltaEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should accumulate text content", () => {
    handleTextDeltaEvent({ type: "text_delta", text: "Hello, " }, deps);
    handleTextDeltaEvent({ type: "text_delta", text: "world!" }, deps);

    expect(deps.state.streamingContent).toBe("Hello, world!");
  });

  it("should add text blocks to streaming blocks", () => {
    handleTextDeltaEvent({ type: "text_delta", text: "Some text" }, deps);

    const blocks = deps.state.streamingBlocks as { type: string }[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "text", content: "Some text" });
  });

  it("should mark loading tools as completed when text arrives", () => {
    deps.state.currentToolUses = [
      { id: "tool-1", name: "Read", input: {}, isLoading: true },
    ];

    handleTextDeltaEvent({ type: "text_delta", text: "Result: " }, deps);

    const tools = deps.state.currentToolUses as { isLoading: boolean }[];
    expect(tools[0].isLoading).toBe(false);
  });

  it("should extract plan file path from text", () => {
    handleTextDeltaEvent(
      { type: "text_delta", text: "Your plan file is /Users/test/.claude/plans/my-plan.md" },
      deps
    );

    expect(deps.state.planFilePath).toBe("/Users/test/.claude/plans/my-plan.md");
  });
});

describe("handleToolStartEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should handle TodoWrite tool specially", () => {
    handleToolStartEvent({ type: "tool_start", name: "TodoWrite", id: "tw-1" }, deps);

    expect(deps.isCollectingTodoRef.current).toBe(true);
    expect(deps.todoJsonRef.current).toBe("");
    expect(deps.state.showTodoPanel).toBe(true);
    expect(deps.state.todoPanelHiding).toBe(false);
    // Should NOT add to currentToolUses
    expect(deps.state.currentToolUses).toEqual([]);
  });

  it("should handle AskUserQuestion tool specially", () => {
    handleToolStartEvent({ type: "tool_start", name: "AskUserQuestion", id: "q-1" }, deps);

    expect(deps.isCollectingQuestionRef.current).toBe(true);
    expect(deps.questionJsonRef.current).toBe("");
  });

  it("should handle EnterPlanMode", () => {
    handleToolStartEvent({ type: "tool_start", name: "EnterPlanMode", id: "pm-1" }, deps);

    expect(deps.state.isPlanning).toBe(true);
  });

  it("should handle ExitPlanMode", () => {
    handleToolStartEvent({ type: "tool_start", name: "ExitPlanMode", id: "pm-2" }, deps);

    expect(deps.state.showPlanApproval).toBe(true);
  });

  it("should add regular tools to currentToolUses", () => {
    handleToolStartEvent({ type: "tool_start", name: "Read", id: "read-1" }, deps);

    const tools = deps.state.currentToolUses as { name: string; id: string }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("Read");
    expect(tools[0].id).toBe("read-1");
  });
});

describe("handleToolInputEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should accumulate TodoWrite JSON", () => {
    deps.isCollectingTodoRef.current = true;

    handleToolInputEvent({ type: "tool_input", json: '{"todos":[' }, deps);
    handleToolInputEvent({ type: "tool_input", json: '{"content":"task 1","status":"pending"}' }, deps);
    handleToolInputEvent({ type: "tool_input", json: "]}" }, deps);

    expect(deps.todoJsonRef.current).toBe('{"todos":[{"content":"task 1","status":"pending"}]}');
  });

  it("should update todos when JSON is complete", () => {
    deps.isCollectingTodoRef.current = true;

    handleToolInputEvent(
      { type: "tool_input", json: '{"todos":[{"content":"task","status":"pending","activeForm":"doing task"}]}' },
      deps
    );

    const todos = deps.state.currentTodos as { content: string }[];
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe("task");
  });

  it("should accumulate regular tool input", () => {
    handleToolInputEvent({ type: "tool_input", json: '{"file_path":' }, deps);
    handleToolInputEvent({ type: "tool_input", json: '"/test.txt"}' }, deps);

    expect(deps.toolInputRef.current).toBe('{"file_path":"/test.txt"}');
  });
});

describe("handleToolPendingEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should parse tool input and update currentToolUses", () => {
    deps.state.currentToolUses = [{ id: "t-1", name: "Read", input: {}, isLoading: true }];
    deps.toolInputRef.current = '{"file_path":"/test.txt"}';

    handleToolPendingEvent(deps);

    const tools = deps.state.currentToolUses as { input: unknown }[];
    expect(tools[0].input).toEqual({ file_path: "/test.txt" });
  });

  it("should handle invalid JSON gracefully", () => {
    deps.state.currentToolUses = [{ id: "t-1", name: "Read", input: {}, isLoading: true }];
    deps.toolInputRef.current = "not json";

    handleToolPendingEvent(deps);

    const tools = deps.state.currentToolUses as { input: unknown }[];
    expect(tools[0].input).toEqual({ raw: "not json" });
  });

  it("should finalize TodoWrite collection", () => {
    deps.isCollectingTodoRef.current = true;
    deps.todoJsonRef.current = '{"todos":[{"content":"x","status":"pending","activeForm":"doing x"}]}';

    handleToolPendingEvent(deps);

    const todos = deps.state.currentTodos as { content: string }[];
    expect(todos).toHaveLength(1);
  });
});

describe("handleToolResultEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should reset TodoWrite collection flag", () => {
    deps.isCollectingTodoRef.current = true;

    handleToolResultEvent({ type: "tool_result", tool_use_id: "tw-1" } as ClaudeEvent & { type: "tool_result" }, deps);

    expect(deps.isCollectingTodoRef.current).toBe(false);
  });

  it("should update tool result by ID", () => {
    deps.state.currentToolUses = [
      { id: "t-1", name: "Read", input: {}, isLoading: true },
      { id: "t-2", name: "Write", input: {}, isLoading: true },
    ];

    handleToolResultEvent(
      { type: "tool_result", tool_use_id: "t-1", stdout: "file contents" } as ClaudeEvent & { type: "tool_result" },
      deps
    );

    const tools = deps.state.currentToolUses as { id: string; result?: string; isLoading: boolean }[];
    expect(tools[0].result).toBe("file contents");
    expect(tools[0].isLoading).toBe(false);
    expect(tools[1].isLoading).toBe(true);
  });

  it("should handle error results", () => {
    deps.state.currentToolUses = [{ id: "t-1", name: "Read", input: {}, isLoading: true }];

    handleToolResultEvent(
      { type: "tool_result", tool_use_id: "t-1", is_error: true, stderr: "file not found" } as ClaudeEvent & {
        type: "tool_result";
      },
      deps
    );

    const tools = deps.state.currentToolUses as { result?: string }[];
    expect(tools[0].result).toBe("Error: file not found");
  });

  it("should update plan content when reading plan file", () => {
    deps.state.planFilePath = "/plans/my-plan.md";
    deps.state.currentToolUses = [
      { id: "t-1", name: "Read", input: { file_path: "/plans/my-plan.md" }, isLoading: true },
    ];

    handleToolResultEvent(
      { type: "tool_result", tool_use_id: "t-1", stdout: "# Plan\n\nSteps..." } as ClaudeEvent & {
        type: "tool_result";
      },
      deps
    );

    expect(deps.state.planContent).toBe("# Plan\n\nSteps...");
  });
});

describe("handleContextUpdateEvent", () => {
  it("should update session info with context tokens", () => {
    const deps = createMockDeps();

    handleContextUpdateEvent(
      { type: "context_update", input_tokens: 50000, cache_read: 20000, cache_write: 0 },
      deps
    );

    expect(deps.state.sessionInfo).toEqual({
      totalContext: 50000,
      baseContext: 20000,
    });
  });

  it("should track max baseContext seen", () => {
    const deps = createMockDeps();
    deps.state.sessionInfo = { baseContext: 15000 };

    handleContextUpdateEvent(
      { type: "context_update", input_tokens: 60000, cache_read: 20000, cache_write: 0 },
      deps
    );

    expect((deps.state.sessionInfo as { baseContext: number }).baseContext).toBe(20000);
  });
});

describe("handleResultEvent", () => {
  it("should update token counts and finish streaming", () => {
    const deps = createMockDeps();
    deps.state.sessionInfo = { totalContext: 50000, outputTokens: 1000 };

    handleResultEvent({ type: "result", output_tokens: 500 } as ClaudeEvent & { type: "result" }, deps);

    expect(deps.state.sessionInfo).toEqual({
      totalContext: 50500,
      outputTokens: 1500,
    });
    expect(deps.finishStreaming).toHaveBeenCalled();
  });
});

describe("handleDoneEvent", () => {
  it("should call finishStreaming", () => {
    const deps = createMockDeps();

    handleDoneEvent(deps);

    expect(deps.finishStreaming).toHaveBeenCalled();
  });
});

describe("handleClosedEvent", () => {
  it("should mark session inactive and set error", () => {
    const deps = createMockDeps();

    handleClosedEvent({ type: "closed", code: 1 }, deps);

    expect(deps.state.sessionActive).toBe(false);
    expect(deps.state.error).toBe("Session closed (code 1)");
  });
});

describe("handleErrorEvent", () => {
  it("should set error and finish streaming", () => {
    const deps = createMockDeps();

    handleErrorEvent({ type: "error", message: "Connection failed" }, deps);

    expect(deps.state.error).toBe("Connection failed");
    expect(deps.finishStreaming).toHaveBeenCalled();
  });

  it("should use default message for unknown errors", () => {
    const deps = createMockDeps();

    handleErrorEvent({ type: "error" } as ClaudeEvent & { type: "error" }, deps);

    expect(deps.state.error).toBe("Unknown error");
  });
});

describe("createEventHandler", () => {
  it("should dispatch events to correct handlers", () => {
    const deps = createMockDeps();
    const handler = createEventHandler(deps);

    // Test multiple event types
    handler({ type: "ready", model: "test-model" } as ClaudeEvent);
    expect(deps.state.sessionActive).toBe(true);

    handler({ type: "text_delta", text: "Hello" } as ClaudeEvent);
    expect(deps.state.streamingContent).toBe("Hello");

    handler({ type: "done" } as ClaudeEvent);
    expect(deps.finishStreaming).toHaveBeenCalled();
  });

  it("should handle processing and block_end as no-ops", () => {
    const deps = createMockDeps();
    const handler = createEventHandler(deps);

    // These should not throw or have side effects
    handler({ type: "processing" } as ClaudeEvent);
    handler({ type: "block_end" } as ClaudeEvent);

    // Verify no state changes
    expect(deps.state.streamingContent).toBe("");
  });
});

// ============================================================================
// Race Condition Tests
// ============================================================================

describe("race conditions", () => {
  describe("tool_result before tool_start", () => {
    it("should store result in pendingResultsRef when tool does not exist yet", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = []; // No tools yet

      // tool_result arrives BEFORE tool_start
      handleToolResultEvent(
        {
          type: "tool_result",
          tool_use_id: "tool-123",
          stdout: "Result from tool",
        } as ClaudeEvent & { type: "tool_result" },
        deps
      );

      // Result should be stored in pending, not applied to non-existent tool
      expect(deps.pendingResultsRef.current.has("tool-123")).toBe(true);
      expect(deps.pendingResultsRef.current.get("tool-123")).toEqual({
        result: "Result from tool",
        isError: false,
      });

      // Tool uses should not have been updated
      expect(deps.setCurrentToolUses).not.toHaveBeenCalled();
    });

    it("should apply pending result when tool_start arrives later", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];

      // 1. Result arrives first (stored in pending)
      handleToolResultEvent(
        {
          type: "tool_result",
          tool_use_id: "tool-123",
          stdout: "Early result",
        } as ClaudeEvent & { type: "tool_result" },
        deps
      );

      expect(deps.pendingResultsRef.current.has("tool-123")).toBe(true);

      // 2. Now tool_start arrives
      handleToolStartEvent(
        {
          type: "tool_start",
          id: "tool-123",
          name: "Grep",
        } as ClaudeEvent & { type: "tool_start" },
        deps
      );

      // Pending result should be consumed
      expect(deps.pendingResultsRef.current.has("tool-123")).toBe(false);

      // Tool should be created with result already applied
      expect(deps.setCurrentToolUses).toHaveBeenCalled();
      const tool = (deps.state.currentToolUses as { id: string; result?: string; isLoading: boolean }[])[0];
      expect(tool.id).toBe("tool-123");
      expect(tool.result).toBe("Early result");
      expect(tool.isLoading).toBe(false); // Not loading since result is already there
    });

    it("should handle error results in pending", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];

      // Error result arrives before tool (is_error flag determines error status)
      handleToolResultEvent(
        {
          type: "tool_result",
          tool_use_id: "tool-456",
          stderr: "Command failed",
          is_error: true,
        } as ClaudeEvent & { type: "tool_result" },
        deps
      );

      expect(deps.pendingResultsRef.current.get("tool-456")).toEqual({
        result: "Error: Command failed",
        isError: true,
      });
    });
  });

  describe("parallel tool execution", () => {
    it("should handle multiple tools starting in sequence", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];
      const handler = createEventHandler(deps);

      // 3 tools start rapidly
      handler({ type: "tool_start", id: "grep-1", name: "Grep" } as ClaudeEvent);
      handler({ type: "tool_start", id: "glob-1", name: "Glob" } as ClaudeEvent);
      handler({ type: "tool_start", id: "read-1", name: "Read" } as ClaudeEvent);

      const tools = deps.state.currentToolUses as { id: string }[];
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.id)).toEqual(["grep-1", "glob-1", "read-1"]);
    });

    it("should handle results arriving out of order", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];
      const handler = createEventHandler(deps);

      // Start 3 tools
      handler({ type: "tool_start", id: "grep-1", name: "Grep" } as ClaudeEvent);
      handler({ type: "tool_start", id: "glob-1", name: "Glob" } as ClaudeEvent);
      handler({ type: "tool_start", id: "read-1", name: "Read" } as ClaudeEvent);

      // Results arrive in different order: glob, read, grep
      handler({ type: "tool_result", tool_use_id: "glob-1", stdout: "glob-result" } as ClaudeEvent);
      handler({ type: "tool_result", tool_use_id: "read-1", stdout: "read-result" } as ClaudeEvent);
      handler({ type: "tool_result", tool_use_id: "grep-1", stdout: "grep-result" } as ClaudeEvent);

      // All tools should have their correct results
      const tools = deps.state.currentToolUses as { id: string; result?: string; isLoading: boolean }[];
      expect(tools.find((t) => t.id === "grep-1")?.result).toBe("grep-result");
      expect(tools.find((t) => t.id === "glob-1")?.result).toBe("glob-result");
      expect(tools.find((t) => t.id === "read-1")?.result).toBe("read-result");

      // All should be done loading
      expect(tools.every((t) => t.isLoading === false)).toBe(true);
    });

    it("should handle mixed early and normal results", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];
      const handler = createEventHandler(deps);

      // Tool 1 starts
      handler({ type: "tool_start", id: "tool-1", name: "Grep" } as ClaudeEvent);

      // Tool 2's result arrives BEFORE its start (race condition)
      handler({ type: "tool_result", tool_use_id: "tool-2", stdout: "early-result" } as ClaudeEvent);

      // Tool 1's result arrives normally
      handler({ type: "tool_result", tool_use_id: "tool-1", stdout: "normal-result" } as ClaudeEvent);

      // Now tool 2 starts (should pick up pending result)
      handler({ type: "tool_start", id: "tool-2", name: "Glob" } as ClaudeEvent);

      const tools = deps.state.currentToolUses as { id: string; result?: string }[];
      expect(tools.find((t) => t.id === "tool-1")?.result).toBe("normal-result");
      expect(tools.find((t) => t.id === "tool-2")?.result).toBe("early-result");
    });
  });

  describe("duplicate events", () => {
    it("should handle duplicate tool_result events gracefully", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [
        { id: "tool-1", name: "Bash", input: {}, isLoading: true },
      ];

      // First result
      handleToolResultEvent(
        { type: "tool_result", tool_use_id: "tool-1", stdout: "result-1" } as ClaudeEvent & { type: "tool_result" },
        deps
      );

      // Duplicate result (should not break anything)
      handleToolResultEvent(
        { type: "tool_result", tool_use_id: "tool-1", stdout: "result-2" } as ClaudeEvent & { type: "tool_result" },
        deps
      );

      // Should have the second result (last write wins)
      const tool = (deps.state.currentToolUses as { result?: string }[])[0];
      expect(tool.result).toBe("result-2");
    });

    it("should handle result for non-existent tool without tool_use_id", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];

      // Result with no tool_use_id (edge case)
      handleToolResultEvent(
        { type: "tool_result", stdout: "orphan result" } as ClaudeEvent & { type: "tool_result" },
        deps
      );

      // Should not crash, should not store in pending (no ID to store under)
      expect(deps.pendingResultsRef.current.size).toBe(0);
    });
  });

  describe("rapid state transitions", () => {
    it("should handle rapid text_delta events", () => {
      const deps = createMockDeps();
      const handler = createEventHandler(deps);

      // Simulate rapid streaming
      for (let i = 0; i < 100; i++) {
        handler({ type: "text_delta", text: `chunk${i}` } as ClaudeEvent);
      }

      // All chunks should be concatenated
      const expected = Array.from({ length: 100 }, (_, i) => `chunk${i}`).join("");
      expect(deps.state.streamingContent).toBe(expected);
    });

    it("should handle interleaved text and tool events", () => {
      const deps = createMockDeps();
      const handler = createEventHandler(deps);

      // Realistic interleaved sequence
      handler({ type: "text_delta", text: "I'll search for " } as ClaudeEvent);
      handler({ type: "tool_start", id: "grep-1", name: "Grep" } as ClaudeEvent);
      handler({ type: "tool_input", input: '{"pattern":"test"}' } as ClaudeEvent);
      handler({ type: "tool_pending", id: "grep-1" } as ClaudeEvent);
      handler({ type: "tool_result", tool_use_id: "grep-1", stdout: "found: test.ts" } as ClaudeEvent);
      handler({ type: "text_delta", text: "Found the file!" } as ClaudeEvent);

      // Text should be accumulated
      expect(deps.state.streamingContent).toBe("I'll search for Found the file!");

      // Tool should have result
      const tools = deps.state.currentToolUses as { id: string; result?: string }[];
      expect(tools.find((t) => t.id === "grep-1")?.result).toBe("found: test.ts");
    });
  });
});
