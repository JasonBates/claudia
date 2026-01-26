import { createRoot } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useQuestionPanel, UseQuestionPanelReturn } from "../hooks/useQuestionPanel";
import type { Question } from "../lib/types";

describe("useQuestionPanel", () => {
  let dispose: () => void;
  let mockSubmitMessage: ReturnType<typeof vi.fn>;
  let mockFocusInput: ReturnType<typeof vi.fn>;

  // Sample question data
  const sampleQuestion: Question = {
    question: "Which database should we use?",
    header: "Database",
    options: [
      { label: "PostgreSQL", description: "Relational database" },
      { label: "MongoDB", description: "Document database" },
    ],
    multiSelect: false,
  };

  const multiSelectQuestion: Question = {
    question: "Which features do you want?",
    header: "Features",
    options: [
      { label: "Auth", description: "User authentication" },
      { label: "API", description: "REST API" },
      { label: "UI", description: "Admin dashboard" },
    ],
    multiSelect: true,
  };

  beforeEach(() => {
    mockSubmitMessage = vi.fn().mockResolvedValue(undefined);
    mockFocusInput = vi.fn();
    // Mock requestAnimationFrame
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      cb();
      return 0;
    });
  });

  afterEach(() => {
    dispose?.();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const createHook = (options?: { skipFocusInput?: boolean }) => {
    let hook: UseQuestionPanelReturn;
    createRoot((d) => {
      dispose = d;
      hook = useQuestionPanel({
        submitMessage: mockSubmitMessage,
        focusInput: options?.skipFocusInput ? undefined : mockFocusInput,
      });
    });
    return hook!;
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  describe("initialization", () => {
    it("should start with empty pendingQuestions", () => {
      const hook = createHook();
      expect(hook.pendingQuestions()).toEqual([]);
    });

    it("should start with showQuestionPanel=false", () => {
      const hook = createHook();
      expect(hook.showQuestionPanel()).toBe(false);
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe("state management", () => {
    it("should allow setting pendingQuestions", () => {
      const hook = createHook();
      hook.setPendingQuestions([sampleQuestion]);
      expect(hook.pendingQuestions()).toEqual([sampleQuestion]);
    });

    it("should allow setting multiple questions", () => {
      const hook = createHook();
      hook.setPendingQuestions([sampleQuestion, multiSelectQuestion]);
      expect(hook.pendingQuestions()).toHaveLength(2);
    });

    it("should allow setting showQuestionPanel", () => {
      const hook = createHook();
      hook.setShowQuestionPanel(true);
      expect(hook.showQuestionPanel()).toBe(true);
    });
  });

  // ============================================================================
  // Answer Handling
  // ============================================================================

  describe("handleQuestionAnswer", () => {
    it("should hide the question panel", async () => {
      const hook = createHook();
      hook.setShowQuestionPanel(true);

      await hook.handleQuestionAnswer({ q1: "PostgreSQL" });

      expect(hook.showQuestionPanel()).toBe(false);
    });

    it("should clear pending questions", async () => {
      const hook = createHook();
      hook.setPendingQuestions([sampleQuestion]);

      await hook.handleQuestionAnswer({ q1: "PostgreSQL" });

      expect(hook.pendingQuestions()).toEqual([]);
    });

    it("should call focusInput after answering", async () => {
      const hook = createHook();

      await hook.handleQuestionAnswer({ q1: "PostgreSQL" });

      expect(mockFocusInput).toHaveBeenCalledTimes(1);
    });

    it("should handle missing focusInput gracefully", async () => {
      const hook = createHook({ skipFocusInput: true });

      // Should not throw
      await hook.handleQuestionAnswer({ q1: "PostgreSQL" });

      expect(mockSubmitMessage).toHaveBeenCalled();
    });

    it("should submit single answer as message", async () => {
      const hook = createHook();

      await hook.handleQuestionAnswer({ database: "PostgreSQL" });

      expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
      expect(mockSubmitMessage).toHaveBeenCalledWith("PostgreSQL");
    });

    it("should join multiple answers with comma", async () => {
      const hook = createHook();

      await hook.handleQuestionAnswer({
        feature1: "Auth",
        feature2: "API",
      });

      expect(mockSubmitMessage).toHaveBeenCalledWith("Auth, API");
    });

    it("should handle empty answers", async () => {
      const hook = createHook();

      await hook.handleQuestionAnswer({});

      expect(mockSubmitMessage).toHaveBeenCalledWith("");
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe("full workflow", () => {
    it("should handle complete question-answer flow", async () => {
      const hook = createHook();

      // Simulate event handler adding questions
      hook.setPendingQuestions([sampleQuestion]);
      hook.setShowQuestionPanel(true);

      expect(hook.showQuestionPanel()).toBe(true);
      expect(hook.pendingQuestions()).toHaveLength(1);

      // User answers
      await hook.handleQuestionAnswer({ database: "MongoDB" });

      // Verify end state
      expect(hook.showQuestionPanel()).toBe(false);
      expect(hook.pendingQuestions()).toEqual([]);
      expect(mockSubmitMessage).toHaveBeenCalledWith("MongoDB");
      expect(mockFocusInput).toHaveBeenCalled();
    });

    it("should handle multi-question panel", async () => {
      const hook = createHook();

      // Two questions in one panel
      hook.setPendingQuestions([sampleQuestion, multiSelectQuestion]);
      hook.setShowQuestionPanel(true);

      // User answers both
      await hook.handleQuestionAnswer({
        database: "PostgreSQL",
        features: "Auth, API",
      });

      expect(mockSubmitMessage).toHaveBeenCalledWith("PostgreSQL, Auth, API");
    });
  });
});
