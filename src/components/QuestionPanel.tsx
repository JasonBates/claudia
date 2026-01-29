import { Component, For, Show, createSignal, createEffect, onMount } from "solid-js";
import type { Question, QuestionOption } from "../lib/types";

interface QuestionPanelProps {
  questions: Question[];
  onAnswer: (answers: Record<string, string>) => void;
  onCancel?: () => void;
}

const QuestionPanel: Component<QuestionPanelProps> = (props) => {
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  const [customInputs, setCustomInputs] = createSignal<Record<string, string>>({});
  const [showCustomFor, setShowCustomFor] = createSignal<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [focusedOption, setFocusedOption] = createSignal(0); // 0 = first option, options.length = "Other"

  let panelRef: HTMLDivElement | undefined;

  // Reset focused option when question changes
  createEffect(() => {
    currentIndex(); // Track this
    setFocusedOption(0);
  });

  // Auto-focus panel on mount for keyboard navigation
  onMount(() => {
    panelRef?.focus();
  });

  const allQuestionsAnswered = () => {
    return props.questions.every(q => answers()[q.question]);
  };

  const isQuestionAnswered = (question: Question) => {
    return !!answers()[question.question];
  };

  // Navigation functions
  const goToQuestion = (index: number) => {
    if (index >= 0 && index < props.questions.length) {
      setCurrentIndex(index);
    }
  };

  const goNext = () => goToQuestion(currentIndex() + 1);
  const goPrev = () => goToQuestion(currentIndex() - 1);

  // Auto-advance to next question (or stay on last)
  const advanceToNext = () => {
    const current = currentIndex();
    if (current < props.questions.length - 1) {
      setCurrentIndex(current + 1);
    }
  };

  // Get total options count (regular options + "Other")
  const getOptionsCount = () => {
    const question = currentQuestion();
    return question ? question.options.length + 1 : 0; // +1 for "Other"
  };

  // Keyboard handler for arrow navigation
  const handlePanelKeyDown = (e: KeyboardEvent) => {
    const question = currentQuestion();
    if (!question) return;

    // Don't handle if we're in custom input mode (let the input handle it)
    if (showCustomFor()[question.question] && e.target instanceof HTMLInputElement) {
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedOption(prev => Math.max(0, prev - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedOption(prev => Math.min(getOptionsCount() - 1, prev + 1));
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const focused = focusedOption();
      const optionsLen = question.options.length;

      if (focused < optionsLen) {
        // Select a regular option
        selectOption(question, question.options[focused]);
      } else {
        // "Other" is focused
        selectOther(question);
      }

      // If all questions answered and we're on the last one, submit
      if (allQuestionsAnswered()) {
        submitAllAnswers();
      }
    }
  };

  // Check if an option is selected (handles both single and multi-select)
  const isOptionSelected = (question: Question, optionLabel: string): boolean => {
    const answer = answers()[question.question];
    if (!answer) return false;
    if (question.multiSelect) {
      // For multi-select, check if the label is in the comma-separated list
      const selectedLabels = answer.split(", ");
      return selectedLabels.includes(optionLabel);
    }
    return answer === optionLabel;
  };

  const selectOption = (question: Question, option: QuestionOption) => {
    // Clear custom input when selecting a predefined option
    setShowCustomFor(prev => ({ ...prev, [question.question]: false }));

    if (question.multiSelect) {
      // For multi-select: toggle the option
      setAnswers(prev => {
        const currentAnswer = prev[question.question] || "";
        const selectedLabels = currentAnswer ? currentAnswer.split(", ") : [];
        const labelIndex = selectedLabels.indexOf(option.label);

        if (labelIndex >= 0) {
          // Remove if already selected
          selectedLabels.splice(labelIndex, 1);
        } else {
          // Add if not selected
          selectedLabels.push(option.label);
        }

        const newAnswer = selectedLabels.join(", ");
        return { ...prev, [question.question]: newAnswer || "" };
      });
      // Don't auto-advance for multi-select - user needs to click Submit
    } else {
      // For single-select: replace the answer
      setAnswers(prev => ({ ...prev, [question.question]: option.label }));

      // If single question and not multi-select, submit immediately
      if (props.questions.length === 1) {
        props.onAnswer({ [question.question]: option.label });
      } else {
        // Auto-advance to next unanswered question
        advanceToNext();
      }
    }
  };

  const selectOther = (question: Question) => {
    setShowCustomFor(prev => ({ ...prev, [question.question]: true }));
    setAnswers(prev => {
      const newAnswers = { ...prev };
      delete newAnswers[question.question];
      return newAnswers;
    });
  };

  const setCustomAnswer = (question: Question, value: string) => {
    setCustomInputs(prev => ({ ...prev, [question.question]: value }));
    if (value.trim()) {
      setAnswers(prev => ({ ...prev, [question.question]: value.trim() }));
    }
  };

  const submitAllAnswers = () => {
    if (allQuestionsAnswered()) {
      props.onAnswer(answers());
    }
  };

  const handleCustomKeyDown = (e: KeyboardEvent, question: Question) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const value = customInputs()[question.question]?.trim();
      if (value) {
        setAnswers(prev => ({ ...prev, [question.question]: value }));
        // If single question, submit
        if (props.questions.length === 1) {
          props.onAnswer({ [question.question]: value });
        } else {
          // Auto-advance
          advanceToNext();
        }
      }
    }
  };

  const currentQuestion = () => props.questions[currentIndex()];

  // Handle escape key to cancel
  const handlePanelKeyDownWithCancel = (e: KeyboardEvent) => {
    if (e.key === "Escape" && props.onCancel) {
      e.preventDefault();
      props.onCancel();
      return;
    }
    handlePanelKeyDown(e);
  };

  return (
    <div
      ref={panelRef}
      class="question-panel"
      tabIndex={0}
      onKeyDown={handlePanelKeyDownWithCancel}
    >
      {/* Close button */}
      <Show when={props.onCancel}>
        <button
          class="question-close"
          onClick={props.onCancel}
          title="Close (Escape)"
        >
          ×
        </button>
      </Show>

      {/* Navigation header - only show for multiple questions */}
      <Show when={props.questions.length > 1}>
        <div class="question-nav">
          <div class="question-nav-arrows">
            <button
              class="question-nav-arrow"
              onClick={goPrev}
              disabled={currentIndex() === 0}
            >
              ←
            </button>
            <span class="question-nav-label">
              Question {currentIndex() + 1} of {props.questions.length}
            </span>
            <button
              class="question-nav-arrow"
              onClick={goNext}
              disabled={currentIndex() === props.questions.length - 1}
            >
              →
            </button>
          </div>
        </div>

        {/* Dot indicators */}
        <div class="question-dots">
          <For each={props.questions}>
            {(question, index) => (
              <button
                class="question-dot"
                classList={{
                  active: index() === currentIndex(),
                  answered: isQuestionAnswered(question) && index() !== currentIndex(),
                  inactive: !isQuestionAnswered(question) && index() !== currentIndex()
                }}
                onClick={() => goToQuestion(index())}
                title={`Question ${index() + 1}${isQuestionAnswered(question) ? " (answered)" : ""}`}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Current question */}
      <Show when={currentQuestion()}>
        {(question) => (
          <div class="question-item">
            <div class="question-header">
              <span class="question-badge">{question().header}</span>
              <Show when={answers()[question().question]}>
                <span class="question-answered">✓</span>
              </Show>
            </div>

            <div class="question-text">{question().question}</div>

            <div class="question-options" classList={{ multiselect: question().multiSelect }}>
              <For each={question().options}>
                {(option, index) => (
                  <button
                    class="question-option"
                    classList={{
                      selected: isOptionSelected(question(), option.label),
                      focused: focusedOption() === index(),
                      multiselect: question().multiSelect
                    }}
                    onClick={() => selectOption(question(), option)}
                    onMouseEnter={() => setFocusedOption(index())}
                  >
                    <Show when={question().multiSelect}>
                      <span class="option-checkbox">
                        {isOptionSelected(question(), option.label) ? "☑" : "☐"}
                      </span>
                    </Show>
                    <span class="option-label">{option.label}</span>
                    <span class="option-desc">{option.description}</span>
                  </button>
                )}
              </For>

              <button
                class="question-option question-other"
                classList={{
                  selected: showCustomFor()[question().question],
                  focused: focusedOption() === question().options.length
                }}
                onClick={() => selectOther(question())}
                onMouseEnter={() => setFocusedOption(question().options.length)}
              >
                <span class="option-label">Other</span>
                <span class="option-desc">Type your own response</span>
              </button>
            </div>

            <Show when={showCustomFor()[question().question]}>
              <div class="question-custom">
                <input
                  type="text"
                  class="question-input"
                  placeholder="Type your response..."
                  value={customInputs()[question().question] || ""}
                  onInput={(e) => setCustomAnswer(question(), e.currentTarget.value)}
                  onKeyDown={(e) => handleCustomKeyDown(e, question())}
                  autofocus
                />
              </div>
            </Show>

            {/* Next button for multi-select questions when not on last question */}
            <Show when={question().multiSelect && props.questions.length > 1 && currentIndex() < props.questions.length - 1 && answers()[question().question]}>
              <button
                class="question-next"
                onClick={advanceToNext}
              >
                Next →
              </button>
            </Show>
          </div>
        )}
      </Show>

      {/* Submit button - show on last question (or single question) when all answered */}
      <Show when={(props.questions.length === 1 && currentQuestion()?.multiSelect) || (props.questions.length > 1 && currentIndex() === props.questions.length - 1)}>
        <button
          class="question-submit-all"
          classList={{ disabled: !allQuestionsAnswered() }}
          onClick={submitAllAnswers}
          disabled={!allQuestionsAnswered()}
        >
          {props.questions.length > 1
            ? `Submit All (${Object.keys(answers()).length}/${props.questions.length})`
            : "Submit"}
        </button>
      </Show>
    </div>
  );
};

export default QuestionPanel;
