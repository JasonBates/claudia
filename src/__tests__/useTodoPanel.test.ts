import { createRoot } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useTodoPanel, UseTodoPanelReturn } from "../hooks/useTodoPanel";
import type { Todo } from "../lib/types";

describe("useTodoPanel", () => {
  let dispose: () => void;

  // Sample todo data
  const sampleTodos: Todo[] = [
    { content: "Fix the bug", status: "completed" },
    { content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
    { content: "Deploy to production", status: "pending" },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    dispose?.();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const createHook = (hideDelay?: number) => {
    let hook: UseTodoPanelReturn;
    createRoot((d) => {
      dispose = d;
      hook = useTodoPanel({
        owner: null, // Null owner works for testing (fallback behavior)
        hideDelay,
      });
    });
    return hook!;
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  describe("initialization", () => {
    it("should start with empty todos", () => {
      const hook = createHook();
      expect(hook.currentTodos()).toEqual([]);
    });

    it("should start with showTodoPanel=false", () => {
      const hook = createHook();
      expect(hook.showTodoPanel()).toBe(false);
    });

    it("should start with todoPanelHiding=false", () => {
      const hook = createHook();
      expect(hook.todoPanelHiding()).toBe(false);
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe("state management", () => {
    it("should allow setting currentTodos", () => {
      const hook = createHook();
      hook.setCurrentTodos(sampleTodos);
      expect(hook.currentTodos()).toEqual(sampleTodos);
    });

    it("should allow setting showTodoPanel", () => {
      const hook = createHook();
      hook.setShowTodoPanel(true);
      expect(hook.showTodoPanel()).toBe(true);
    });

    it("should allow setting todoPanelHiding", () => {
      const hook = createHook();
      hook.setTodoPanelHiding(true);
      expect(hook.todoPanelHiding()).toBe(true);
    });

    it("should allow updating todos via setter function", () => {
      const hook = createHook();
      hook.setCurrentTodos(sampleTodos);
      hook.setCurrentTodos((prev) =>
        prev.map((t) =>
          t.content === "Write tests" ? { ...t, status: "completed" as const } : t
        )
      );

      const updated = hook.currentTodos().find((t) => t.content === "Write tests");
      expect(updated?.status).toBe("completed");
    });
  });

  // ============================================================================
  // Hide Timer
  // ============================================================================

  describe("startHideTimer", () => {
    it("should do nothing if panel is not showing", () => {
      const hook = createHook(100);
      hook.setShowTodoPanel(false);

      hook.startHideTimer();

      // Should not set hiding state
      expect(hook.todoPanelHiding()).toBe(false);
    });

    it("should set todoPanelHiding=true immediately when panel is showing", () => {
      const hook = createHook(100);
      hook.setShowTodoPanel(true);

      hook.startHideTimer();

      expect(hook.todoPanelHiding()).toBe(true);
    });

    it("should NOT hide panel immediately", () => {
      const hook = createHook(100);
      hook.setShowTodoPanel(true);

      hook.startHideTimer();

      // Panel still visible (for animation)
      expect(hook.showTodoPanel()).toBe(true);
    });

    it("should hide panel after delay", () => {
      const hook = createHook(100);
      hook.setShowTodoPanel(true);

      hook.startHideTimer();

      // Advance past the delay
      vi.advanceTimersByTime(150);

      expect(hook.showTodoPanel()).toBe(false);
    });

    it("should reset todoPanelHiding after delay", () => {
      const hook = createHook(100);
      hook.setShowTodoPanel(true);

      hook.startHideTimer();

      vi.advanceTimersByTime(150);

      expect(hook.todoPanelHiding()).toBe(false);
    });

    it("should use default 2000ms delay if not specified", () => {
      const hook = createHook(); // No hideDelay specified
      hook.setShowTodoPanel(true);

      hook.startHideTimer();

      // At 1999ms, panel should still be visible
      vi.advanceTimersByTime(1999);
      expect(hook.showTodoPanel()).toBe(true);

      // At 2001ms, panel should be hidden
      vi.advanceTimersByTime(2);
      expect(hook.showTodoPanel()).toBe(false);
    });

    it("should use custom hideDelay when specified", () => {
      const hook = createHook(500);
      hook.setShowTodoPanel(true);

      hook.startHideTimer();

      // At 400ms, still visible
      vi.advanceTimersByTime(400);
      expect(hook.showTodoPanel()).toBe(true);

      // At 600ms, hidden
      vi.advanceTimersByTime(200);
      expect(hook.showTodoPanel()).toBe(false);
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe("full workflow", () => {
    it("should handle complete show-update-hide cycle", () => {
      const hook = createHook(100);

      // Event handler adds todos and shows panel
      hook.setCurrentTodos([{ content: "Task 1", status: "pending" }]);
      hook.setShowTodoPanel(true);

      expect(hook.showTodoPanel()).toBe(true);
      expect(hook.currentTodos()).toHaveLength(1);

      // More todos come in
      hook.setCurrentTodos([
        { content: "Task 1", status: "completed" },
        { content: "Task 2", status: "in_progress", activeForm: "Working on Task 2" },
      ]);

      expect(hook.currentTodos()).toHaveLength(2);

      // Streaming finishes, start hide timer
      hook.startHideTimer();

      expect(hook.todoPanelHiding()).toBe(true);
      expect(hook.showTodoPanel()).toBe(true); // Still visible for animation

      // Wait for animation to complete
      vi.advanceTimersByTime(150);

      expect(hook.showTodoPanel()).toBe(false);
      expect(hook.todoPanelHiding()).toBe(false);
    });

    it("should preserve todos after panel is hidden", () => {
      const hook = createHook(100);

      hook.setCurrentTodos(sampleTodos);
      hook.setShowTodoPanel(true);
      hook.startHideTimer();

      vi.advanceTimersByTime(150);

      // Panel hidden but todos preserved (for next show)
      expect(hook.showTodoPanel()).toBe(false);
      expect(hook.currentTodos()).toEqual(sampleTodos);
    });
  });
});
