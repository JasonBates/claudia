import { createSignal, Accessor, Setter } from "solid-js";

export interface UsePlanningModeReturn {
  // Signals
  isPlanning: Accessor<boolean>;
  setIsPlanning: Setter<boolean>;
  planFilePath: Accessor<string | null>;
  setPlanFilePath: Setter<string | null>;
  showPlanApproval: Accessor<boolean>;
  setShowPlanApproval: Setter<boolean>;
  planContent: Accessor<string>;
  setPlanContent: Setter<string>;

  // Actions
  handlePlanApprove: () => Promise<void>;
  handlePlanRequestChanges: (feedback: string) => Promise<void>;
  handlePlanCancel: () => Promise<void>;
}

export interface UsePlanningModeOptions {
  /**
   * Function to submit a message to the CLI.
   * The hook uses this to send approval/rejection messages.
   */
  submitMessage: (message: string) => Promise<void>;
}

/**
 * Custom hook for managing planning mode state and workflow.
 *
 * Handles:
 * - Plan mode state (entering/exiting plan mode)
 * - Plan file path tracking
 * - Plan approval modal state
 * - Approve/reject/cancel actions
 *
 * The actual plan content detection happens in event handlers,
 * which call the setters exposed by this hook.
 */
export function usePlanningMode(options: UsePlanningModeOptions): UsePlanningModeReturn {
  const [isPlanning, setIsPlanning] = createSignal(false);
  const [planFilePath, setPlanFilePath] = createSignal<string | null>(null);
  const [showPlanApproval, setShowPlanApproval] = createSignal(false);
  const [planContent, setPlanContent] = createSignal("");

  /**
   * Approve the current plan and proceed with implementation.
   */
  const handlePlanApprove = async (): Promise<void> => {
    setShowPlanApproval(false);
    setIsPlanning(false);
    setPlanContent("");
    // Don't clear planFilePath yet - might be referenced in the response
    await options.submitMessage("I approve this plan. Proceed with implementation.");
  };

  /**
   * Request changes to the plan with user feedback.
   */
  const handlePlanRequestChanges = async (feedback: string): Promise<void> => {
    setShowPlanApproval(false);
    // Stay in planning mode for iteration
    await options.submitMessage(feedback);
  };

  /**
   * Cancel the current plan entirely.
   */
  const handlePlanCancel = async (): Promise<void> => {
    setShowPlanApproval(false);
    setIsPlanning(false);
    setPlanContent("");
    setPlanFilePath(null);
    await options.submitMessage("Cancel this plan. Let's start over with a different approach.");
  };

  return {
    // Signals
    isPlanning,
    setIsPlanning,
    planFilePath,
    setPlanFilePath,
    showPlanApproval,
    setShowPlanApproval,
    planContent,
    setPlanContent,

    // Actions
    handlePlanApprove,
    handlePlanRequestChanges,
    handlePlanCancel,
  };
}
