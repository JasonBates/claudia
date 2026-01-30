import { createSignal, Accessor, Setter, runWithOwner, batch, Owner } from "solid-js";
import { pollPermissionRequest, respondToPermission, sendPermissionResponse } from "../lib/tauri";
import type { Mode } from "../lib/mode-utils";
import type { PermissionRequest } from "../lib/event-handlers";

export interface UsePermissionsReturn {
  // Signals
  pendingPermission: Accessor<PermissionRequest | null>;
  setPendingPermission: Setter<PermissionRequest | null>;

  // Actions
  handlePermissionAllow: (remember: boolean) => Promise<void>;
  handlePermissionDeny: () => Promise<void>;

  // Polling control
  startPolling: () => void;
  stopPolling: () => void;
}

export interface UsePermissionsOptions {
  /**
   * SolidJS owner for restoring reactive context in polling callbacks.
   * Get this from getOwner() in the component.
   */
  owner: Owner | null;

  /**
   * Accessor for the current mode (used for auto behavior).
   */
  getCurrentMode: Accessor<Mode>;

  /**
   * Whether to use stream-based permission responses (control_response via stdin).
   * If true, uses sendPermissionResponse (stream-based).
   * If false, uses respondToPermission (file-based for MCP hooks).
   * Default: true (stream-based is the primary mechanism now)
   */
  useStreamBasedResponse?: boolean;

  /**
   * External pending permission accessor (from store).
   * If provided, the hook will use this instead of its own internal signal.
   */
  pendingPermission?: Accessor<PermissionRequest | null>;

  /**
   * Callback to clear the pending permission (from store dispatch).
   * Required if pendingPermission is provided.
   */
  clearPendingPermission?: () => void;
}

/**
 * Custom hook for managing tool permission requests.
 *
 * Handles:
 * - Polling for permission requests from the CLI (hook-based permission system)
 * - Auto-accept logic when in "auto" mode
 * - Allow/deny handlers
 *
 * The permission system uses a file-based hook approach where the CLI
 * writes permission requests to a file, and the frontend responds by
 * writing allow/deny responses.
 */
export function usePermissions(options: UsePermissionsOptions): UsePermissionsReturn {
  // Use external permission state from store if provided, otherwise create local signal
  const [localPendingPermission, setLocalPendingPermission] = createSignal<PermissionRequest | null>(null);

  // When external permission state is provided (from store), use it for reading
  const pendingPermission = options.pendingPermission ?? localPendingPermission;

  // For setting permission in polling mode (only used when no external state)
  const setPendingPermission = setLocalPendingPermission;

  // Clear function that works with either local or external state
  const clearPendingPermission = () => {
    if (options.clearPendingPermission) {
      options.clearPendingPermission();
    } else {
      setLocalPendingPermission(null);
    }
  };

  let permissionPollInterval: number | null = null;

  /**
   * Start polling for permission requests.
   * Should be called after the session becomes active.
   */
  const startPolling = (): void => {
    if (permissionPollInterval) {
      // Already polling
      return;
    }

    permissionPollInterval = window.setInterval(async () => {
      try {
        const request = await pollPermissionRequest();
        if (request && !pendingPermission()) {
          console.log("[usePermissions] Hook request received:", request);

          // In auto mode, immediately approve
          if (options.getCurrentMode() === "auto") {
            console.log("[usePermissions] Auto-accepting:", request.tool_name);
            await respondToPermission(true);
            return;
          }

          // Restore SolidJS context for state updates from setInterval
          runWithOwner(options.owner, () => {
            batch(() => {
              // Show permission dialog
              setPendingPermission({
                requestId: request.tool_use_id,
                toolName: request.tool_name,
                toolInput: request.tool_input,
                description: `Allow ${request.tool_name}?`,
              });
            });
          });
        }
      } catch (e) {
        // Ignore polling errors
      }
    }, 200); // Poll every 200ms
  };

  /**
   * Stop polling for permission requests.
   * Called during cleanup.
   */
  const stopPolling = (): void => {
    if (permissionPollInterval) {
      window.clearInterval(permissionPollInterval);
      permissionPollInterval = null;
    }
  };

  /**
   * Allow the current permission request.
   * @param remember - Whether to remember this permission for future requests
   */
  const handlePermissionAllow = async (remember: boolean): Promise<void> => {
    const permission = pendingPermission();
    if (!permission) return;

    clearPendingPermission();

    // Use stream-based response by default (control_response via stdin)
    // Fall back to file-based response for MCP hook compatibility
    const useStreamBased = options.useStreamBasedResponse !== false;
    if (useStreamBased && permission.requestId) {
      await sendPermissionResponse(permission.requestId, true, remember, permission.toolInput);
      console.log("[usePermissions] Allowed (stream):", permission.toolName);
    } else {
      await respondToPermission(true);
      console.log("[usePermissions] Allowed (file):", permission.toolName);
    }
  };

  /**
   * Deny the current permission request.
   */
  const handlePermissionDeny = async (): Promise<void> => {
    const permission = pendingPermission();
    if (!permission) return;

    clearPendingPermission();

    // Use stream-based response by default (control_response via stdin)
    // Fall back to file-based response for MCP hook compatibility
    const useStreamBased = options.useStreamBasedResponse !== false;
    if (useStreamBased && permission.requestId) {
      await sendPermissionResponse(permission.requestId, false, false, permission.toolInput);
      console.log("[usePermissions] Denied (stream):", permission.toolName);
    } else {
      await respondToPermission(false, "User denied permission");
      console.log("[usePermissions] Denied (file):", permission.toolName);
    }
  };

  return {
    // Signals
    pendingPermission,
    setPendingPermission,

    // Actions
    handlePermissionAllow,
    handlePermissionDeny,

    // Polling control
    startPolling,
    stopPolling,
  };
}
