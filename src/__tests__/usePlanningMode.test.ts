import { createRoot } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePlanningMode, UsePlanningModeReturn } from "../hooks/usePlanningMode";

describe("usePlanningMode", () => {
  let dispose: () => void;
  let mockSubmitMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSubmitMessage = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    dispose?.();
    vi.clearAllMocks();
  });

  const createHook = () => {
    let hook: UsePlanningModeReturn;
    createRoot((d) => {
      dispose = d;
      hook = usePlanningMode({ submitMessage: mockSubmitMessage });
    });
    return hook!;
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  describe("initialization", () => {
    it("should start with isPlanning=false", () => {
      const hook = createHook();
      expect(hook.isPlanning()).toBe(false);
    });

    it("should start with showPlanApproval=false", () => {
      const hook = createHook();
      expect(hook.showPlanApproval()).toBe(false);
    });

    it("should start with null planFilePath", () => {
      const hook = createHook();
      expect(hook.planFilePath()).toBeNull();
    });

    it("should start with empty planContent", () => {
      const hook = createHook();
      expect(hook.planContent()).toBe("");
    });
  });

  // ============================================================================
  // State Management
  // ============================================================================

  describe("state management", () => {
    it("should allow setting isPlanning", () => {
      const hook = createHook();
      hook.setIsPlanning(true);
      expect(hook.isPlanning()).toBe(true);
    });

    it("should allow setting planFilePath", () => {
      const hook = createHook();
      hook.setPlanFilePath("/path/to/plan.md");
      expect(hook.planFilePath()).toBe("/path/to/plan.md");
    });

    it("should allow setting showPlanApproval", () => {
      const hook = createHook();
      hook.setShowPlanApproval(true);
      expect(hook.showPlanApproval()).toBe(true);
    });

    it("should allow setting planContent", () => {
      const hook = createHook();
      hook.setPlanContent("# My Plan\n\n1. Step one");
      expect(hook.planContent()).toBe("# My Plan\n\n1. Step one");
    });
  });

  // ============================================================================
  // Plan Approval
  // ============================================================================

  describe("handlePlanApprove", () => {
    it("should hide the approval modal", async () => {
      const hook = createHook();
      hook.setShowPlanApproval(true);

      await hook.handlePlanApprove();

      expect(hook.showPlanApproval()).toBe(false);
    });

    it("should exit planning mode", async () => {
      const hook = createHook();
      hook.setIsPlanning(true);

      await hook.handlePlanApprove();

      expect(hook.isPlanning()).toBe(false);
    });

    it("should clear plan content", async () => {
      const hook = createHook();
      hook.setPlanContent("Some plan content");

      await hook.handlePlanApprove();

      expect(hook.planContent()).toBe("");
    });

    it("should NOT clear planFilePath (may be referenced later)", async () => {
      const hook = createHook();
      hook.setPlanFilePath("/path/to/plan.md");

      await hook.handlePlanApprove();

      expect(hook.planFilePath()).toBe("/path/to/plan.md");
    });

    it("should submit approval message", async () => {
      const hook = createHook();

      await hook.handlePlanApprove();

      expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
      expect(mockSubmitMessage).toHaveBeenCalledWith(
        "I approve this plan. Proceed with implementation."
      );
    });
  });

  // ============================================================================
  // Plan Request Changes
  // ============================================================================

  describe("handlePlanRequestChanges", () => {
    it("should hide the approval modal", async () => {
      const hook = createHook();
      hook.setShowPlanApproval(true);

      await hook.handlePlanRequestChanges("Please add error handling");

      expect(hook.showPlanApproval()).toBe(false);
    });

    it("should stay in planning mode for iteration", async () => {
      const hook = createHook();
      hook.setIsPlanning(true);

      await hook.handlePlanRequestChanges("Please add error handling");

      expect(hook.isPlanning()).toBe(true);
    });

    it("should submit the user feedback as message", async () => {
      const hook = createHook();

      await hook.handlePlanRequestChanges("Add more test cases");

      expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
      expect(mockSubmitMessage).toHaveBeenCalledWith("Add more test cases");
    });

    it("should preserve planContent for reference", async () => {
      const hook = createHook();
      hook.setPlanContent("Original plan");

      await hook.handlePlanRequestChanges("Modify this");

      // Content preserved so user can reference it
      expect(hook.planContent()).toBe("Original plan");
    });
  });

  // ============================================================================
  // Plan Cancellation
  // ============================================================================

  describe("handlePlanCancel", () => {
    it("should hide the approval modal", async () => {
      const hook = createHook();
      hook.setShowPlanApproval(true);

      await hook.handlePlanCancel();

      expect(hook.showPlanApproval()).toBe(false);
    });

    it("should exit planning mode", async () => {
      const hook = createHook();
      hook.setIsPlanning(true);

      await hook.handlePlanCancel();

      expect(hook.isPlanning()).toBe(false);
    });

    it("should clear plan content", async () => {
      const hook = createHook();
      hook.setPlanContent("Some plan");

      await hook.handlePlanCancel();

      expect(hook.planContent()).toBe("");
    });

    it("should clear planFilePath", async () => {
      const hook = createHook();
      hook.setPlanFilePath("/path/to/plan.md");

      await hook.handlePlanCancel();

      expect(hook.planFilePath()).toBeNull();
    });

    it("should submit cancellation message", async () => {
      const hook = createHook();

      await hook.handlePlanCancel();

      expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
      expect(mockSubmitMessage).toHaveBeenCalledWith(
        "Cancel this plan. Let's start over with a different approach."
      );
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe("full workflow", () => {
    it("should handle complete approve flow", async () => {
      const hook = createHook();

      // Simulate entering plan mode (done by event handlers)
      hook.setIsPlanning(true);
      hook.setPlanFilePath("/path/to/plan.md");
      hook.setPlanContent("# Plan\n\n1. Do stuff");
      hook.setShowPlanApproval(true);

      // User approves
      await hook.handlePlanApprove();

      // Verify end state
      expect(hook.isPlanning()).toBe(false);
      expect(hook.showPlanApproval()).toBe(false);
      expect(hook.planContent()).toBe("");
      expect(hook.planFilePath()).toBe("/path/to/plan.md"); // preserved
      expect(mockSubmitMessage).toHaveBeenCalled();
    });

    it("should handle iterate-then-approve flow", async () => {
      const hook = createHook();

      // Enter plan mode
      hook.setIsPlanning(true);
      hook.setShowPlanApproval(true);

      // Request changes
      await hook.handlePlanRequestChanges("Add logging");

      // Still in planning mode
      expect(hook.isPlanning()).toBe(true);
      expect(hook.showPlanApproval()).toBe(false);

      // Show approval again after Claude updates plan
      hook.setShowPlanApproval(true);

      // Now approve
      await hook.handlePlanApprove();

      expect(hook.isPlanning()).toBe(false);
      expect(mockSubmitMessage).toHaveBeenCalledTimes(2);
    });
  });
});
