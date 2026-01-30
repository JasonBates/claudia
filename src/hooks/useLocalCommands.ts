import { Accessor, Owner, Setter } from "solid-js";
import type { UseSessionReturn } from "./useSession";
import type { UseSidebarReturn } from "./useSidebar";
import { runStreamingCommand, CommandEvent, ClaudeEvent, clearSession, sendInterrupt, quitApp } from "../lib/tauri";
import type { Message, ToolUse, ContentBlock } from "../lib/types";

// Streaming messages interface - defined locally since there's no separate hook
export interface UseStreamingMessagesReturn {
  messages: Accessor<Message[]>;
  setMessages: Setter<Message[]>;
  streamingContent: Accessor<string>;
  setStreamingContent?: Setter<string>;
  isLoading: Accessor<boolean>;
  setIsLoading: Setter<boolean>;
  error: Accessor<string | null>;
  setError: Setter<string | null>;
  currentToolUses: Accessor<ToolUse[]>;
  setCurrentToolUses?: Setter<ToolUse[]>;
  streamingBlocks: Accessor<ContentBlock[]>;
  setStreamingBlocks?: Setter<ContentBlock[]>;
  streamingThinking: Accessor<string>;
  setStreamingThinking?: Setter<string>;
  showThinking: Accessor<boolean>;
  setShowThinking: Setter<boolean>;
  toolInputRef?: { current: string };
  todoJsonRef?: { current: string };
  questionJsonRef?: { current: string };
  isCollectingTodoRef?: { current: boolean };
  isCollectingQuestionRef?: { current: boolean };
  pendingResultsRef?: { current: Map<string, { result: string; isError: boolean }> };
  generateId: () => string;
  finishStreaming: (interrupted?: boolean) => void;
  resetStreamingState: () => void;
}

// ============================================================================
// Types
// ============================================================================

export interface Command {
  name: string;           // e.g., "clear", "sync", "resume"
  description: string;    // For /help listing
  handler: () => Promise<void>;
  keybinding?: string;    // e.g., "cmd+k", "alt+t", "shift+enter"
}

export interface UseLocalCommandsOptions {
  streaming: UseStreamingMessagesReturn;
  session: UseSessionReturn;
  owner: Owner | null;
  /**
   * Sidebar hook for toggle command. Optional.
   */
  sidebar?: UseSidebarReturn;
  /**
   * Callback to process CLI events (for commands that talk to CLI).
   * This should be the same handler used for normal message submission.
   */
  onCliEvent?: (event: ClaudeEvent) => void;
  /**
   * Callback to open settings modal.
   */
  onOpenSettings?: () => void;
  /**
   * Callback to focus the command input.
   */
  onFocusInput?: () => void;
}

export interface UseLocalCommandsReturn {
  dispatch: (text: string) => Promise<boolean>;  // true = handled locally
  handleKeyDown: (e: KeyboardEvent) => boolean;  // true = handled
  commands: Accessor<Command[]>;                  // For /help listing
}

// ============================================================================
// Keybinding Parser
// ============================================================================

interface ParsedKeybinding {
  key: string;      // The main key (lowercase)
  alt: boolean;
  ctrl: boolean;
  meta: boolean;    // Cmd on Mac
  shift: boolean;
}

/**
 * Parse a keybinding string like "alt+t" or "cmd+k" into structured form.
 * Supports: alt, ctrl, cmd/meta, shift + any key
 */
function parseKeybinding(keybinding: string): ParsedKeybinding {
  const parts = keybinding.toLowerCase().split("+");
  const result: ParsedKeybinding = {
    key: "",
    alt: false,
    ctrl: false,
    meta: false,
    shift: false,
  };

  for (const part of parts) {
    switch (part) {
      case "alt":
      case "option":
        result.alt = true;
        break;
      case "ctrl":
      case "control":
        result.ctrl = true;
        break;
      case "cmd":
      case "meta":
      case "command":
        result.meta = true;
        break;
      case "shift":
        result.shift = true;
        break;
      default:
        result.key = part;
    }
  }

  return result;
}

/**
 * Check if a KeyboardEvent matches a parsed keybinding.
 */
function matchesKeybinding(e: KeyboardEvent, binding: ParsedKeybinding): boolean {
  // Check modifiers
  if (binding.alt !== e.altKey) return false;
  if (binding.ctrl !== e.ctrlKey) return false;
  if (binding.meta !== e.metaKey) return false;
  if (binding.shift !== e.shiftKey) return false;

  // Check key (handle special cases)
  const eventKey = e.key.toLowerCase();
  const eventCode = e.code.toLowerCase();

  // Direct match
  if (eventKey === binding.key) return true;

  // Handle macOS option key producing special characters (e.g., opt+t = †)
  // eventCode is already lowercased, so compare to lowercase key
  if (binding.alt && eventCode === `key${binding.key}`) return true;

  return false;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Central hook for local slash commands and keyboard shortcuts.
 *
 * Provides:
 * - Command registry with descriptions (for /help)
 * - dispatch(text) for slash command handling
 * - handleKeyDown(e) for keyboard shortcuts
 * - Unified system: commands can have both slash and keybinding
 */
export function useLocalCommands(options: UseLocalCommandsOptions): UseLocalCommandsReturn {
  const { streaming, session, owner, sidebar, onCliEvent, onOpenSettings, onFocusInput } = options;

  // ==========================================================================
  // Command Handlers
  // ==========================================================================

  /**
   * Handle /clear command - clear conversation by generating new session ID
   *
   * This is a hybrid approach that mirrors Claude Code's instant /clear:
   * - The bridge generates a new session_id without restarting the process
   * - Subsequent messages are treated as a new conversation
   * - System prompt, MCP servers, and tools remain loaded (instant response)
   *
   * Flow:
   * 1. Call clearSession() which kills and respawns the Claude process
   * 2. Wait for ready event from new process
   * 3. UI fades existing messages and shows divider
   */
  const handleClear = async () => {
    console.log(`[CLEAR] Starting clear (process restart)`);

    // Block input while clearing
    streaming.setIsLoading(true);

    // Track completion state
    let completed = false;

    try {
      // Clear session by restarting the Claude process
      await clearSession(
        (event: ClaudeEvent) => {
          console.log(`[CLEAR] Event: ${event.type}`, event);

          // On completion, fade existing messages and show divider (only once)
          if (event.type === "done" && !completed) {
            completed = true;

            // Create divider message
            const dividerMsg: Message = {
              id: `clear-divider-${Date.now()}`,
              role: "system",
              content: "",
              variant: "cleared",
            };

            // Mark all existing messages as faded, then add the divider
            streaming.setMessages((prev) => [
              ...prev.map(m => ({ ...m, faded: true })),
              dividerMsg
            ]);

            // Reset context display - conversation history is cleared
            session.setSessionInfo((prev) => ({
              ...prev,
              totalContext: prev.baseContext || 0,
            }));

            console.log(`[CLEAR] Complete - process restarted`);
          }

          // Forward to main event handler for other processing
          onCliEvent?.(event);
        },
        owner
      );
    } catch (e) {
      console.error("[CLEAR] Error:", e);
      streaming.setError(`Clear failed: ${e}`);
    } finally {
      streaming.setIsLoading(false);
    }
  };

  /**
   * Handle /sync command - pull and push ~/.claude config
   */
  const handleSync = async () => {
    const syncMsgId = `sync-${Date.now()}`;
    const syncToolId = `sync-tool-${Date.now()}`;

    // Helper to update the sync tool result
    const updateSyncResult = (text: string, loading: boolean = true) => {
      streaming.setMessages((prev) =>
        prev.map((m) =>
          m.id === syncMsgId
            ? {
                ...m,
                toolUses: m.toolUses?.map((t) =>
                  t.id === syncToolId
                    ? {
                        ...t,
                        isLoading: loading,
                        result: text,
                        autoExpanded: !loading ? true : t.autoExpanded,
                      }
                    : t
                ),
              }
            : m
        )
      );
    };

    // Block input while syncing
    streaming.setIsLoading(true);

    // Add message with loading state
    streaming.setMessages((prev) => [
      ...prev,
      {
        id: syncMsgId,
        role: "assistant",
        content: "",
        toolUses: [
          {
            id: syncToolId,
            name: "Sync",
            input: { operation: "pull & push" },
            isLoading: true,
            result: "",
          },
        ],
      },
    ]);

    let output = "";

    try {
      console.log("[SYNC] Starting bidirectional sync...");

      // Use ccms sync which does push-then-pull safely
      output = "▶ Syncing (push then pull)...\n";
      updateSyncResult(output);

      await runStreamingCommand(
        "ccms",
        ["--force", "--fast", "--verbose", "sync"],
        (event: CommandEvent) => {
          if (event.type === "stdout" || event.type === "stderr") {
            output += (event.line || "") + "\n";
            updateSyncResult(output);
          } else if (event.type === "completed") {
            output += event.success ? "✓ Sync complete\n" : "✗ Sync failed\n";
            updateSyncResult(output, false);
          } else if (event.type === "error") {
            output += `✗ Sync error: ${event.message}\n`;
            updateSyncResult(output, false);
          }
        },
        undefined,
        owner
      );

      console.log("[SYNC] Bidirectional sync complete");
    } catch (e) {
      console.error("[SYNC] Streaming sync error:", e);
      output += `\n✗ Error: ${e}`;
      updateSyncResult(output, false);
    } finally {
      streaming.setIsLoading(false);
    }
  };

  /**
   * Handle Escape key - interrupt current response
   * Only works when streaming is in progress
   *
   * Note: Interrupted responses are NOT saved to the Claude session file,
   * so we mark them visually to indicate they won't be in Claude's memory.
   */
  const handleInterrupt = async () => {
    if (!streaming.isLoading()) {
      console.log("[INTERRUPT] Not loading, ignoring");
      return;
    }

    console.log("[INTERRUPT] Sending interrupt signal");

    // Immediately stop accepting new content to prevent stray text
    streaming.setIsLoading(false);

    try {
      await sendInterrupt();
      // The bridge will respawn Claude automatically
      // Finalize the message with interrupted=true for visual indicator
      streaming.finishStreaming(true);
    } catch (e) {
      console.error("[INTERRUPT] Error:", e);
      // Still finalize even on error so UI isn't stuck
      streaming.finishStreaming(true);
    }
  };

  /**
   * Toggle thinking display (Alt+T)
   */
  const handleToggleThinking = async () => {
    streaming.setShowThinking((prev) => !prev);
  };

  /**
   * Toggle sidebar visibility (Cmd+Shift+[)
   */
  const handleToggleSidebar = async () => {
    if (sidebar) {
      sidebar.toggleSidebar();
    }
  };

  /**
   * Open sidebar to show resumable sessions (/resume)
   */
  const handleResume = async () => {
    if (sidebar) {
      sidebar.openSidebar();
    }
  };

  /**
   * Quit the application (/exit, /quit, Alt+Q)
   */
  const handleQuit = async () => {
    console.log("[COMMANDS] Quitting application");
    await quitApp();
  };

  /**
   * Open settings modal (Cmd+,)
   */
  const handleOpenSettings = async () => {
    console.log("[COMMANDS] Opening settings");
    onOpenSettings?.();
  };

  /**
   * Focus the command input (Alt+L)
   */
  const handleFocusInput = async () => {
    console.log("[COMMANDS] Focusing input");
    onFocusInput?.();
  };

  // ==========================================================================
  // Command Registry
  // ==========================================================================

  const commands: Command[] = [
    {
      name: "clear",
      description: "Clear conversation history",
      handler: handleClear,
    },
    {
      name: "sync",
      description: "Sync ~/.claude between machines",
      handler: handleSync,
    },
    {
      name: "thinking",
      description: "Toggle thinking display",
      keybinding: "alt+t",
      handler: handleToggleThinking,
    },
    {
      name: "sidebar",
      description: "Toggle session sidebar",
      keybinding: "cmd+shift+[",
      handler: handleToggleSidebar,
    },
    {
      name: "resume",
      description: "Open sidebar to resume a session",
      handler: handleResume,
    },
    {
      name: "exit",
      description: "Close the application",
      keybinding: "alt+q",
      handler: handleQuit,
    },
    {
      name: "quit",
      description: "Close the application",
      handler: handleQuit,
    },
    {
      name: "x",
      description: "Close the application",
      handler: handleQuit,
    },
    {
      name: "q",
      description: "Close the application",
      handler: handleQuit,
    },
    {
      name: "settings",
      description: "Open appearance settings",
      keybinding: "cmd+,",
      handler: handleOpenSettings,
    },
    {
      name: "focus",
      description: "Focus the message input",
      keybinding: "alt+l",
      handler: handleFocusInput,
    },
  ];

  // Pre-parse keybindings for faster matching
  const keybindingMap = new Map<Command, ParsedKeybinding>();
  for (const cmd of commands) {
    if (cmd.keybinding) {
      keybindingMap.set(cmd, parseKeybinding(cmd.keybinding));
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Dispatch a slash command. Returns true if handled locally.
   */
  const dispatch = async (text: string): Promise<boolean> => {
    const trimmed = text.trim().toLowerCase();
    if (!trimmed.startsWith("/")) return false;

    const commandName = trimmed.slice(1).split(" ")[0];
    const command = commands.find((c) => c.name === commandName);
    if (!command) return false;

    console.log(`[COMMANDS] Dispatching /${command.name}`);
    try {
      await command.handler();
    } catch (e) {
      console.error(`[COMMANDS] Handler error for /${command.name}:`, e);
      streaming.setError(`Command error: ${e}`);
    }
    return true;
  };

  /**
   * Handle keyboard shortcuts. Returns true if handled.
   */
  const handleKeyDown = (e: KeyboardEvent): boolean => {
    // Special case: Escape key to interrupt (only when streaming)
    if (e.key === "Escape" && streaming.isLoading()) {
      console.log("[COMMANDS] Escape pressed - interrupting");
      e.preventDefault();
      e.stopPropagation();
      handleInterrupt();
      return true;
    }

    // Check registered keybindings
    for (const [cmd, binding] of keybindingMap) {
      if (matchesKeybinding(e, binding)) {
        console.log(`[COMMANDS] Keybinding matched: ${cmd.keybinding} -> /${cmd.name}`);
        e.preventDefault();
        e.stopPropagation();
        cmd.handler();
        return true;
      }
    }
    return false;
  };

  return {
    dispatch,
    handleKeyDown,
    commands: () => commands,
  };
}
