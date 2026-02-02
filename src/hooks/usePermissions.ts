import { createSignal, createEffect, Accessor, Setter, runWithOwner, batch, Owner } from "solid-js";
import { pollPermissionRequest, respondToPermission, sendPermissionResponse, reviewPermissionRequest } from "../lib/tauri";
import type { Mode } from "../lib/mode-utils";
import type { PermissionRequest } from "../lib/event-handlers";
import type { ReviewResult } from "../lib/store/types";

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

  // Bot mode review (optional, only available when external state is provided)
  isReviewing?: Accessor<boolean>;
  reviewResult?: Accessor<ReviewResult | null>;
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

  // === Bot Mode State (optional) ===

  /**
   * Accessor for isReviewing state (from store).
   * True when Bot mode is reviewing a permission via LLM.
   */
  isReviewing?: Accessor<boolean>;

  /**
   * Dispatch function to update isReviewing state.
   */
  setIsReviewing?: (value: boolean) => void;

  /**
   * Accessor for reviewResult state (from store).
   */
  reviewResult?: Accessor<ReviewResult | null>;

  /**
   * Dispatch function to update reviewResult state.
   */
  setReviewResult?: (value: ReviewResult | null) => void;

  /**
   * Callback when Bot mode requires API key setup.
   * Called when switching to Bot mode but API key is not configured.
   */
  onBotApiKeyRequired?: () => void;
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

  // === Bot Mode LLM Review Effect ===
  // When isReviewing is true and there's a pending permission, trigger LLM review
  createEffect(() => {
    const isReviewing = options.isReviewing?.();
    const permission = pendingPermission();

    // Only run review when in bot mode with a pending permission and reviewing flag set
    if (!isReviewing || !permission) return;

    // Capture the requestId to prevent race conditions
    // If a new permission arrives while we're reviewing, we should ignore the old review result
    const reviewingRequestId = permission.requestId;

    console.log("[usePermissions] Bot mode - starting LLM review for:", permission.toolName, "requestId:", reviewingRequestId);

    // Run the LLM review
    reviewPermissionRequest(
      permission.toolName,
      permission.toolInput,
      permission.description
    )
      .then((result) => {
        // Check if this is still the permission we're reviewing
        // A new permission may have arrived while we were reviewing
        const currentPermission = pendingPermission();
        if (!currentPermission || currentPermission.requestId !== reviewingRequestId) {
          console.log("[usePermissions] Review completed but permission changed, ignoring result for:", reviewingRequestId);
          return;
        }

        console.log("[usePermissions] LLM review result:", result);

        // Update review state
        options.setIsReviewing?.(false);
        options.setReviewResult?.(result);

        // If safe, auto-approve
        if (result.safe) {
          console.log("[usePermissions] Bot mode - auto-approving safe operation");
          // Don't await here to avoid blocking the effect
          handlePermissionAllow(false).catch((err) => {
            console.error("[usePermissions] Bot mode auto-approve failed:", err);
          });
        }
        // If not safe, the dialog will be shown with the review result
      })
      .catch((err) => {
        // Check if this is still the permission we're reviewing
        const currentPermission = pendingPermission();
        if (!currentPermission || currentPermission.requestId !== reviewingRequestId) {
          console.log("[usePermissions] Review failed but permission changed, ignoring error for:", reviewingRequestId);
          return;
        }

        console.error("[usePermissions] LLM review failed:", err);
        // On error, clear reviewing state and show dialog for manual decision
        options.setIsReviewing?.(false);
        options.setReviewResult?.({
          safe: false,
          reason: `Review failed: ${err}. Please decide manually.`,
        });
      });
  });

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
          const mode = options.getCurrentMode();

          // In auto mode, immediately approve
          if (mode === "auto") {
            console.log("[usePermissions] Auto-accepting:", request.tool_name);
            await respondToPermission(true);
            return;
          }

          // In bot mode, trigger LLM review before deciding
          if (mode === "bot") {
            console.log("[usePermissions] Bot mode (polling) - triggering LLM review:", request.tool_name);
            runWithOwner(options.owner, () => {
              batch(() => {
                // Set reviewing flag FIRST (triggers the review effect)
                options.setIsReviewing?.(true);
                // Then set the pending permission
                setPendingPermission({
                  requestId: request.tool_use_id,
                  toolName: request.tool_name,
                  toolInput: request.tool_input,
                  description: `Allow ${request.tool_name}?`,
                });
              });
            });
            return;
          }

          // For request/plan modes, show permission dialog directly
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

    // Bot mode review (pass through from options if provided)
    isReviewing: options.isReviewing,
    reviewResult: options.reviewResult,
  };
}
