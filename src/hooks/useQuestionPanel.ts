import { createSignal, Accessor, Setter } from "solid-js";
import type { Question } from "../lib/types";

export interface UseQuestionPanelReturn {
  // Signals
  pendingQuestions: Accessor<Question[]>;
  setPendingQuestions: Setter<Question[]>;
  showQuestionPanel: Accessor<boolean>;
  setShowQuestionPanel: Setter<boolean>;

  // Actions
  handleQuestionAnswer: (answers: Record<string, string>) => Promise<void>;
}

export interface UseQuestionPanelOptions {
  /**
   * Function to submit a message to the CLI.
   * Used to send the user's answer back.
   */
  submitMessage: (message: string) => Promise<void>;

  /**
   * Function to focus the command input after answering.
   */
  focusInput?: () => void;
}

/**
 * Custom hook for managing the AskUserQuestion panel.
 *
 * Handles:
 * - Pending questions from the AskUserQuestion tool
 * - Panel visibility
 * - Answer submission flow
 *
 * The actual question data comes from event handlers calling setPendingQuestions.
 */
export function useQuestionPanel(options: UseQuestionPanelOptions): UseQuestionPanelReturn {
  const [pendingQuestions, setPendingQuestions] = createSignal<Question[]>([]);
  const [showQuestionPanel, setShowQuestionPanel] = createSignal(false);

  /**
   * Handle user's answer to the pending questions.
   * Hides the panel, focuses the input, and sends the answer.
   */
  const handleQuestionAnswer = async (answers: Record<string, string>): Promise<void> => {
    // Hide the question panel
    setShowQuestionPanel(false);
    setPendingQuestions([]);

    // Focus back to the input line
    requestAnimationFrame(() => {
      options.focusInput?.();
    });

    // Format the answer and send as a follow-up message
    const answerText = Object.values(answers).join(", ");

    // Send the answer as the user's response
    await options.submitMessage(answerText);
  };

  return {
    // Signals
    pendingQuestions,
    setPendingQuestions,
    showQuestionPanel,
    setShowQuestionPanel,

    // Actions
    handleQuestionAnswer,
  };
}
