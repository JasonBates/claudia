import { Component, Show, createSignal } from "solid-js";
import MessageContent from "./MessageContent";

interface PlanApprovalModalProps {
  planContent: string;
  planFile?: string | null;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onCancel: () => void;
}

const PlanApprovalModal: Component<PlanApprovalModalProps> = (props) => {
  const [showFeedback, setShowFeedback] = createSignal(false);
  const [feedback, setFeedback] = createSignal("");

  const handleRequestChanges = () => {
    if (showFeedback()) {
      // Submit the feedback
      const text = feedback().trim();
      if (text) {
        props.onRequestChanges(text);
      }
    } else {
      // Show the feedback input
      setShowFeedback(true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = feedback().trim();
      if (text) {
        props.onRequestChanges(text);
      }
    }
  };

  // Extract just the filename from the full path
  const fileName = () => {
    if (!props.planFile) return "Plan";
    const parts = props.planFile.split("/");
    return parts[parts.length - 1].replace(".md", "");
  };

  return (
    <div class="plan-modal-overlay">
      <div class="plan-modal">
        <div class="plan-modal-header">
          <h2>Review Plan</h2>
          <span class="plan-modal-file">{fileName()}</span>
        </div>

        <div class="plan-modal-content">
          <MessageContent content={props.planContent} />
        </div>

        <Show when={showFeedback()}>
          <div class="plan-modal-feedback">
            <textarea
              class="plan-feedback-input"
              placeholder="Describe the changes you'd like..."
              value={feedback()}
              onInput={(e) => setFeedback(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autofocus
            />
          </div>
        </Show>

        <div class="plan-modal-actions">
          <button class="plan-btn plan-btn-approve" onClick={props.onApprove}>
            Approve Plan
          </button>
          <button class="plan-btn plan-btn-changes" onClick={handleRequestChanges}>
            {showFeedback() ? "Send Feedback" : "Request Changes"}
          </button>
          <button class="plan-btn plan-btn-cancel" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanApprovalModal;
