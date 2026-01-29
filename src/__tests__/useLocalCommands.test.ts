import { createRoot, createSignal } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useLocalCommands,
  UseLocalCommandsReturn,
  Command,
  UseStreamingMessagesReturn,
} from "../hooks/useLocalCommands";
import type { UseSessionReturn } from "../hooks/useSession";
import type { UseSidebarReturn } from "../hooks/useSidebar";
import type { Message, ToolUse, ContentBlock, SessionEntry } from "../lib/types";
import type { SessionInfo } from "../lib/event-handlers";

// Mock the tauri module
vi.mock("../lib/tauri", () => ({
  runStreamingCommand: vi.fn(),
  clearSession: vi.fn(),
  sendInterrupt: vi.fn(),
  quitApp: vi.fn(),
}));

// Import mocked functions
import {
  runStreamingCommand as mockRunStreamingCommand,
  clearSession as mockClearSession,
  sendInterrupt as mockSendInterrupt,
  quitApp as mockQuitApp,
} from "../lib/tauri";

/**
 * Create a minimal mock of UseStreamingMessagesReturn for testing
 */
function createMockStreaming(): UseStreamingMessagesReturn {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [currentToolUses, setCurrentToolUses] = createSignal<ToolUse[]>([]);
  const [streamingBlocks, setStreamingBlocks] = createSignal<ContentBlock[]>([]);
  const [streamingThinking, setStreamingThinking] = createSignal("");
  const [showThinking, setShowThinking] = createSignal(false);

  return {
    messages,
    setMessages,
    streamingContent,
    setStreamingContent,
    isLoading,
    setIsLoading,
    error,
    setError,
    currentToolUses,
    setCurrentToolUses,
    streamingBlocks,
    setStreamingBlocks,
    streamingThinking,
    setStreamingThinking,
    showThinking,
    setShowThinking,
    toolInputRef: { current: "" },
    todoJsonRef: { current: "" },
    questionJsonRef: { current: "" },
    isCollectingTodoRef: { current: false },
    isCollectingQuestionRef: { current: false },
    pendingResultsRef: { current: new Map() },
    generateId: () => `msg-${Date.now()}`,
    finishStreaming: vi.fn(),
    resetStreamingState: vi.fn(),
  };
}

/**
 * Create a minimal mock of UseSessionReturn for testing
 */
function createMockSession(): UseSessionReturn {
  const [sessionActive, setSessionActive] = createSignal(true);
  const [launchDir] = createSignal<string | null>("/launch");
  const [workingDir] = createSignal<string | null>("/work");
  const [sessionInfo, setSessionInfo] = createSignal<SessionInfo>({});
  const [sessionError] = createSignal<string | null>(null);
  const [launchSessionId, setLaunchSessionId] = createSignal<string | null>(null);

  return {
    sessionActive,
    setSessionActive,
    launchDir,
    workingDir,
    sessionInfo,
    setSessionInfo,
    sessionError,
    launchSessionId,
    setLaunchSessionId,
    startSession: vi.fn(),
  };
}

/**
 * Create a minimal mock of UseSidebarReturn for testing
 */
function createMockSidebar(): UseSidebarReturn {
  const [collapsed, setCollapsed] = createSignal(true);
  const [sessions] = createSignal<SessionEntry[]>([]);
  const [isLoading] = createSignal(false);
  const [error] = createSignal<string | null>(null);

  return {
    collapsed,
    toggleSidebar: vi.fn(() => setCollapsed((prev) => !prev)),
    openSidebar: vi.fn(() => setCollapsed(false)),
    sessions,
    isLoading,
    error,
    loadSessions: vi.fn(),
    handleDeleteSession: vi.fn(),
  };
}

describe("useLocalCommands", () => {
  let dispose: () => void;
  let streaming: UseStreamingMessagesReturn;
  let session: UseSessionReturn;
  let sidebar: UseSidebarReturn;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mocks for each test
    createRoot((d) => {
      dispose = d;
      streaming = createMockStreaming();
      session = createMockSession();
      sidebar = createMockSidebar();
    });
  });

  afterEach(() => {
    dispose?.();
  });

  const createHook = (options?: { skipSidebar?: boolean }) => {
    let hook: UseLocalCommandsReturn;
    createRoot((d) => {
      const prevDispose = dispose;
      dispose = () => {
        prevDispose?.();
        d();
      };
      hook = useLocalCommands({
        streaming,
        session,
        sidebar: options?.skipSidebar ? undefined : sidebar,
        owner: null,
      });
    });
    return hook!;
  };

  // ============================================================================
  // Commands Registry
  // ============================================================================

  describe("commands registry", () => {
    it("should have all expected commands", () => {
      const hook = createHook();
      const commandNames = hook.commands().map((c: Command) => c.name);

      expect(commandNames).toContain("clear");
      expect(commandNames).toContain("sync");
      expect(commandNames).toContain("thinking");
      expect(commandNames).toContain("sidebar");
      expect(commandNames).toContain("resume");
      expect(commandNames).toContain("exit");
      expect(commandNames).toContain("quit");
      expect(commandNames).toContain("x");
      expect(commandNames).toContain("q");
    });

    it("should have descriptions for all commands", () => {
      const hook = createHook();

      for (const cmd of hook.commands()) {
        expect(cmd.description).toBeDefined();
        expect(cmd.description.length).toBeGreaterThan(0);
      }
    });

    it("should have handlers for all commands", () => {
      const hook = createHook();

      for (const cmd of hook.commands()) {
        expect(typeof cmd.handler).toBe("function");
      }
    });

    it("should have keybindings for some commands", () => {
      const hook = createHook();
      const commandsWithKeybindings = hook.commands().filter((c: Command) => c.keybinding);

      expect(commandsWithKeybindings.length).toBeGreaterThan(0);

      // Check specific keybindings
      const thinkingCmd = hook.commands().find((c: Command) => c.name === "thinking");
      expect(thinkingCmd?.keybinding).toBe("alt+t");

      const sidebarCmd = hook.commands().find((c: Command) => c.name === "sidebar");
      expect(sidebarCmd?.keybinding).toBe("cmd+shift+[");

      const exitCmd = hook.commands().find((c: Command) => c.name === "exit");
      expect(exitCmd?.keybinding).toBe("alt+q");
    });
  });

  // ============================================================================
  // dispatch - Slash Command Routing
  // ============================================================================

  describe("dispatch", () => {
    it("should return false for non-slash commands", async () => {
      const hook = createHook();

      const result = await hook.dispatch("hello world");

      expect(result).toBe(false);
    });

    it("should return false for unknown slash commands", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/unknown");

      expect(result).toBe(false);
    });

    it("should return true and handle /clear", async () => {
      const hook = createHook();
      vi.mocked(mockClearSession).mockResolvedValue(undefined);

      const result = await hook.dispatch("/clear");

      expect(result).toBe(true);
      expect(mockClearSession).toHaveBeenCalled();
    });

    it("should return true and handle /sync", async () => {
      const hook = createHook();
      vi.mocked(mockRunStreamingCommand).mockResolvedValue("cmd-123");

      const result = await hook.dispatch("/sync");

      expect(result).toBe(true);
      expect(mockRunStreamingCommand).toHaveBeenCalledWith(
        "ccms",
        expect.any(Array),
        expect.any(Function),
        undefined,
        null
      );
    });

    it("should return true and handle /thinking", async () => {
      const hook = createHook();

      const initialShowThinking = streaming.showThinking();
      const result = await hook.dispatch("/thinking");

      expect(result).toBe(true);
      expect(streaming.showThinking()).toBe(!initialShowThinking);
    });

    it("should return true and handle /sidebar", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/sidebar");

      expect(result).toBe(true);
      expect(sidebar.toggleSidebar).toHaveBeenCalled();
    });

    it("should return true and handle /resume", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/resume");

      expect(result).toBe(true);
      expect(sidebar.openSidebar).toHaveBeenCalled();
    });

    it("should return true and handle /exit", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/exit");

      expect(result).toBe(true);
      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should return true and handle /quit", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/quit");

      expect(result).toBe(true);
      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should return true and handle /x", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/x");

      expect(result).toBe(true);
      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should return true and handle /q", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/q");

      expect(result).toBe(true);
      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should be case insensitive", async () => {
      const hook = createHook();

      const result = await hook.dispatch("/CLEAR");

      expect(result).toBe(true);
    });

    it("should trim whitespace", async () => {
      const hook = createHook();

      const result = await hook.dispatch("  /clear  ");

      expect(result).toBe(true);
    });

    it("should handle errors gracefully", async () => {
      const hook = createHook();
      vi.mocked(mockClearSession).mockRejectedValue(new Error("Test error"));

      const result = await hook.dispatch("/clear");

      expect(result).toBe(true);
      // Error should be set (check the signal value)
      expect(streaming.error()).toContain("Test error");
    });
  });

  // ============================================================================
  // handleKeyDown - Keyboard Shortcuts
  // ============================================================================

  describe("handleKeyDown", () => {
    const createKeyEvent = (
      key: string,
      options: {
        altKey?: boolean;
        ctrlKey?: boolean;
        metaKey?: boolean;
        shiftKey?: boolean;
        code?: string;
      } = {}
    ): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        key,
        code: options.code || `Key${key.toUpperCase()}`,
        altKey: options.altKey || false,
        ctrlKey: options.ctrlKey || false,
        metaKey: options.metaKey || false,
        shiftKey: options.shiftKey || false,
      });

      // Make preventDefault and stopPropagation mockable
      vi.spyOn(event, "preventDefault");
      vi.spyOn(event, "stopPropagation");

      return event;
    };

    it("should return false for unmatched key events", () => {
      const hook = createHook();
      const event = createKeyEvent("a");

      const result = hook.handleKeyDown(event);

      expect(result).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("should handle Alt+T for thinking toggle", () => {
      const hook = createHook();
      const event = createKeyEvent("t", { altKey: true });

      const result = hook.handleKeyDown(event);

      expect(result).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it("should handle Alt+Q for quit", () => {
      const hook = createHook();
      const event = createKeyEvent("q", { altKey: true });

      const result = hook.handleKeyDown(event);

      expect(result).toBe(true);
      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should handle Cmd+Shift+[ for sidebar toggle", () => {
      const hook = createHook();
      const event = createKeyEvent("[", { metaKey: true, shiftKey: true });

      const result = hook.handleKeyDown(event);

      expect(result).toBe(true);
      expect(sidebar.toggleSidebar).toHaveBeenCalled();
    });

    it("should handle Escape when loading to interrupt", async () => {
      // Need to set isLoading to true
      createRoot((d) => {
        dispose = d;
        streaming = createMockStreaming();
        (streaming.isLoading as unknown as { (): boolean; (v: boolean): void })(true);
        // Actually set the value by calling the setter
      });

      // Recreate with loading state
      let loadingStreaming: UseStreamingMessagesReturn;
      createRoot((d) => {
        dispose = d;
        const [isLoading, setIsLoading] = createSignal(true);
        loadingStreaming = {
          ...createMockStreaming(),
          isLoading,
          setIsLoading,
        };
        session = createMockSession();
        sidebar = createMockSidebar();
      });

      let hook: UseLocalCommandsReturn;
      createRoot((_d) => {
        hook = useLocalCommands({
          streaming: loadingStreaming!,
          session,
          sidebar,
          owner: null,
        });
      });

      vi.mocked(mockSendInterrupt).mockResolvedValue(undefined);
      const event = createKeyEvent("Escape");

      const result = hook!.handleKeyDown(event);

      expect(result).toBe(true);
      expect(mockSendInterrupt).toHaveBeenCalled();
    });

    it("should ignore Escape when not loading", () => {
      const hook = createHook();
      const event = createKeyEvent("Escape");

      const result = hook.handleKeyDown(event);

      expect(result).toBe(false);
      expect(mockSendInterrupt).not.toHaveBeenCalled();
    });

    it("should handle macOS option key producing special characters", () => {
      const hook = createHook();
      // On macOS, Alt+T produces "†" as the key value
      const event = createKeyEvent("†", { altKey: true, code: "KeyT" });

      const result = hook.handleKeyDown(event);

      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // /clear Command
  // ============================================================================

  describe("/clear command", () => {
    it("should set loading state during clear", async () => {
      const hook = createHook();
      vi.mocked(mockClearSession).mockImplementation(async () => {
        // Should be loading at this point
        expect(streaming.isLoading()).toBe(true);
      });

      await hook.dispatch("/clear");
    });

    it("should call clearSession with event handler", async () => {
      const hook = createHook();
      vi.mocked(mockClearSession).mockResolvedValue(undefined);

      await hook.dispatch("/clear");

      expect(mockClearSession).toHaveBeenCalledWith(
        expect.any(Function),
        null
      );
    });
  });

  // ============================================================================
  // /sync Command
  // ============================================================================

  describe("/sync command", () => {
    it("should add sync message to messages", async () => {
      const hook = createHook();
      vi.mocked(mockRunStreamingCommand).mockResolvedValue("cmd-123");

      await hook.dispatch("/sync");

      // Should have added a message (check the signal value)
      expect(streaming.messages().length).toBeGreaterThan(0);
    });

    it("should run ccms with correct arguments", async () => {
      const hook = createHook();
      vi.mocked(mockRunStreamingCommand).mockResolvedValue("cmd-123");

      await hook.dispatch("/sync");

      expect(mockRunStreamingCommand).toHaveBeenCalledWith(
        "ccms",
        ["--force", "--fast", "--verbose", "sync"],
        expect.any(Function),
        undefined,
        null
      );
    });
  });

  // ============================================================================
  // /thinking Command
  // ============================================================================

  describe("/thinking command", () => {
    it("should toggle showThinking from false to true", async () => {
      const hook = createHook();
      streaming.setShowThinking(false);

      await hook.dispatch("/thinking");

      expect(streaming.showThinking()).toBe(true);
    });

    it("should toggle showThinking from true to false", async () => {
      const hook = createHook();
      streaming.setShowThinking(true);

      await hook.dispatch("/thinking");

      expect(streaming.showThinking()).toBe(false);
    });
  });

  // ============================================================================
  // /sidebar and /resume Commands
  // ============================================================================

  describe("/sidebar command", () => {
    it("should toggle sidebar", async () => {
      const hook = createHook();

      await hook.dispatch("/sidebar");

      expect(sidebar.toggleSidebar).toHaveBeenCalled();
    });

    it("should handle missing sidebar gracefully", async () => {
      const hook = createHook({ skipSidebar: true });

      // Should not throw
      const result = await hook.dispatch("/sidebar");

      expect(result).toBe(true);
    });
  });

  describe("/resume command", () => {
    it("should open sidebar", async () => {
      const hook = createHook();

      await hook.dispatch("/resume");

      expect(sidebar.openSidebar).toHaveBeenCalled();
    });

    it("should handle missing sidebar gracefully", async () => {
      const hook = createHook({ skipSidebar: true });

      // Should not throw
      const result = await hook.dispatch("/resume");

      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Exit Commands
  // ============================================================================

  describe("exit commands", () => {
    it("should quit on /exit", async () => {
      const hook = createHook();

      await hook.dispatch("/exit");

      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should quit on /quit", async () => {
      const hook = createHook();

      await hook.dispatch("/quit");

      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should quit on /x", async () => {
      const hook = createHook();

      await hook.dispatch("/x");

      expect(mockQuitApp).toHaveBeenCalled();
    });

    it("should quit on /q", async () => {
      const hook = createHook();

      await hook.dispatch("/q");

      expect(mockQuitApp).toHaveBeenCalled();
    });
  });
});
