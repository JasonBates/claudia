import { Component, For, Show, createSignal } from "solid-js";

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

  const allQuestionsAnswered = () => {
    return props.questions.every(q => answers()[q.question]);
  };

  const selectOption = (question: Question, option: QuestionOption) => {
    setAnswers(prev => ({ ...prev, [question.question]: option.label }));
    setShowCustomFor(prev => ({ ...prev, [question.question]: false }));

    // If single question, submit immediately
    if (props.questions.length === 1 && !question.multiSelect) {
      props.onAnswer({ [question.question]: option.label });
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

  const handleKeyDown = (e: KeyboardEvent, question: Question) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const value = customInputs()[question.question]?.trim();
      if (value) {
        setAnswers(prev => ({ ...prev, [question.question]: value }));
        // If single question, submit
        if (props.questions.length === 1) {
          props.onAnswer({ [question.question]: value });
        }
      }
    }
  };

  return (
    <div class="question-panel">
      <For each={props.questions}>
        {(question, index) => (
          <div class="question-item" classList={{ "question-item-divider": index() > 0 }}>
            <div class="question-header">
              <span class="question-badge">{question.header}</span>
              <Show when={answers()[question.question]}>
                <span class="question-answered">✓</span>
              </Show>
            </div>

            <div class="question-text">{question.question}</div>

            <div class="question-options">
              <For each={question.options}>
                {(option) => (
                  <button
                    class="question-option"
                    classList={{ selected: answers()[question.question] === option.label }}
                    onClick={() => selectOption(question, option)}
                  >
                    <span class="option-label">{option.label}</span>
                    <span class="option-desc">{option.description}</span>
                  </button>
                )}
              </For>

              <button
                class="question-option question-other"
                classList={{ selected: showCustomFor()[question.question] }}
                onClick={() => selectOther(question)}
              >
                <span class="option-label">Other</span>
                <span class="option-desc">Type your own response</span>
              </button>
            </div>

            <Show when={showCustomFor()[question.question]}>
              <div class="question-custom">
                <input
                  type="text"
                  class="question-input"
                  placeholder="Type your response..."
                  value={customInputs()[question.question] || ""}
                  onInput={(e) => setCustomAnswer(question, e.currentTarget.value)}
                  onKeyDown={(e) => handleKeyDown(e, question)}
                  autofocus
                />
              </div>
            </Show>
          </div>
        )}
      </For>

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
