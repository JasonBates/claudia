import { invoke, Channel } from "@tauri-apps/api/core";
import { runWithOwner, batch, Owner } from "solid-js";

export interface ClaudeEvent {
  type:
    | "status"
    | "ready"
    | "processing"
    | "text_delta"
    | "tool_start"
    | "tool_input"
    | "tool_pending"
    | "permission_request"
    | "tool_result"
    | "block_end"
    | "result"
    | "done"
    | "closed"
    | "error";
  // Status/Ready
  message?: string;
  session_id?: string;
  model?: string;
  tools?: number;
  // Processing
  prompt?: string;
  // TextDelta
  text?: string;
  // ToolStart
  id?: string;
  name?: string;
  // ToolInput
  json?: string;
  // PermissionRequest (control_request with can_use_tool)
  request_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  description?: string;
  // ToolResult
  stdout?: string;
  stderr?: string;
  is_error?: boolean;
  // Result
  content?: string;
  cost?: number;
  duration?: number;
  turns?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read?: number;
  cache_write?: number;
  // Closed
  code?: number;
}

export interface Config {
  anthropic_api_key?: string;
  default_working_dir?: string;
  theme: string;
}

export async function startSession(workingDir?: string): Promise<void> {
  await invoke("start_session", { workingDir });
}

export async function sendMessage(
  message: string,
  onEvent: (event: ClaudeEvent) => void,
  owner?: Owner | null
): Promise<void> {
  const channel = new Channel<ClaudeEvent>();

  // Wrap the callback with SolidJS reactive context restoration
  // Tauri channel callbacks run outside SolidJS's tracking, so we restore context
  channel.onmessage = (event) => {
    console.log("[TAURI CHANNEL] Received event:", event.type);

    if (owner) {
      runWithOwner(owner, () => {
        batch(() => {
          onEvent(event);
        });
      });
    } else {
      onEvent(event);
    }
  };

  console.log("[TAURI] Calling invoke send_message");
  await invoke("send_message", { message, channel });
  console.log("[TAURI] invoke send_message returned");
}

export async function stopSession(): Promise<void> {
  await invoke("stop_session");
}

export async function getConfig(): Promise<Config> {
  return await invoke("get_config");
}

export async function saveConfig(config: Config): Promise<void> {
  await invoke("save_config", { config });
}

export async function isSessionActive(): Promise<boolean> {
  return await invoke("is_session_active");
}

export async function sendPermissionResponse(requestId: string, allow: boolean, remember?: boolean): Promise<void> {
  await invoke("send_permission_response", { requestId, allow, remember: remember || false });
}

// Hook-based permission system
export interface PermissionRequestFromHook {
  timestamp: number;
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  session_id: string;
  permission_mode: string;
}

export async function pollPermissionRequest(): Promise<PermissionRequestFromHook | null> {
  return await invoke("poll_permission_request");
}

export async function respondToPermission(allow: boolean, message?: string): Promise<void> {
  await invoke("respond_to_permission", { allow, message });
}
