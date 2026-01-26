import { Accessor, Owner } from "solid-js";
import type { UseStreamingMessagesReturn } from "./useStreamingMessages";
import type { UseSessionReturn } from "./useSession";
import { runStreamingCommand, CommandEvent, ClaudeEvent, sendMessage } from "../lib/tauri";
import type { Message } from "../lib/types";

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
   * Callback to process CLI events (for commands that talk to CLI).
   * This should be the same handler used for normal message submission.
   */
  onCliEvent?: (event: ClaudeEvent) => void;
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
  const { streaming, session, owner, onCliEvent } = options;

  // ==========================================================================
  // Command Handlers
  // ==========================================================================

  /**
   * Handle /clear command - clear conversation and show divider with context sizes
   *
   * Flow:
   * 1. Capture pre-clear context size
   * 2. Show synthetic "Clearing..." tool UI with spinner
   * 3. Send /clear to CLI
   * 4. On completion, clear frontend messages and show divider
   */
  const handleClear = async () => {
    console.log(`[CLEAR] Starting clear`);

    // Block input while clearing
    streaming.setIsLoading(true);

    // Track post-clear context and completion state
    let postContext = 0;
    let completed = false;

    try {
      // Send /clear to CLI and process events
      await sendMessage(
        "/clear",
        (event: ClaudeEvent) => {
          console.log(`[CLEAR] Event: ${event.type}`, event);

          // Track context updates
          if (event.type === "context_update" && event.input_tokens) {
            postContext = event.input_tokens;
          }

          // On completion, fade existing messages and show divider (only once)
          if ((event.type === "result" || event.type === "done") && !completed) {
            completed = true;

            // Create divider message (no content needed, just shows "context cleared")
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

            // Reset context to base context (system prompt + tools)
            // After clear, conversation history is gone, only base context remains
            session.setSessionInfo((prev) => ({
              ...prev,
              totalContext: postContext > 0 ? postContext : (prev.baseContext || 0),
            }));

            console.log(`[CLEAR] Complete`);
          }

          // Also forward to main event handler for other processing
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
      console.log("[SYNC] Starting streaming sync...");

      // Pull phase with streaming
      output = "▶ Pulling from remote...\n";
      updateSyncResult(output);

      await runStreamingCommand(
        "ccms",
        ["--force", "--fast", "--verbose", "pull"],
        (event: CommandEvent) => {
          if (event.type === "stdout" || event.type === "stderr") {
            output += (event.line || "") + "\n";
            updateSyncResult(output);
          } else if (event.type === "completed") {
            output += event.success ? "✓ Pull complete\n" : "✗ Pull failed\n";
            updateSyncResult(output);
          } else if (event.type === "error") {
            output += `✗ Pull error: ${event.message}\n`;
            updateSyncResult(output);
          }
        },
        undefined,
        owner
      );

      // Push phase with streaming
      output += "\n▶ Pushing to remote...\n";
      updateSyncResult(output);

      await runStreamingCommand(
        "ccms",
        ["--force", "--fast", "--verbose", "push"],
        (event: CommandEvent) => {
          if (event.type === "stdout" || event.type === "stderr") {
            output += (event.line || "") + "\n";
            updateSyncResult(output);
          } else if (event.type === "completed") {
            output += event.success ? "✓ Push complete\n" : "✗ Push failed\n";
            updateSyncResult(output, false);
          } else if (event.type === "error") {
            output += `✗ Push error: ${event.message}\n`;
            updateSyncResult(output, false);
          }
        },
        undefined,
        owner
      );

      console.log("[SYNC] Streaming sync complete");
    } catch (e) {
      console.error("[SYNC] Streaming sync error:", e);
      output += `\n✗ Error: ${e}`;
      updateSyncResult(output, false);
    } finally {
      streaming.setIsLoading(false);
    }
  };

  /**
   * Toggle thinking display (Alt+T)
   */
  const handleToggleThinking = async () => {
    streaming.setShowThinking((prev) => !prev);
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

    const commandName = trimmed.slice(1).split(" ")[0]; // Get command name without args

    const command = commands.find((c) => c.name === commandName);
    if (!command) return false;

    console.log(`[COMMANDS] Dispatching /${command.name}`);
    await command.handler();
    return true;
  };

  /**
   * Handle keyboard shortcuts. Returns true if handled.
   */
  const handleKeyDown = (e: KeyboardEvent): boolean => {
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
