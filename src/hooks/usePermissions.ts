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
   * External pending permission accessor (from store).
   * If provided, the hook will use this instead of its own internal signal.
   * Returns the first item in the permission queue, or null.
   */
  pendingPermission?: Accessor<PermissionRequest | null>;

  /**
   * Callback to enqueue a permission request (from store dispatch).
   * Deduplicates by requestId — safe to call multiple times for the same request.
   */
  enqueuePermission?: (permission: PermissionRequest) => void;

  /**
   * Callback to remove a permission from the queue by requestId (from store dispatch).
   */
  dequeuePermission?: (requestId: string) => void;

  // === Bot Mode State (optional) ===

  /**
   * Accessor for isReviewing state (from store).
   * True when Bot mode is reviewing a permission via LLM.
   */
  isReviewing?: Accessor<boolean>;

  /**
   * Dispatch function to update isReviewing state for a specific request.
   */
  setIsReviewing?: (requestId: string, value: boolean) => void;

  /**
   * Accessor for reviewResult state (from store).
   */
  reviewResult?: Accessor<ReviewResult | null>;

  /**
   * Dispatch function to update reviewResult state for a specific request.
   */
  setReviewResult?: (requestId: string, value: ReviewResult | null) => void;

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

  // Enqueue function that works with either queue (store) or local state
  const enqueuePermission = (permission: PermissionRequest) => {
    if (options.enqueuePermission) {
      options.enqueuePermission(permission);
    } else {
      setLocalPendingPermission(permission);
    }
  };

  // Dequeue function that works with either queue (store) or local state
  const dequeuePermission = (requestId: string) => {
    if (options.dequeuePermission) {
      options.dequeuePermission(requestId);
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
        options.setIsReviewing?.(reviewingRequestId, false);
        options.setReviewResult?.(reviewingRequestId, result);

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

        const errorStr = String(err);
        console.error("[usePermissions] LLM review failed:", errorStr);

        // Check if this is an API key error (missing or invalid)
        const isApiKeyError = errorStr.includes("No API key") ||
                              errorStr.includes("401") ||
                              errorStr.includes("Invalid API key") ||
                              errorStr.includes("authentication");

        if (isApiKeyError && options.onBotApiKeyRequired) {
          console.log("[usePermissions] API key error detected, opening settings");
          options.onBotApiKeyRequired();
        }

        // On error, clear reviewing state and show dialog for manual decision
        options.setIsReviewing?.(reviewingRequestId, false);
        options.setReviewResult?.(reviewingRequestId, {
          safe: false,
          reason: isApiKeyError
            ? "API key missing or invalid. Please configure in settings."
            : `Review failed: ${err}. Please decide manually.`,
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
        if (request) {
          console.log("[usePermissions] Hook request received:", request);
          const mode = options.getCurrentMode();

          // In auto mode, immediately approve
          if (mode === "auto") {
            console.log("[usePermissions] Auto-accepting:", request.tool_name);
            await respondToPermission(true);
            return;
          }

          const permReq: PermissionRequest = {
            requestId: request.tool_use_id,
            toolName: request.tool_name,
            toolInput: request.tool_input,
            description: `Allow ${request.tool_name}?`,
            source: "hook",
          };

          // In bot mode, trigger LLM review before deciding
          if (mode === "bot") {
            console.log("[usePermissions] Bot mode (polling) - triggering LLM review:", request.tool_name);
            runWithOwner(options.owner, () => {
              batch(() => {
                // Enqueue first so the item exists, then set reviewing on it
                enqueuePermission(permReq);
                options.setIsReviewing?.(request.tool_use_id, true);
              });
            });
            return;
          }

          // For request/plan modes, show permission dialog directly
          runWithOwner(options.owner, () => {
            batch(() => {
              enqueuePermission(permReq);
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

    dequeuePermission(permission.requestId);

    // Use the appropriate response mechanism based on the request source:
    // - "control": stream-based response (control_response via stdin)
    // - "hook": file-based response (for MCP hook compatibility)
    if (permission.source === "control") {
      await sendPermissionResponse(permission.requestId, true, remember, permission.toolInput);
      console.log("[usePermissions] Allowed (stream):", permission.toolName);
    } else {
      await respondToPermission(true);
      console.log("[usePermissions] Allowed (file/hook):", permission.toolName);
    }
  };

  /**
   * Deny the current permission request.
   */
  const handlePermissionDeny = async (): Promise<void> => {
    const permission = pendingPermission();
    if (!permission) return;

    dequeuePermission(permission.requestId);

    // Use the appropriate response mechanism based on the request source:
    // - "control": stream-based response (control_response via stdin)
    // - "hook": file-based response (for MCP hook compatibility)
    if (permission.source === "control") {
      await sendPermissionResponse(permission.requestId, false, false, permission.toolInput);
      console.log("[usePermissions] Denied (stream):", permission.toolName);
    } else {
      await respondToPermission(false, "User denied permission");
      console.log("[usePermissions] Denied (file/hook):", permission.toolName);
    }
  };

  return {
    // Signals
    pendingPermission,
    setPendingPermission: setLocalPendingPermission,

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
