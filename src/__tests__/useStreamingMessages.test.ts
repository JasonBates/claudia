import { createRoot } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useStreamingMessages,
  UseStreamingMessagesReturn,
} from "../hooks/useStreamingMessages";
import type { ToolUse, ContentBlock } from "../lib/types";

describe("useStreamingMessages", () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    dispose?.();
  });

  const createHook = (onFinish?: () => void) => {
    let hook: UseStreamingMessagesReturn;
    createRoot((d) => {
      dispose = d;
      hook = useStreamingMessages({ onFinish });
    });
    return hook!;
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  describe("initialization", () => {
    it("should start with empty messages", () => {
      const hook = createHook();
      expect(hook.messages()).toEqual([]);
    });

    it("should start with empty streamingContent", () => {
      const hook = createHook();
      expect(hook.streamingContent()).toBe("");
    });

    it("should start with isLoading=false", () => {
      const hook = createHook();
      expect(hook.isLoading()).toBe(false);
    });

    it("should start with null error", () => {
      const hook = createHook();
      expect(hook.error()).toBeNull();
    });

    it("should start with empty currentToolUses", () => {
      const hook = createHook();
      expect(hook.currentToolUses()).toEqual([]);
    });

    it("should start with empty streamingBlocks", () => {
      const hook = createHook();
      expect(hook.streamingBlocks()).toEqual([]);
    });

    it("should start with empty streamingThinking", () => {
      const hook = createHook();
      expect(hook.streamingThinking()).toBe("");
    });

    it("should start with showThinking=false", () => {
      const hook = createHook();
      expect(hook.showThinking()).toBe(false);
    });

    it("should initialize mutable refs correctly", () => {
      const hook = createHook();
      expect(hook.toolInputRef.current).toBe("");
      expect(hook.todoJsonRef.current).toBe("");
      expect(hook.questionJsonRef.current).toBe("");
      expect(hook.isCollectingTodoRef.current).toBe(false);
      expect(hook.isCollectingQuestionRef.current).toBe(false);
      expect(hook.pendingResultsRef.current).toBeInstanceOf(Map);
      expect(hook.pendingResultsRef.current.size).toBe(0);
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe("state management", () => {
    it("should allow setting messages", () => {
      const hook = createHook();
      hook.setMessages([{ id: "1", role: "user", content: "Hello" }]);
      expect(hook.messages()).toHaveLength(1);
    });

    it("should allow setting streamingContent", () => {
      const hook = createHook();
      hook.setStreamingContent("Hello world");
      expect(hook.streamingContent()).toBe("Hello world");
    });

    it("should allow appending to streamingContent", () => {
      const hook = createHook();
      hook.setStreamingContent("Hello");
      hook.setStreamingContent((prev) => prev + " world");
      expect(hook.streamingContent()).toBe("Hello world");
    });

    it("should allow setting isLoading", () => {
      const hook = createHook();
      hook.setIsLoading(true);
      expect(hook.isLoading()).toBe(true);
    });

    it("should allow setting error", () => {
      const hook = createHook();
      hook.setError("Something went wrong");
      expect(hook.error()).toBe("Something went wrong");
    });

    it("should allow setting currentToolUses", () => {
      const hook = createHook();
      const tool: ToolUse = { id: "tool-1", name: "Bash", input: {}, isLoading: true };
      hook.setCurrentToolUses([tool]);
      expect(hook.currentToolUses()).toEqual([tool]);
    });

    it("should allow setting streamingBlocks", () => {
      const hook = createHook();
      const blocks: ContentBlock[] = [
        { type: "text", content: "Hello" },
        { type: "tool_use", tool: { id: "1", name: "Test", input: {}, isLoading: false } },
      ];
      hook.setStreamingBlocks(blocks);
      expect(hook.streamingBlocks()).toEqual(blocks);
    });

    it("should allow toggling showThinking", () => {
      const hook = createHook();
      hook.setShowThinking(true);
      expect(hook.showThinking()).toBe(true);
      hook.setShowThinking(false);
      expect(hook.showThinking()).toBe(false);
    });

    it("should allow modifying mutable refs", () => {
      const hook = createHook();

      hook.toolInputRef.current = "some json";
      hook.todoJsonRef.current = "[{todo}]";
      hook.isCollectingTodoRef.current = true;

      expect(hook.toolInputRef.current).toBe("some json");
      expect(hook.todoJsonRef.current).toBe("[{todo}]");
      expect(hook.isCollectingTodoRef.current).toBe(true);
    });
  });

  // ============================================================================
  // generateId
  // ============================================================================

  describe("generateId", () => {
    it("should generate unique IDs", () => {
      const hook = createHook();

      const id1 = hook.generateId();
      const id2 = hook.generateId();
      const id3 = hook.generateId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("should generate IDs with 'msg-' prefix", () => {
      const hook = createHook();

      const id = hook.generateId();

      expect(id).toMatch(/^msg-\d+$/);
    });

    it("should generate incrementing IDs", () => {
      const hook = createHook();

      const id1 = hook.generateId();
      const id2 = hook.generateId();

      const num1 = parseInt(id1.split("-")[1]);
      const num2 = parseInt(id2.split("-")[1]);

      expect(num2).toBe(num1 + 1);
    });
  });

  // ============================================================================
  // finishStreaming
  // ============================================================================

  describe("finishStreaming", () => {
    it("should add streaming content to messages", () => {
      const hook = createHook();
      hook.setStreamingContent("Hello from Claude");

      hook.finishStreaming();

      expect(hook.messages()).toHaveLength(1);
      expect(hook.messages()[0].content).toBe("Hello from Claude");
      expect(hook.messages()[0].role).toBe("assistant");
    });

    it("should add tool uses to messages", () => {
      const hook = createHook();
      const tool: ToolUse = { id: "tool-1", name: "Bash", input: {}, isLoading: false };
      hook.setCurrentToolUses([tool]);

      hook.finishStreaming();

      expect(hook.messages()[0].toolUses).toEqual([tool]);
    });

    it("should add content blocks to messages", () => {
      const hook = createHook();
      const blocks: ContentBlock[] = [
        { type: "text", content: "Hello" },
        { type: "tool_use", tool: { id: "1", name: "Test", input: {}, isLoading: false } },
      ];
      hook.setStreamingBlocks(blocks);

      hook.finishStreaming();

      expect(hook.messages()[0].contentBlocks).toEqual(blocks);
    });

    it("should set isLoading to false", () => {
      const hook = createHook();
      hook.setIsLoading(true);
      hook.setStreamingContent("test");

      hook.finishStreaming();

      expect(hook.isLoading()).toBe(false);
    });

    it("should clear streamingContent", () => {
      const hook = createHook();
      hook.setStreamingContent("Hello");

      hook.finishStreaming();

      expect(hook.streamingContent()).toBe("");
    });

    it("should clear streamingThinking", () => {
      const hook = createHook();
      hook.setStreamingThinking("I am thinking...");

      hook.finishStreaming();

      expect(hook.streamingThinking()).toBe("");
    });

    it("should clear currentToolUses", () => {
      const hook = createHook();
      hook.setCurrentToolUses([{ id: "1", name: "Test", input: {}, isLoading: true }]);

      hook.finishStreaming();

      expect(hook.currentToolUses()).toEqual([]);
    });

    it("should clear streamingBlocks", () => {
      const hook = createHook();
      hook.setStreamingBlocks([{ type: "text", content: "Hello" }]);

      hook.finishStreaming();

      expect(hook.streamingBlocks()).toEqual([]);
    });

    it("should clear toolInputRef", () => {
      const hook = createHook();
      hook.toolInputRef.current = "some json";

      hook.finishStreaming();

      expect(hook.toolInputRef.current).toBe("");
    });

    it("should NOT add message if no content, tools, or blocks", () => {
      const hook = createHook();
      // All empty - nothing to add

      hook.finishStreaming();

      expect(hook.messages()).toEqual([]);
    });

    it("should call onFinish callback", () => {
      const mockOnFinish = vi.fn();
      const hook = createHook(mockOnFinish);
      hook.setStreamingContent("test");

      hook.finishStreaming();

      expect(mockOnFinish).toHaveBeenCalledTimes(1);
    });

    it("should call onFinish even with no content", () => {
      const mockOnFinish = vi.fn();
      const hook = createHook(mockOnFinish);

      hook.finishStreaming();

      expect(mockOnFinish).toHaveBeenCalledTimes(1);
    });

    it("should generate unique message IDs", () => {
      const hook = createHook();

      hook.setStreamingContent("Message 1");
      hook.finishStreaming();

      hook.setStreamingContent("Message 2");
      hook.finishStreaming();

      const ids = hook.messages().map((m) => m.id);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  // ============================================================================
  // resetStreamingState
  // ============================================================================

  describe("resetStreamingState", () => {
    it("should clear error", () => {
      const hook = createHook();
      hook.setError("Previous error");

      hook.resetStreamingState();

      expect(hook.error()).toBeNull();
    });

    it("should set isLoading to true", () => {
      const hook = createHook();

      hook.resetStreamingState();

      expect(hook.isLoading()).toBe(true);
    });

    it("should clear currentToolUses", () => {
      const hook = createHook();
      hook.setCurrentToolUses([{ id: "1", name: "Test", input: {}, isLoading: true }]);

      hook.resetStreamingState();

      expect(hook.currentToolUses()).toEqual([]);
    });

    it("should clear streamingBlocks", () => {
      const hook = createHook();
      hook.setStreamingBlocks([{ type: "text", content: "Hello" }]);

      hook.resetStreamingState();

      expect(hook.streamingBlocks()).toEqual([]);
    });

    it("should clear streamingContent", () => {
      const hook = createHook();
      hook.setStreamingContent("Previous content");

      hook.resetStreamingState();

      expect(hook.streamingContent()).toBe("");
    });

    it("should clear toolInputRef", () => {
      const hook = createHook();
      hook.toolInputRef.current = "previous json";

      hook.resetStreamingState();

      expect(hook.toolInputRef.current).toBe("");
    });

    it("should NOT clear messages", () => {
      const hook = createHook();
      hook.setMessages([{ id: "1", role: "user", content: "Keep me" }]);

      hook.resetStreamingState();

      expect(hook.messages()).toHaveLength(1);
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe("full workflow", () => {
    it("should handle complete message streaming cycle", () => {
      const mockOnFinish = vi.fn();
      const hook = createHook(mockOnFinish);

      // 1. Start streaming (simulates handleSubmit)
      hook.resetStreamingState();
      expect(hook.isLoading()).toBe(true);

      // 2. Stream text deltas
      hook.setStreamingContent("Hello");
      hook.setStreamingContent((prev) => prev + " world");
      expect(hook.streamingContent()).toBe("Hello world");

      // 3. Add a tool
      hook.setCurrentToolUses([
        { id: "tool-1", name: "Bash", input: { command: "ls" }, isLoading: true },
      ]);
      hook.setStreamingBlocks([
        { type: "text", content: "Hello world" },
        {
          type: "tool_use",
          tool: { id: "tool-1", name: "Bash", input: { command: "ls" }, isLoading: true },
        },
      ]);

      // 4. Tool completes
      hook.setCurrentToolUses((prev) =>
        prev.map((t) => ({ ...t, isLoading: false, result: "file1.txt" }))
      );

      // 5. Finish streaming
      hook.finishStreaming();

      // 6. Verify end state
      expect(hook.isLoading()).toBe(false);
      expect(hook.streamingContent()).toBe("");
      expect(hook.messages()).toHaveLength(1);
      expect(hook.messages()[0].content).toBe("Hello world");
      expect(hook.messages()[0].toolUses).toBeDefined();
      expect(mockOnFinish).toHaveBeenCalled();
    });

    it("should handle multiple message cycles", () => {
      const hook = createHook();

      // First message
      hook.resetStreamingState();
      hook.setStreamingContent("Response 1");
      hook.finishStreaming();

      // Second message
      hook.resetStreamingState();
      hook.setStreamingContent("Response 2");
      hook.finishStreaming();

      expect(hook.messages()).toHaveLength(2);
      expect(hook.messages()[0].content).toBe("Response 1");
      expect(hook.messages()[1].content).toBe("Response 2");
    });

    it("should handle parallel tools correctly", () => {
      const hook = createHook();

      hook.resetStreamingState();

      // Multiple tools start
      hook.setCurrentToolUses([
        { id: "tool-1", name: "Grep", input: {}, isLoading: true },
        { id: "tool-2", name: "Glob", input: {}, isLoading: true },
        { id: "tool-3", name: "Read", input: {}, isLoading: true },
      ]);

      // Results come back in different order
      hook.setCurrentToolUses((prev) =>
        prev.map((t) => (t.id === "tool-2" ? { ...t, isLoading: false, result: "result2" } : t))
      );
      hook.setCurrentToolUses((prev) =>
        prev.map((t) => (t.id === "tool-1" ? { ...t, isLoading: false, result: "result1" } : t))
      );
      hook.setCurrentToolUses((prev) =>
        prev.map((t) => (t.id === "tool-3" ? { ...t, isLoading: false, result: "result3" } : t))
      );

      hook.finishStreaming();

      // All tools should be in the message
      expect(hook.messages()[0].toolUses).toHaveLength(3);
    });
  });
});
