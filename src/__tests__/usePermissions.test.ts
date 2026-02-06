import { createRoot, createSignal } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePermissions, UsePermissionsReturn } from "../hooks/usePermissions";
import type { Mode } from "../lib/mode-utils";

// Mock the tauri module
vi.mock("../lib/tauri", () => ({
  pollPermissionRequest: vi.fn(),
  respondToPermission: vi.fn(),
  sendPermissionResponse: vi.fn(),
}));

// Import mocked functions
import {
  pollPermissionRequest as mockPollPermissionRequest,
  respondToPermission as mockRespondToPermission,
  sendPermissionResponse as mockSendPermissionResponse,
} from "../lib/tauri";

describe("usePermissions", () => {
  let dispose: () => void;
  let modeSignal: ReturnType<typeof createSignal<Mode>>;

  // Sample permission request from CLI
  const sampleRequest = {
    tool_use_id: "tool-123",
    tool_name: "Bash",
    tool_input: { command: "rm -rf /" },
    timestamp: Date.now(),
    session_id: "session-abc",
    permission_mode: "default",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: no permission request pending
    vi.mocked(mockPollPermissionRequest).mockResolvedValue(null);
    vi.mocked(mockRespondToPermission).mockResolvedValue(undefined);

    // Create a mode signal for testing - default to "plan" (non-auto mode)
    createRoot((d) => {
      dispose = d;
      modeSignal = createSignal<Mode>("plan");
    });
  });

  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  const createHook = () => {
    let hook: UsePermissionsReturn;
    createRoot((d) => {
      const prevDispose = dispose;
      dispose = () => {
        prevDispose?.();
        d();
      };
      hook = usePermissions({
        owner: null,
        getCurrentMode: modeSignal[0],
      });
    });
    return hook!;
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  describe("initialization", () => {
    it("should start with null pendingPermission", () => {
      const hook = createHook();
      expect(hook.pendingPermission()).toBeNull();
    });
  });

  // ============================================================================
  // Polling Control
  // ============================================================================

  describe("polling control", () => {
    it("should not poll until startPolling is called", () => {
      createHook();

      vi.advanceTimersByTime(1000);

      expect(mockPollPermissionRequest).not.toHaveBeenCalled();
    });

    it("should start polling when startPolling is called", () => {
      const hook = createHook();

      hook.startPolling();
      vi.advanceTimersByTime(250);

      expect(mockPollPermissionRequest).toHaveBeenCalled();
    });

    it("should poll every 200ms", () => {
      const hook = createHook();

      hook.startPolling();

      vi.advanceTimersByTime(200);
      expect(mockPollPermissionRequest).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(200);
      expect(mockPollPermissionRequest).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(200);
      expect(mockPollPermissionRequest).toHaveBeenCalledTimes(3);
    });

    it("should not start multiple polling intervals", () => {
      const hook = createHook();

      hook.startPolling();
      hook.startPolling();
      hook.startPolling();

      vi.advanceTimersByTime(200);

      // Should only poll once per interval, not 3x
      expect(mockPollPermissionRequest).toHaveBeenCalledTimes(1);
    });

    it("should stop polling when stopPolling is called", () => {
      const hook = createHook();

      hook.startPolling();
      vi.advanceTimersByTime(200);
      expect(mockPollPermissionRequest).toHaveBeenCalledTimes(1);

      hook.stopPolling();
      vi.advanceTimersByTime(1000);

      // Should not have polled again
      expect(mockPollPermissionRequest).toHaveBeenCalledTimes(1);
    });

    it("should handle stopPolling when not polling", () => {
      const hook = createHook();

      // Should not throw
      hook.stopPolling();
      hook.stopPolling();

      expect(true).toBe(true);
    });
  });

  // ============================================================================
  // Permission Request Handling
  // ============================================================================

  describe("permission request handling", () => {
    it("should set pendingPermission when request is found", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(hook.pendingPermission()).not.toBeNull();
      expect(hook.pendingPermission()?.toolName).toBe("Bash");
    });

    it("should include requestId from tool_use_id", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(hook.pendingPermission()?.requestId).toBe("tool-123");
    });

    it("should include toolInput from request", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(hook.pendingPermission()?.toolInput).toEqual({ command: "rm -rf /" });
    });

    it("should accept new permission requests even when one is pending", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(hook.pendingPermission()?.requestId).toBe("tool-123");

      // Now another request comes (different ID)
      vi.mocked(mockPollPermissionRequest).mockResolvedValue({
        tool_use_id: "tool-456",
        tool_name: "Read",
        tool_input: {},
        timestamp: Date.now(),
        session_id: "session-abc",
        permission_mode: "default",
      });

      await vi.advanceTimersByTimeAsync(200);

      // In local mode (no store queue), new request replaces the old one
      // In store mode, both would be queued; the store deduplicates by requestId
      expect(hook.pendingPermission()?.requestId).toBe("tool-456");
    });

    it("should ignore polling errors silently", async () => {
      vi.mocked(mockPollPermissionRequest).mockRejectedValue(new Error("Network error"));
      const hook = createHook();

      hook.startPolling();

      // Should not throw
      await vi.advanceTimersByTimeAsync(200);

      expect(hook.pendingPermission()).toBeNull();
    });
  });

  // ============================================================================
  // Auto Mode
  // ============================================================================

  describe("auto mode", () => {
    it("should auto-allow when mode is 'auto'", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      modeSignal[1]("auto");
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(mockRespondToPermission).toHaveBeenCalledWith(true);
      expect(hook.pendingPermission()).toBeNull(); // Not shown to user
    });

    it("should NOT auto-allow when mode is 'plan'", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      modeSignal[1]("plan");
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(mockRespondToPermission).not.toHaveBeenCalled();
      expect(hook.pendingPermission()).not.toBeNull();
    });

    it("should NOT auto-allow when mode is 'request'", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      modeSignal[1]("request");
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);

      expect(mockRespondToPermission).not.toHaveBeenCalled();
      expect(hook.pendingPermission()).not.toBeNull();
    });
  });

  // ============================================================================
  // Allow Handler
  // ============================================================================

  describe("handlePermissionAllow", () => {
    it("should call sendPermissionResponse for control-source permissions", async () => {
      const hook = createHook();
      const toolInput = { command: "test" };
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput,
        description: "Test",
        source: "control",
      });

      await hook.handlePermissionAllow(false);

      // source: "control" uses stream-based sendPermissionResponse
      expect(mockSendPermissionResponse).toHaveBeenCalledWith("test-id", true, false, toolInput);
    });

    it("should clear pendingPermission after allow", async () => {
      const hook = createHook();
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput: {},
        description: "Test",
        source: "control",
      });

      await hook.handlePermissionAllow(false);

      expect(hook.pendingPermission()).toBeNull();
    });

    it("should do nothing if no pending permission", async () => {
      const hook = createHook();

      await hook.handlePermissionAllow(false);

      expect(mockSendPermissionResponse).not.toHaveBeenCalled();
      expect(mockRespondToPermission).not.toHaveBeenCalled();
    });

    it("should pass remember parameter to sendPermissionResponse", async () => {
      const hook = createHook();
      const toolInput = { command: "test" };
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput,
        description: "Test",
        source: "control",
      });

      await hook.handlePermissionAllow(true);

      expect(mockSendPermissionResponse).toHaveBeenCalledWith("test-id", true, true, toolInput);
    });

    it("should use file-based response for hook-source permissions", async () => {
      const hook = createHook();
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput: {},
        description: "Test",
        source: "hook",
      });

      await hook.handlePermissionAllow(false);

      expect(mockRespondToPermission).toHaveBeenCalledWith(true);
      expect(mockSendPermissionResponse).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Deny Handler
  // ============================================================================

  describe("handlePermissionDeny", () => {
    it("should call sendPermissionResponse for control-source permissions", async () => {
      const hook = createHook();
      const toolInput = { command: "test" };
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput,
        description: "Test",
        source: "control",
      });

      await hook.handlePermissionDeny();

      // source: "control" uses stream-based sendPermissionResponse
      expect(mockSendPermissionResponse).toHaveBeenCalledWith("test-id", false, false, toolInput);
    });

    it("should clear pendingPermission after deny", async () => {
      const hook = createHook();
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput: {},
        description: "Test",
        source: "control",
      });

      await hook.handlePermissionDeny();

      expect(hook.pendingPermission()).toBeNull();
    });

    it("should do nothing if no pending permission", async () => {
      const hook = createHook();

      await hook.handlePermissionDeny();

      expect(mockSendPermissionResponse).not.toHaveBeenCalled();
      expect(mockRespondToPermission).not.toHaveBeenCalled();
    });

    it("should use file-based response for hook-source permissions", async () => {
      const hook = createHook();
      hook.setPendingPermission({
        requestId: "test-id",
        toolName: "Test",
        toolInput: {},
        description: "Test",
        source: "hook",
      });

      await hook.handlePermissionDeny();

      expect(mockRespondToPermission).toHaveBeenCalledWith(false, "User denied permission");
      expect(mockSendPermissionResponse).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe("full workflow", () => {
    it("should handle complete permission allow flow (hook-based polling)", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      const hook = createHook();

      // Start polling
      hook.startPolling();

      // Request comes in - polling sets source: "hook"
      await vi.advanceTimersByTimeAsync(200);
      expect(hook.pendingPermission()).not.toBeNull();
      expect(hook.pendingPermission()?.source).toBe("hook");

      // User allows - uses file-based respondToPermission for hook source
      await hook.handlePermissionAllow(false);
      expect(hook.pendingPermission()).toBeNull();
      expect(mockRespondToPermission).toHaveBeenCalledWith(true);
    });

    it("should handle complete permission deny flow (hook-based polling)", async () => {
      vi.mocked(mockPollPermissionRequest).mockResolvedValue(sampleRequest);
      const hook = createHook();

      hook.startPolling();
      await vi.advanceTimersByTimeAsync(200);
      expect(hook.pendingPermission()?.source).toBe("hook");

      await hook.handlePermissionDeny();

      expect(hook.pendingPermission()).toBeNull();
      expect(mockRespondToPermission).toHaveBeenCalledWith(false, "User denied permission");
    });

    it("should handle complete control-based permission allow flow", async () => {
      const hook = createHook();
      const toolInput = { command: "test" };

      // Simulate control-based permission request (from stream event)
      hook.setPendingPermission({
        requestId: "control-request-id",
        toolName: "Bash",
        toolInput,
        description: "Allow Bash?",
        source: "control",
      });

      expect(hook.pendingPermission()).not.toBeNull();

      // User allows - uses stream-based sendPermissionResponse for control source
      await hook.handlePermissionAllow(true);
      expect(hook.pendingPermission()).toBeNull();
      expect(mockSendPermissionResponse).toHaveBeenCalledWith("control-request-id", true, true, toolInput);
    });
  });
});
