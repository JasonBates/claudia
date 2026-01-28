import { createRoot, createSignal } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSidebar, UseSidebarReturn } from "../hooks/useSidebar";
import type { SessionEntry } from "../lib/types";

// Mock the tauri module
vi.mock("../lib/tauri", () => ({
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
}));

// Import mocked functions
import {
  listSessions as mockListSessions,
  deleteSession as mockDeleteSession,
} from "../lib/tauri";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
});

describe("useSidebar", () => {
  let dispose: () => void;

  // Sample session entries
  const sampleSessions: SessionEntry[] = [
    {
      sessionId: "session-1",
      fullPath: "/path/to/session-1.jsonl",
      fileMtime: Date.now(),
      firstPrompt: "Hello, can you help me?",
      messageCount: 5,
      created: "2024-01-15T10:00:00Z",
      modified: "2024-01-15T11:00:00Z",
      gitBranch: "main",
      projectPath: "/project",
      isSidechain: false,
    },
    {
      sessionId: "session-2",
      fullPath: "/path/to/session-2.jsonl",
      fileMtime: Date.now() - 100000,
      firstPrompt: "I need to fix a bug",
      messageCount: 10,
      created: "2024-01-14T10:00:00Z",
      modified: "2024-01-14T12:00:00Z",
      gitBranch: "feature/fix",
      projectPath: "/project",
      isSidechain: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();

    // Default: return sample sessions
    vi.mocked(mockListSessions).mockResolvedValue(sampleSessions);
    vi.mocked(mockDeleteSession).mockResolvedValue(undefined);
  });

  afterEach(() => {
    dispose?.();
  });

  const createHook = (workingDir: string | null = "/test/project") => {
    let hook: UseSidebarReturn;
    let workingDirSignal: ReturnType<typeof createSignal<string | null>>;

    createRoot((d) => {
      dispose = d;
      workingDirSignal = createSignal<string | null>(workingDir);
      hook = useSidebar({
        owner: null,
        workingDir: workingDirSignal[0],
      });
    });

    return {
      hook: hook!,
      setWorkingDir: workingDirSignal![1],
    };
  };

  // ============================================================================
  // Initialization
  // ============================================================================

  describe("initialization", () => {
    it("should start with collapsed=true", () => {
      const { hook } = createHook();
      expect(hook.collapsed()).toBe(true);
    });

    it("should start with empty sessions", () => {
      const { hook } = createHook();
      expect(hook.sessions()).toEqual([]);
    });

    it("should start with isLoading=false", () => {
      const { hook } = createHook();
      expect(hook.isLoading()).toBe(false);
    });

    it("should start with null error", () => {
      const { hook } = createHook();
      expect(hook.error()).toBeNull();
    });
  });

  // ============================================================================
  // Toggle Sidebar
  // ============================================================================

  describe("toggleSidebar", () => {
    it("should toggle collapsed from true to false", () => {
      const { hook } = createHook();
      expect(hook.collapsed()).toBe(true);

      hook.toggleSidebar();

      expect(hook.collapsed()).toBe(false);
    });

    it("should toggle collapsed from false to true", () => {
      const { hook } = createHook();
      hook.toggleSidebar(); // Now false
      expect(hook.collapsed()).toBe(false);

      hook.toggleSidebar(); // Now true

      expect(hook.collapsed()).toBe(true);
    });

    it("should persist collapsed state to localStorage", () => {
      const { hook } = createHook();

      hook.toggleSidebar();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "claudia-sidebar-collapsed",
        "false"
      );
    });

    it("should load sessions when expanding if not already loaded", async () => {
      const { hook } = createHook();

      hook.toggleSidebar(); // Expand

      // Wait for async loadSessions
      await new Promise((r) => setTimeout(r, 0));

      expect(mockListSessions).toHaveBeenCalledWith("/test/project");
    });

    it("should NOT load sessions when collapsing", async () => {
      const { hook } = createHook();
      hook.toggleSidebar(); // Expand
      await new Promise((r) => setTimeout(r, 0));
      vi.clearAllMocks();

      hook.toggleSidebar(); // Collapse

      expect(mockListSessions).not.toHaveBeenCalled();
    });

    it("should NOT load sessions again if already loaded", async () => {
      const { hook } = createHook();

      // First expand - loads sessions
      hook.toggleSidebar();
      await new Promise((r) => setTimeout(r, 0));
      expect(mockListSessions).toHaveBeenCalledTimes(1);

      // Collapse and expand again
      hook.toggleSidebar();
      hook.toggleSidebar();
      await new Promise((r) => setTimeout(r, 0));

      // Should NOT have called listSessions again
      expect(mockListSessions).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Open Sidebar
  // ============================================================================

  describe("openSidebar", () => {
    it("should set collapsed to false", () => {
      const { hook } = createHook();

      hook.openSidebar();

      expect(hook.collapsed()).toBe(false);
    });

    it("should persist state to localStorage", () => {
      const { hook } = createHook();

      hook.openSidebar();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "claudia-sidebar-collapsed",
        "false"
      );
    });

    it("should load sessions if not already loaded", async () => {
      const { hook } = createHook();

      hook.openSidebar();
      await new Promise((r) => setTimeout(r, 0));

      expect(mockListSessions).toHaveBeenCalled();
    });

    it("should do nothing if already open", async () => {
      const { hook } = createHook();

      hook.openSidebar();
      await new Promise((r) => setTimeout(r, 0));
      vi.clearAllMocks();

      hook.openSidebar(); // Already open

      expect(mockListSessions).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Load Sessions
  // ============================================================================

  describe("loadSessions", () => {
    it("should set isLoading while loading", async () => {
      const { hook } = createHook();
      let capturedLoading = false;

      vi.mocked(mockListSessions).mockImplementation(async () => {
        capturedLoading = hook.isLoading();
        return sampleSessions;
      });

      await hook.loadSessions();

      expect(capturedLoading).toBe(true);
      expect(hook.isLoading()).toBe(false);
    });

    it("should populate sessions on success", async () => {
      const { hook } = createHook();

      await hook.loadSessions();

      expect(hook.sessions()).toEqual(sampleSessions);
    });

    it("should set error on failure", async () => {
      const { hook } = createHook();
      vi.mocked(mockListSessions).mockRejectedValue(new Error("Network error"));

      await hook.loadSessions();

      expect(hook.error()).toBe("Network error");
    });

    it("should clear error on new attempt", async () => {
      const { hook } = createHook();

      // First call fails
      vi.mocked(mockListSessions).mockRejectedValueOnce(new Error("First error"));
      await hook.loadSessions();
      expect(hook.error()).toBe("First error");

      // Second call succeeds
      vi.mocked(mockListSessions).mockResolvedValueOnce(sampleSessions);
      await hook.loadSessions();

      expect(hook.error()).toBeNull();
    });

    it("should skip if no working directory", async () => {
      const { hook } = createHook(null);

      await hook.loadSessions();

      expect(mockListSessions).not.toHaveBeenCalled();
    });

    it("should call listSessions with working directory", async () => {
      const { hook } = createHook("/my/project");

      await hook.loadSessions();

      expect(mockListSessions).toHaveBeenCalledWith("/my/project");
    });
  });

  // ============================================================================
  // Delete Session
  // ============================================================================

  describe("handleDeleteSession", () => {
    it("should call deleteSession with session ID and working dir", async () => {
      const { hook } = createHook();
      // Pre-load sessions
      await hook.loadSessions();

      await hook.handleDeleteSession("session-1");

      expect(mockDeleteSession).toHaveBeenCalledWith("session-1", "/test/project");
    });

    it("should remove deleted session from local state immediately", async () => {
      const { hook } = createHook();
      await hook.loadSessions();
      expect(hook.sessions()).toHaveLength(2);

      await hook.handleDeleteSession("session-1");

      expect(hook.sessions()).toHaveLength(1);
      expect(hook.sessions()[0].sessionId).toBe("session-2");
    });

    it("should set error on delete failure", async () => {
      const { hook } = createHook();
      vi.mocked(mockDeleteSession).mockRejectedValue(new Error("Delete failed"));

      await hook.handleDeleteSession("session-1");

      expect(hook.error()).toBe("Delete failed");
    });

    it("should skip if no working directory", async () => {
      const { hook } = createHook(null);

      await hook.handleDeleteSession("session-1");

      expect(mockDeleteSession).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Full Workflow
  // ============================================================================

  describe("full workflow", () => {
    it("should handle complete open-load-delete flow", async () => {
      const { hook } = createHook();

      // Open sidebar
      hook.openSidebar();
      await new Promise((r) => setTimeout(r, 0));

      expect(hook.collapsed()).toBe(false);
      expect(hook.sessions()).toEqual(sampleSessions);

      // Delete a session
      await hook.handleDeleteSession("session-1");

      expect(hook.sessions()).toHaveLength(1);
      expect(mockDeleteSession).toHaveBeenCalledWith("session-1", "/test/project");
    });

    it("should handle toggle-load flow", async () => {
      const { hook } = createHook();

      // Toggle to open
      hook.toggleSidebar();
      await new Promise((r) => setTimeout(r, 0));

      expect(hook.collapsed()).toBe(false);
      expect(hook.sessions()).toHaveLength(2);

      // Toggle to close
      hook.toggleSidebar();

      expect(hook.collapsed()).toBe(true);
      // Sessions should still be populated
      expect(hook.sessions()).toHaveLength(2);
    });
  });

  // ============================================================================
  // localStorage Handling
  // ============================================================================

  describe("localStorage error handling", () => {
    it("should handle localStorage errors gracefully", () => {
      const { hook } = createHook();
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error("Storage full");
      });

      // Should not throw
      hook.toggleSidebar();

      expect(hook.collapsed()).toBe(false);
    });
  });
});
