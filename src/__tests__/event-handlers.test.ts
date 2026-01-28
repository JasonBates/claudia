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
import type {
  NormalizedEvent,
  NormalizedStatusEvent,
  NormalizedReadyEvent,
  NormalizedThinkingDeltaEvent,
  NormalizedTextDeltaEvent,
  NormalizedToolStartEvent,
  NormalizedToolInputEvent,
  NormalizedToolResultEvent,
  NormalizedContextUpdateEvent,
  NormalizedResultEvent,
  NormalizedClosedEvent,
  NormalizedErrorEvent,
} from "../lib/claude-event-normalizer";

/**
 * Create mock dependencies for testing event handlers.
 * All setters are mocked with vi.fn() that also updates a state object.
 *
 * NOTE: Tests now use NORMALIZED events (camelCase only, no dual fields).
 * The normalization layer is tested separately in claude-event-normalizer.test.ts.
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

    // Permission handling
    getCurrentMode: () => "plan" as const,
    sendPermissionResponse: vi.fn().mockResolvedValue(undefined),
  };
}

describe("handleStatusEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should ignore events without message", () => {
    const event: NormalizedStatusEvent = {
      type: "status",
      message: "",
      isCompaction: false,
      preTokens: 0,
      postTokens: 0,
    };
    handleStatusEvent(event, deps);
    expect(deps.setMessages).not.toHaveBeenCalled();
  });

  it("should handle compaction start", () => {
    deps.state.sessionInfo = { totalContext: 150000 };
    const event: NormalizedStatusEvent = {
      type: "status",
      message: "Compacting conversation...",
      isCompaction: false,
      preTokens: 0,
      postTokens: 0,
    };
    handleStatusEvent(event, deps);

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

    const event: NormalizedStatusEvent = {
      type: "status",
      message: "Compaction complete",
      isCompaction: true,
      preTokens: 0,
      postTokens: 15000,
    };
    handleStatusEvent(event, deps);

    expect(deps.setSessionInfo).toHaveBeenCalled();
    expect(deps.setLastCompactionPreTokens).toHaveBeenCalledWith(null);
    expect(deps.setCompactionMessageId).toHaveBeenCalledWith(null);
    expect(deps.setWarningDismissed).toHaveBeenCalledWith(false);
  });

  it("should add regular status messages", () => {
    const event: NormalizedStatusEvent = {
      type: "status",
      message: "Processing...",
      isCompaction: false,
      preTokens: 0,
      postTokens: 0,
    };
    handleStatusEvent(event, deps);

    expect(deps.setMessages).toHaveBeenCalled();
    const messages = deps.state.messages as { variant?: string; content?: string }[];
    expect(messages[0].variant).toBe("status");
    expect(messages[0].content).toBe("Processing...");
  });
});

describe("handleReadyEvent", () => {
  it("should set session active and update model info", () => {
    const deps = createMockDeps();
    const event: NormalizedReadyEvent = {
      type: "ready",
      sessionId: undefined,
      model: "claude-opus-4-5-20250514",
      tools: 50,
    };

    handleReadyEvent(event, deps);

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

    const event: NormalizedReadyEvent = {
      type: "ready",
      sessionId: undefined,
      model: "claude-sonnet-4-20250514",
      tools: 50,
    };
    handleReadyEvent(event, deps);

    expect(deps.state.sessionInfo).toEqual({
      sessionId: undefined,
      model: "claude-sonnet-4-20250514",
      totalContext: 5000,
    });
  });

  it("should capture sessionId in sessionInfo", () => {
    const deps = createMockDeps();
    const event: NormalizedReadyEvent = {
      type: "ready",
      sessionId: "sess-abc123",
      model: "claude-sonnet-4",
      tools: 50,
    };

    handleReadyEvent(event, deps);

    expect(deps.state.sessionInfo).toEqual({
      sessionId: "sess-abc123",
      model: "claude-sonnet-4",
      totalContext: 0,
    });
  });

  it("should set launchSessionId on first ready event", () => {
    const deps = createMockDeps();
    expect(deps.state.launchSessionId).toBeNull();

    const event: NormalizedReadyEvent = {
      type: "ready",
      sessionId: "sess-first",
      model: "claude-sonnet-4",
      tools: 50,
    };
    handleReadyEvent(event, deps);

    expect(deps.state.launchSessionId).toBe("sess-first");
  });

  it("should NOT overwrite launchSessionId on subsequent ready events", () => {
    const deps = createMockDeps();
    deps.state.launchSessionId = "sess-original";

    const event: NormalizedReadyEvent = {
      type: "ready",
      sessionId: "sess-resumed",
      model: "claude-sonnet-4",
      tools: 50,
    };
    handleReadyEvent(event, deps);

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

    const event1: NormalizedThinkingDeltaEvent = { type: "thinking_delta", thinking: "Let me " };
    const event2: NormalizedThinkingDeltaEvent = { type: "thinking_delta", thinking: "think..." };
    handleThinkingDeltaEvent(event1, deps);
    handleThinkingDeltaEvent(event2, deps);

    expect(deps.state.streamingThinking).toBe("Let me think...");
  });

  it("should add thinking to streaming blocks", () => {
    const deps = createMockDeps();

    const event1: NormalizedThinkingDeltaEvent = { type: "thinking_delta", thinking: "Considering " };
    const event2: NormalizedThinkingDeltaEvent = { type: "thinking_delta", thinking: "options" };
    handleThinkingDeltaEvent(event1, deps);
    handleThinkingDeltaEvent(event2, deps);

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
    const event1: NormalizedTextDeltaEvent = { type: "text_delta", text: "Hello, " };
    const event2: NormalizedTextDeltaEvent = { type: "text_delta", text: "world!" };
    handleTextDeltaEvent(event1, deps);
    handleTextDeltaEvent(event2, deps);

    expect(deps.state.streamingContent).toBe("Hello, world!");
  });

  it("should add text blocks to streaming blocks", () => {
    const event: NormalizedTextDeltaEvent = { type: "text_delta", text: "Some text" };
    handleTextDeltaEvent(event, deps);

    const blocks = deps.state.streamingBlocks as { type: string }[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "text", content: "Some text" });
  });

  it("should NOT clear tool loading state when text arrives", () => {
    // Tools should remain in loading state until their tool_result event arrives.
    // Text can appear during tool execution (Claude's commentary) or between
    // parallel tool invocations - it doesn't mean tools are done.
    deps.state.currentToolUses = [
      { id: "tool-1", name: "Read", input: {}, isLoading: true },
    ];

    const event: NormalizedTextDeltaEvent = { type: "text_delta", text: "Result: " };
    handleTextDeltaEvent(event, deps);

    const tools = deps.state.currentToolUses as { isLoading: boolean }[];
    expect(tools[0].isLoading).toBe(true); // Should remain loading
  });

  it("should extract plan file path from text", () => {
    const event: NormalizedTextDeltaEvent = {
      type: "text_delta",
      text: "Your plan file is /Users/test/.claude/plans/my-plan.md",
    };
    handleTextDeltaEvent(event, deps);

    expect(deps.state.planFilePath).toBe("/Users/test/.claude/plans/my-plan.md");
  });
});

describe("handleToolStartEvent", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("should handle TodoWrite tool specially", () => {
    const event: NormalizedToolStartEvent = { type: "tool_start", name: "TodoWrite", id: "tw-1" };
    handleToolStartEvent(event, deps);

    expect(deps.isCollectingTodoRef.current).toBe(true);
    expect(deps.todoJsonRef.current).toBe("");
    expect(deps.state.showTodoPanel).toBe(true);
    expect(deps.state.todoPanelHiding).toBe(false);
    // Should NOT add to currentToolUses
    expect(deps.state.currentToolUses).toEqual([]);
  });

  it("should handle AskUserQuestion tool specially", () => {
    const event: NormalizedToolStartEvent = { type: "tool_start", name: "AskUserQuestion", id: "q-1" };
    handleToolStartEvent(event, deps);

    expect(deps.isCollectingQuestionRef.current).toBe(true);
    expect(deps.questionJsonRef.current).toBe("");
  });

  it("should handle EnterPlanMode", () => {
    const event: NormalizedToolStartEvent = { type: "tool_start", name: "EnterPlanMode", id: "pm-1" };
    handleToolStartEvent(event, deps);

    expect(deps.state.isPlanning).toBe(true);
  });

  it("should handle ExitPlanMode", () => {
    const event: NormalizedToolStartEvent = { type: "tool_start", name: "ExitPlanMode", id: "pm-2" };
    handleToolStartEvent(event, deps);

    expect(deps.state.showPlanApproval).toBe(true);
  });

  it("should add regular tools to currentToolUses", () => {
    const event: NormalizedToolStartEvent = { type: "tool_start", name: "Read", id: "read-1" };
    handleToolStartEvent(event, deps);

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

    const event1: NormalizedToolInputEvent = { type: "tool_input", json: '{"todos":[' };
    const event2: NormalizedToolInputEvent = { type: "tool_input", json: '{"content":"task 1","status":"pending"}' };
    const event3: NormalizedToolInputEvent = { type: "tool_input", json: "]}" };
    handleToolInputEvent(event1, deps);
    handleToolInputEvent(event2, deps);
    handleToolInputEvent(event3, deps);

    expect(deps.todoJsonRef.current).toBe('{"todos":[{"content":"task 1","status":"pending"}]}');
  });

  it("should update todos when JSON is complete", () => {
    deps.isCollectingTodoRef.current = true;

    const event: NormalizedToolInputEvent = {
      type: "tool_input",
      json: '{"todos":[{"content":"task","status":"pending","activeForm":"doing task"}]}',
    };
    handleToolInputEvent(event, deps);

    const todos = deps.state.currentTodos as { content: string }[];
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe("task");
  });

  it("should accumulate regular tool input", () => {
    const event1: NormalizedToolInputEvent = { type: "tool_input", json: '{"file_path":' };
    const event2: NormalizedToolInputEvent = { type: "tool_input", json: '"/test.txt"}' };
    handleToolInputEvent(event1, deps);
    handleToolInputEvent(event2, deps);

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

    const event: NormalizedToolResultEvent = {
      type: "tool_result",
      toolUseId: "tw-1",
      stdout: "",
      stderr: "",
      isError: false,
    };
    handleToolResultEvent(event, deps);

    expect(deps.isCollectingTodoRef.current).toBe(false);
  });

  it("should update tool result by ID", () => {
    deps.state.currentToolUses = [
      { id: "t-1", name: "Read", input: {}, isLoading: true },
      { id: "t-2", name: "Write", input: {}, isLoading: true },
    ];

    const event: NormalizedToolResultEvent = {
      type: "tool_result",
      toolUseId: "t-1",
      stdout: "file contents",
      stderr: "",
      isError: false,
    };
    handleToolResultEvent(event, deps);

    const tools = deps.state.currentToolUses as { id: string; result?: string; isLoading: boolean }[];
    expect(tools[0].result).toBe("file contents");
    expect(tools[0].isLoading).toBe(false);
    expect(tools[1].isLoading).toBe(true);
  });

  it("should handle error results", () => {
    deps.state.currentToolUses = [{ id: "t-1", name: "Read", input: {}, isLoading: true }];

    const event: NormalizedToolResultEvent = {
      type: "tool_result",
      toolUseId: "t-1",
      stdout: "",
      stderr: "file not found",
      isError: true,
    };
    handleToolResultEvent(event, deps);

    const tools = deps.state.currentToolUses as { result?: string }[];
    expect(tools[0].result).toBe("Error: file not found");
  });

  it("should update plan content when reading plan file", () => {
    deps.state.planFilePath = "/plans/my-plan.md";
    deps.state.currentToolUses = [
      { id: "t-1", name: "Read", input: { file_path: "/plans/my-plan.md" }, isLoading: true },
    ];

    const event: NormalizedToolResultEvent = {
      type: "tool_result",
      toolUseId: "t-1",
      stdout: "# Plan\n\nSteps...",
      stderr: "",
      isError: false,
    };
    handleToolResultEvent(event, deps);

    expect(deps.state.planContent).toBe("# Plan\n\nSteps...");
  });
});

describe("handleContextUpdateEvent", () => {
  it("should update session info with context tokens", () => {
    const deps = createMockDeps();

    const event: NormalizedContextUpdateEvent = {
      type: "context_update",
      inputTokens: 50000,
      rawInputTokens: 30000,
      cacheRead: 20000,
      cacheWrite: 0,
    };
    handleContextUpdateEvent(event, deps);

    expect(deps.state.sessionInfo).toEqual({
      totalContext: 50000,
      baseContext: 20000,
    });
  });

  it("should track max baseContext seen", () => {
    const deps = createMockDeps();
    deps.state.sessionInfo = { baseContext: 15000 };

    const event: NormalizedContextUpdateEvent = {
      type: "context_update",
      inputTokens: 60000,
      rawInputTokens: 35000,
      cacheRead: 20000,
      cacheWrite: 0,
    };
    handleContextUpdateEvent(event, deps);

    expect((deps.state.sessionInfo as { baseContext: number }).baseContext).toBe(20000);
  });
});

describe("handleResultEvent", () => {
  it("should update token counts and finish streaming", () => {
    const deps = createMockDeps();
    deps.state.sessionInfo = { totalContext: 50000, outputTokens: 1000 };

    const event: NormalizedResultEvent = {
      type: "result",
      content: undefined,
      cost: undefined,
      duration: undefined,
      turns: undefined,
      inputTokens: 0,
      outputTokens: 500,
      cacheRead: 0,
      cacheWrite: 0,
    };
    handleResultEvent(event, deps);

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

    const event: NormalizedClosedEvent = { type: "closed", code: 1 };
    handleClosedEvent(event, deps);

    expect(deps.state.sessionActive).toBe(false);
    expect(deps.state.error).toBe("Session closed (code 1)");
  });
});

describe("handleErrorEvent", () => {
  it("should set error and finish streaming", () => {
    const deps = createMockDeps();

    const event: NormalizedErrorEvent = { type: "error", message: "Connection failed" };
    handleErrorEvent(event, deps);

    expect(deps.state.error).toBe("Connection failed");
    expect(deps.finishStreaming).toHaveBeenCalled();
  });
});

describe("createEventHandler", () => {
  it("should dispatch events to correct handlers", () => {
    const deps = createMockDeps();
    const handler = createEventHandler(deps);

    // Test multiple event types with normalized events
    handler({ type: "ready", sessionId: undefined, model: "test-model", tools: 0 } as NormalizedEvent);
    expect(deps.state.sessionActive).toBe(true);

    handler({ type: "text_delta", text: "Hello" } as NormalizedEvent);
    expect(deps.state.streamingContent).toBe("Hello");

    handler({ type: "done" } as NormalizedEvent);
    expect(deps.finishStreaming).toHaveBeenCalled();
  });

  it("should handle processing and block_end as no-ops", () => {
    const deps = createMockDeps();
    const handler = createEventHandler(deps);

    // These should not throw or have side effects
    handler({ type: "processing", prompt: "" } as NormalizedEvent);
    handler({ type: "block_end" } as NormalizedEvent);

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

      // tool_result arrives BEFORE tool_start (normalized event)
      const event: NormalizedToolResultEvent = {
        type: "tool_result",
        toolUseId: "tool-123",
        stdout: "Result from tool",
        stderr: "",
        isError: false,
      };
      handleToolResultEvent(event, deps);

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
      const resultEvent: NormalizedToolResultEvent = {
        type: "tool_result",
        toolUseId: "tool-123",
        stdout: "Early result",
        stderr: "",
        isError: false,
      };
      handleToolResultEvent(resultEvent, deps);

      expect(deps.pendingResultsRef.current.has("tool-123")).toBe(true);

      // 2. Now tool_start arrives
      const startEvent: NormalizedToolStartEvent = {
        type: "tool_start",
        id: "tool-123",
        name: "Grep",
      };
      handleToolStartEvent(startEvent, deps);

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

      // Error result arrives before tool (isError flag determines error status)
      const event: NormalizedToolResultEvent = {
        type: "tool_result",
        toolUseId: "tool-456",
        stdout: "",
        stderr: "Command failed",
        isError: true,
      };
      handleToolResultEvent(event, deps);

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
      handler({ type: "tool_start", id: "grep-1", name: "Grep" } as NormalizedEvent);
      handler({ type: "tool_start", id: "glob-1", name: "Glob" } as NormalizedEvent);
      handler({ type: "tool_start", id: "read-1", name: "Read" } as NormalizedEvent);

      const tools = deps.state.currentToolUses as { id: string }[];
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.id)).toEqual(["grep-1", "glob-1", "read-1"]);
    });

    it("should handle results arriving out of order", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];
      const handler = createEventHandler(deps);

      // Start 3 tools
      handler({ type: "tool_start", id: "grep-1", name: "Grep" } as NormalizedEvent);
      handler({ type: "tool_start", id: "glob-1", name: "Glob" } as NormalizedEvent);
      handler({ type: "tool_start", id: "read-1", name: "Read" } as NormalizedEvent);

      // Results arrive in different order: glob, read, grep (normalized events)
      handler({ type: "tool_result", toolUseId: "glob-1", stdout: "glob-result", stderr: "", isError: false } as NormalizedEvent);
      handler({ type: "tool_result", toolUseId: "read-1", stdout: "read-result", stderr: "", isError: false } as NormalizedEvent);
      handler({ type: "tool_result", toolUseId: "grep-1", stdout: "grep-result", stderr: "", isError: false } as NormalizedEvent);

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
      handler({ type: "tool_start", id: "tool-1", name: "Grep" } as NormalizedEvent);

      // Tool 2's result arrives BEFORE its start (race condition)
      handler({ type: "tool_result", toolUseId: "tool-2", stdout: "early-result", stderr: "", isError: false } as NormalizedEvent);

      // Tool 1's result arrives normally
      handler({ type: "tool_result", toolUseId: "tool-1", stdout: "normal-result", stderr: "", isError: false } as NormalizedEvent);

      // Now tool 2 starts (should pick up pending result)
      handler({ type: "tool_start", id: "tool-2", name: "Glob" } as NormalizedEvent);

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
      const event1: NormalizedToolResultEvent = {
        type: "tool_result",
        toolUseId: "tool-1",
        stdout: "result-1",
        stderr: "",
        isError: false,
      };
      handleToolResultEvent(event1, deps);

      // Duplicate result (should not break anything)
      const event2: NormalizedToolResultEvent = {
        type: "tool_result",
        toolUseId: "tool-1",
        stdout: "result-2",
        stderr: "",
        isError: false,
      };
      handleToolResultEvent(event2, deps);

      // Should have the second result (last write wins)
      const tool = (deps.state.currentToolUses as { result?: string }[])[0];
      expect(tool.result).toBe("result-2");
    });

    it("should handle result for non-existent tool without toolUseId", () => {
      const deps = createMockDeps();
      deps.state.currentToolUses = [];

      // Result with no toolUseId (edge case)
      const event: NormalizedToolResultEvent = {
        type: "tool_result",
        toolUseId: undefined,
        stdout: "orphan result",
        stderr: "",
        isError: false,
      };
      handleToolResultEvent(event, deps);

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
        handler({ type: "text_delta", text: `chunk${i}` } as NormalizedEvent);
      }

      // All chunks should be concatenated
      const expected = Array.from({ length: 100 }, (_, i) => `chunk${i}`).join("");
      expect(deps.state.streamingContent).toBe(expected);
    });

    it("should handle interleaved text and tool events", () => {
      const deps = createMockDeps();
      const handler = createEventHandler(deps);

      // Realistic interleaved sequence
      handler({ type: "text_delta", text: "I'll search for " } as NormalizedEvent);
      handler({ type: "tool_start", id: "grep-1", name: "Grep" } as NormalizedEvent);
      handler({ type: "tool_input", json: '{"pattern":"test"}' } as NormalizedEvent);
      handler({ type: "tool_pending" } as NormalizedEvent);
      handler({ type: "tool_result", toolUseId: "grep-1", stdout: "found: test.ts", stderr: "", isError: false } as NormalizedEvent);
      handler({ type: "text_delta", text: "Found the file!" } as NormalizedEvent);

      // Text should be accumulated
      expect(deps.state.streamingContent).toBe("I'll search for Found the file!");

      // Tool should have result
      const tools = deps.state.currentToolUses as { id: string; result?: string }[];
      expect(tools.find((t) => t.id === "grep-1")?.result).toBe("found: test.ts");
    });
  });
});
