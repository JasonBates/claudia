import { Accessor, Owner, Setter } from "solid-js";
import type { UseSessionReturn } from "./useSession";
import type { UseSidebarReturn } from "./useSidebar";
import { ClaudeEvent, clearSession, sendInterrupt, quitApp, runStreamingCommand, CommandEvent } from "../lib/tauri";
import type { Message, ToolUse, ContentBlock } from "../lib/types";
import { estimateCost, formatTokenCount, getContextPercentage, DEFAULT_CONTEXT_LIMIT } from "../lib/context-utils";

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
  name: string;           // e.g., "clear", "resume"
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
  /**
   * Callback to open a new window.
   */
  onOpenNewWindow?: () => void;
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
  const { streaming, session, owner, sidebar, onCliEvent, onOpenSettings, onFocusInput, onOpenNewWindow } = options;

  // ==========================================================================
  // Command Handlers
  // ==========================================================================

  /**
   * Handle ! prefix - execute bash command directly
   * Similar to Claude Code's ! passthrough feature
   */
  const handleBangCommand = async (command: string) => {
    const bangMsgId = `bang-${Date.now()}`;
    const bangToolId = `bang-tool-${Date.now()}`;

    const updateResult = (text: string, loading: boolean = true) => {
      streaming.setMessages((prev) =>
        prev.map((m) =>
          m.id === bangMsgId
            ? {
                ...m,
                toolUses: m.toolUses?.map((t) =>
                  t.id === bangToolId
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

    streaming.setIsLoading(true);

    // Add user message showing the command
    streaming.setMessages((prev) => [
      ...prev,
      {
        id: `bang-user-${Date.now()}`,
        role: "user",
        content: `! ${command}`,
      },
    ]);

    // Add assistant message with loading state
    streaming.setMessages((prev) => [
      ...prev,
      {
        id: bangMsgId,
        role: "assistant",
        content: "",
        toolUses: [
          {
            id: bangToolId,
            name: "Bash",
            input: { command },
            isLoading: true,
            result: "",
          },
        ],
      },
    ]);

    let output = "";

    try {
      // Get working directory from session
      const workingDir = session.workingDir?.() ?? undefined;

      await runStreamingCommand(
        "/bin/bash",
        ["-c", command],
        (event: CommandEvent) => {
          if (event.type === "stdout" && event.line) {
            output += event.line + "\n";
            updateResult(output);
          } else if (event.type === "stderr" && event.line) {
            output += event.line + "\n";
            updateResult(output);
          } else if (event.type === "completed") {
            if (!event.success) {
              const exitInfo = event.exit_code !== undefined
                ? `Exit code: ${event.exit_code}`
                : "";
              output += exitInfo ? `\n${exitInfo}` : "";
            }
            updateResult(output.trim() || "(no output)", false);
          }
        },
        workingDir,
        owner
      );
    } catch (e) {
      output += `\nError: ${e}`;
      updateResult(output.trim(), false);
    } finally {
      streaming.setIsLoading(false);
    }
  };

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

  /**
   * Open a new window (Cmd+N)
   */
  const handleOpenNewWindow = async () => {
    console.log("[COMMANDS] Opening new window");
    onOpenNewWindow?.();
  };

  /**
   * Show all available commands (/help)
   */
  const handleHelp = async () => {
    const helpMsgId = `help-${Date.now()}`;
    const helpToolId = `help-tool-${Date.now()}`;

    // Group commands by category (exclude duplicates like /quit, /x, /q)
    const primaryCommands = commands.filter(
      (c) => !["quit", "x", "q"].includes(c.name)
    );

    const lines = primaryCommands.map((cmd) => {
      const keybind = cmd.keybinding ? ` (${cmd.keybinding})` : "";
      return `/${cmd.name}${keybind} - ${cmd.description}`;
    });

    const output = lines.join("\n");

    streaming.setMessages((prev) => [
      ...prev,
      {
        id: helpMsgId,
        role: "assistant",
        content: "",
        toolUses: [
          {
            id: helpToolId,
            name: "Help",
            input: {},
            isLoading: false,
            result: output,
            autoExpanded: true,
          },
        ],
      },
    ]);
  };

  /**
   * Show token usage and cost (/cost)
   */
  const handleCost = async () => {
    const costMsgId = `cost-${Date.now()}`;
    const costToolId = `cost-tool-${Date.now()}`;

    const info = session.sessionInfo();
    const inputTokens = info.totalContext || 0;
    const outputTokens = info.outputTokens || 0;
    const model = info.model || "unknown";

    const cost = estimateCost(inputTokens, outputTokens, model);
    const contextPercent = Math.round(getContextPercentage(inputTokens));

    const output = [
      `Model: ${model}`,
      `Input tokens: ${formatTokenCount(inputTokens)} (~$${cost.inputCost.toFixed(4)})`,
      `Output tokens: ${formatTokenCount(outputTokens)} (~$${cost.outputCost.toFixed(4)})`,
      `Context used: ${contextPercent}% of ${formatTokenCount(DEFAULT_CONTEXT_LIMIT)}`,
      `---`,
      `Estimated session cost: ~$${cost.totalCost.toFixed(4)}`,
    ].join("\n");

    streaming.setMessages((prev) => [
      ...prev,
      {
        id: costMsgId,
        role: "assistant",
        content: "",
        toolUses: [
          {
            id: costToolId,
            name: "Cost",
            input: {},
            isLoading: false,
            result: output,
            autoExpanded: true,
          },
        ],
      },
    ]);
  };

  /**
   * Show session status (/status)
   */
  const handleStatus = async () => {
    const statusMsgId = `status-${Date.now()}`;
    const statusToolId = `status-tool-${Date.now()}`;

    const info = session.sessionInfo();
    const isConnected = session.sessionActive();
    const isStreaming = streaming.isLoading();
    const activeTools = streaming.currentToolUses();

    const lines = [
      `Connection: ${isConnected ? "✓ Connected" : "✗ Disconnected"}`,
      `Session ID: ${info.sessionId || "none"}`,
      `Model: ${info.model || "unknown"}`,
      `---`,
      `Streaming: ${isStreaming ? "yes" : "no"}`,
      `Active tools: ${activeTools.length > 0 ? activeTools.map((t) => t.name).join(", ") : "none"}`,
    ];

    const output = lines.join("\n");

    streaming.setMessages((prev) => [
      ...prev,
      {
        id: statusMsgId,
        role: "assistant",
        content: "",
        toolUses: [
          {
            id: statusToolId,
            name: "Status",
            input: {},
            isLoading: false,
            result: output,
            autoExpanded: true,
          },
        ],
      },
    ]);
  };

  /**
   * Run diagnostics (/doctor)
   */
  const handleDoctor = async () => {
    const doctorMsgId = `doctor-${Date.now()}`;
    const doctorToolId = `doctor-tool-${Date.now()}`;

    const updateResult = (text: string, loading: boolean = true) => {
      streaming.setMessages((prev) =>
        prev.map((m) =>
          m.id === doctorMsgId
            ? {
                ...m,
                toolUses: m.toolUses?.map((t) =>
                  t.id === doctorToolId
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

    streaming.setIsLoading(true);

    // Add message with loading state
    streaming.setMessages((prev) => [
      ...prev,
      {
        id: doctorMsgId,
        role: "assistant",
        content: "",
        toolUses: [
          {
            id: doctorToolId,
            name: "Doctor",
            input: {},
            isLoading: true,
            result: "",
          },
        ],
      },
    ]);

    let output = "Running diagnostics...\n\n";
    updateResult(output);

    try {
      // Check Claude CLI version
      output += "▶ Checking Claude CLI...\n";
      updateResult(output);

      let claudeVersion = "";
      await runStreamingCommand(
        "claude",
        ["--version"],
        (event: CommandEvent) => {
          if (event.type === "stdout" && event.line) {
            claudeVersion = event.line.trim();
          } else if (event.type === "completed") {
            if (event.success && claudeVersion) {
              output += `  ✓ Claude CLI: ${claudeVersion}\n`;
            } else {
              output += `  ✗ Claude CLI not found or error\n`;
            }
            updateResult(output);
          }
        },
        undefined,
        owner
      );

      // Check Node version
      output += "\n▶ Checking Node.js...\n";
      updateResult(output);

      let nodeVersion = "";
      await runStreamingCommand(
        "node",
        ["--version"],
        (event: CommandEvent) => {
          if (event.type === "stdout" && event.line) {
            nodeVersion = event.line.trim();
          } else if (event.type === "completed") {
            if (event.success && nodeVersion) {
              output += `  ✓ Node.js: ${nodeVersion}\n`;
            } else {
              output += `  ✗ Node.js not found\n`;
            }
            updateResult(output);
          }
        },
        undefined,
        owner
      );

      // Check session state
      output += "\n▶ Checking session...\n";
      updateResult(output);

      const info = session.sessionInfo();
      const isConnected = session.sessionActive();

      if (isConnected) {
        output += `  ✓ Connected to Claude\n`;
        output += `  ✓ Model: ${info.model || "unknown"}\n`;
        output += `  ✓ Session: ${info.sessionId || "unknown"}\n`;
      } else {
        output += `  ✗ Not connected to Claude\n`;
      }
      updateResult(output);

      output += "\n✓ Diagnostics complete\n";
      updateResult(output, false);
    } catch (e) {
      output += `\n✗ Error: ${e}`;
      updateResult(output, false);
    } finally {
      streaming.setIsLoading(false);
    }
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
    {
      name: "newwindow",
      description: "Open a new window",
      keybinding: "cmd+n",
      handler: handleOpenNewWindow,
    },
    {
      name: "help",
      description: "Show available commands",
      handler: handleHelp,
    },
    {
      name: "cost",
      description: "Show token usage and estimated cost",
      handler: handleCost,
    },
    {
      name: "status",
      description: "Show session status",
      handler: handleStatus,
    },
    {
      name: "doctor",
      description: "Run diagnostics",
      handler: handleDoctor,
    },
    {
      name: "compact",
      description: "Compact context (sent to Claude CLI)",
      handler: async () => {}, // No-op, handled specially in dispatch
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
   * Dispatch a slash command or bang command. Returns true if handled locally.
   */
  const dispatch = async (text: string): Promise<boolean> => {
    const trimmed = text.trim();

    // Handle ! (bang) commands - execute bash directly
    if (trimmed.startsWith("!")) {
      const bashCommand = trimmed.slice(1).trim();
      if (!bashCommand) return false; // Just "!" with no command

      console.log(`[COMMANDS] Dispatching bash command: ${bashCommand}`);
      try {
        await handleBangCommand(bashCommand);
      } catch (e) {
        console.error(`[COMMANDS] Handler error for bash command:`, e);
        streaming.setError(`Bash command error: ${e}`);
      }
      return true;
    }

    // Handle / (slash) commands
    const lowerTrimmed = trimmed.toLowerCase();
    if (!lowerTrimmed.startsWith("/")) return false;

    const commandName = lowerTrimmed.slice(1).split(" ")[0];

    // Special case: /compact should be sent to Claude CLI, not handled locally
    // The CLI handles compaction natively and sends back status events
    if (commandName === "compact") return false;

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
