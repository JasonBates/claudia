import { Component } from "solid-js";

interface PlanApprovalBarProps {
  onApprove: () => void;
  onCancel: () => void;
}

const PlanApprovalBar: Component<PlanApprovalBarProps> = (props) => {
  return (
    <div class="plan-approval-bar">
      <span class="plan-approval-label">Plan ready for review</span>
      <div class="plan-approval-actions">
        <button class="plan-btn plan-btn-approve" onClick={props.onApprove}>
          Approve
        </button>
        <button class="plan-btn plan-btn-cancel" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default PlanApprovalBar;
