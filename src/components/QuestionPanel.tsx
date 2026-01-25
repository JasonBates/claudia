import { Component, For, Show, createSignal, createEffect, onMount } from "solid-js";

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface QuestionPanelProps {
  questions: Question[];
  onAnswer: (answers: Record<string, string>) => void;
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

  // Auto-advance to next unanswered question
  const advanceToNextUnanswered = () => {
    const current = currentIndex();
    // Look for next unanswered question after current
    for (let i = current + 1; i < props.questions.length; i++) {
      if (!isQuestionAnswered(props.questions[i])) {
        setCurrentIndex(i);
        return;
      }
    }
    // If none found after, check before current
    for (let i = 0; i < current; i++) {
      if (!isQuestionAnswered(props.questions[i])) {
        setCurrentIndex(i);
        return;
      }
    }
    // All answered - stay on current
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

  const selectOption = (question: Question, option: QuestionOption) => {
    setAnswers(prev => ({ ...prev, [question.question]: option.label }));
    setShowCustomFor(prev => ({ ...prev, [question.question]: false }));

    // If single question, submit immediately
    if (props.questions.length === 1 && !question.multiSelect) {
      props.onAnswer({ [question.question]: option.label });
    } else {
      // Auto-advance to next unanswered question
      advanceToNextUnanswered();
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
          advanceToNextUnanswered();
        }
      }
    }
  };

  const currentQuestion = () => props.questions[currentIndex()];

  return (
    <div
      ref={panelRef}
      class="question-panel"
      tabIndex={0}
      onKeyDown={handlePanelKeyDown}
    >
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

            <div class="question-options">
              <For each={question().options}>
                {(option, index) => (
                  <button
                    class="question-option"
                    classList={{
                      selected: answers()[question().question] === option.label,
                      focused: focusedOption() === index()
                    }}
                    onClick={() => selectOption(question(), option)}
                    onMouseEnter={() => setFocusedOption(index())}
                  >
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
          </div>
        )}
      </Show>

      {/* Submit button for multiple questions */}
      <Show when={props.questions.length > 1}>
        <button
          class="question-submit-all"
          classList={{ disabled: !allQuestionsAnswered() }}
          onClick={submitAllAnswers}
          disabled={!allQuestionsAnswered()}
        >
          Submit Answers ({Object.keys(answers()).length}/{props.questions.length})
        </button>
      </Show>
    </div>
  );
};

export default QuestionPanel;
