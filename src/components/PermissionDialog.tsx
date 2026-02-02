import { Component, Show } from "solid-js";
import type { ReviewResult } from "../lib/store/types";

interface PermissionDialogProps {
  toolName: string;
  toolInput?: unknown;
  description: string;
  onAllow: (remember: boolean) => void;
  onDeny: () => void;
  /** Whether Bot mode is currently reviewing this permission */
  isReviewing?: boolean;
  /** Result from Bot mode LLM review (shows flag reason if not safe) */
  reviewResult?: ReviewResult | null;
}

const PermissionDialog: Component<PermissionDialogProps> = (props) => {
  const getToolIcon = () => {
    const name = props.toolName.toLowerCase();
    if (name.includes("bash") || name.includes("shell")) return ">";
    if (name.includes("read")) return "R";
    if (name.includes("write") || name.includes("edit")) return "W";
    if (name.includes("glob") || name.includes("grep")) return "?";
    return "*";
  };

  const formatInput = () => {
    if (!props.toolInput) return null;
    try {
      if (typeof props.toolInput === "string") return props.toolInput;
      const input = props.toolInput as Record<string, unknown>;
      // Show key fields based on tool type
      if (input.command) return String(input.command);
      if (input.file_path) return String(input.file_path);
      if (input.path) return String(input.path);
      if (input.pattern) return String(input.pattern);
      return JSON.stringify(input, null, 2).slice(0, 200);
    } catch {
      return null;
    }
  };

  return (
    <div class="permission-dialog">
      <div class="permission-icon">{getToolIcon()}</div>
      <div class="permission-content">
        <div class="permission-tool">{props.toolName}</div>
        <Show when={formatInput()}>
          <div class="permission-input">{formatInput()}</div>
        </Show>
        {/* Show flag reason from Bot mode review */}
        <Show when={props.reviewResult && !props.reviewResult.safe}>
          <div class="permission-flag-reason">
            <span class="flag-icon">⚠</span>
            {props.reviewResult!.reason}
          </div>
        </Show>
      </div>
      {/* Show reviewing spinner or action buttons */}
      <Show when={props.isReviewing} fallback={
        <div class="permission-actions">
          <button class="permission-btn permission-allow" onClick={() => props.onAllow(false)}>
            Allow
          </button>
          <button class="permission-btn permission-always" onClick={() => props.onAllow(true)}>
            Always
          </button>
          <button class="permission-btn permission-deny" onClick={props.onDeny}>
            Deny
          </button>
        </div>
      }>
        <div class="permission-reviewing">
          <span class="reviewing-spinner">◌</span>
          Reviewing...
        </div>
      </Show>
    </div>
  );
};

export default PermissionDialog;
