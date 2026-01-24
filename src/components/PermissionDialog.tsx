import { Component, Show } from "solid-js";

interface PermissionDialogProps {
  toolName: string;
  toolInput?: unknown;
  description: string;
  onAllow: (remember: boolean) => void;
  onDeny: () => void;
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
      </div>
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
    </div>
  );
};

export default PermissionDialog;
