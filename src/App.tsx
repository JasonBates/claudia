import { createSignal, onMount, onCleanup, Show, getOwner, runWithOwner, batch } from "solid-js";
import MessageList, { Message, ToolUse, ContentBlock } from "./components/MessageList";
import CommandInput, { CommandInputHandle } from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel from "./components/QuestionPanel";
import PlanningBanner from "./components/PlanningBanner";
import PlanApprovalModal from "./components/PlanApprovalModal";
import PermissionDialog from "./components/PermissionDialog";
import { startSession, sendMessage, sendPermissionResponse, pollPermissionRequest, respondToPermission, getLaunchDir, syncPull, syncPush, isSyncAvailable, runStreamingCommand, ClaudeEvent, CommandEvent, PermissionRequestFromHook } from "./lib/tauri";
import "./App.css";

interface Todo {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sessionActive, setSessionActive] = createSignal(false);
  const [launchDir, setLaunchDir] = createSignal<string | null>(null);
  const [workingDir, setWorkingDir] = createSignal<string | null>(null);
  const [sessionInfo, setSessionInfo] = createSignal<{
    model?: string;
    totalContext?: number;  // Total context used (all input tokens)
    outputTokens?: number;
    baseContext?: number;   // System prompt size (for estimating post-compaction context)
  }>({});

  const CONTEXT_LIMIT = 200_000;

  let messageIdCounter = 0;
  const generateId = () => `msg-${++messageIdCounter}`;

  // Current tool uses being collected for the streaming message
  const [currentToolUses, setCurrentToolUses] = createSignal<ToolUse[]>([]);
  let currentToolInput = "";

  // Ordered content blocks for proper interleaving of text and tools
  const [streamingBlocks, setStreamingBlocks] = createSignal<ContentBlock[]>([]);
  let currentTextBlockIndex = -1;  // Index of current text block being streamed

  // Thinking mode tracking
  const [streamingThinking, setStreamingThinking] = createSignal("");
  const [showThinking, setShowThinking] = createSignal(false);

  // TodoWrite tracking for real-time display
  const [currentTodos, setCurrentTodos] = createSignal<Todo[]>([]);
  const [showTodoPanel, setShowTodoPanel] = createSignal(false);
  const [todoPanelHiding, setTodoPanelHiding] = createSignal(false);
  let isCollectingTodoWrite = false;
  let todoWriteJson = "";

  // AskUserQuestion tracking
  const [pendingQuestions, setPendingQuestions] = createSignal<Question[]>([]);
  const [showQuestionPanel, setShowQuestionPanel] = createSignal(false);
  let isCollectingQuestion = false;
  let questionJson = "";

  // Planning mode tracking
  const [isPlanning, setIsPlanning] = createSignal(false);
  const [planFilePath, setPlanFilePath] = createSignal<string | null>(null);
  const [showPlanApproval, setShowPlanApproval] = createSignal(false);
  const [planContent, setPlanContent] = createSignal("");

  // Permission request tracking (control_request with can_use_tool)
  interface PermissionRequest {
    requestId: string;
    toolName: string;
    toolInput?: unknown;
    description: string;
  }
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);

  // Mode switching (like Claude Code's Shift+Tab)
  type Mode = "normal" | "plan" | "auto-accept";
  const MODES: Mode[] = ["normal", "plan", "auto-accept"];
  const [currentMode, setCurrentMode] = createSignal<Mode>("normal");

  // Context warning state
  const [warningDismissed, setWarningDismissed] = createSignal(false);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);

  // Track compaction for before/after token display
  const [lastCompactionPreTokens, setLastCompactionPreTokens] = createSignal<number | null>(null);
  const [compactionMessageId, setCompactionMessageId] = createSignal<string | null>(null);

  // Compute context threshold level
  const contextThreshold = () => {
    const used = sessionInfo().totalContext || 0;
    const percent = (used / CONTEXT_LIMIT) * 100;
    if (percent >= 75) return 'critical';
    if (percent >= 60) return 'warning';
    return 'ok';
  };

  // Show toast notification
  const showToast = (message: string, duration = 3000) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), duration);
  };

  // Ref to CommandInput for focus management
  let commandInputRef: CommandInputHandle | undefined;

  // Capture SolidJS owner for restoring reactive context in async callbacks
  // This is critical for Tauri channel callbacks, setTimeout, setInterval
  const owner = getOwner();

  const cycleMode = () => {
    const current = currentMode();
    const currentIndex = MODES.indexOf(current);
    const nextIndex = (currentIndex + 1) % MODES.length;
    setCurrentMode(MODES[nextIndex]);
  };

  // Poll for hook-based permission requests
  let permissionPollInterval: number | null = null;

  const startPermissionPolling = () => {
    permissionPollInterval = window.setInterval(async () => {
      try {
        const request = await pollPermissionRequest();
        if (request && !pendingPermission()) {
          console.log("[PERMISSION] Hook request received:", request);

          // In auto-accept mode, immediately approve
          if (currentMode() === "auto-accept") {
            console.log("[PERMISSION] Auto-accepting:", request.tool_name);
            await respondToPermission(true);
            return;
          }

          // Restore SolidJS context for state updates from setInterval
          runWithOwner(owner, () => {
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

  const stopPermissionPolling = () => {
    if (permissionPollInterval) {
      window.clearInterval(permissionPollInterval);
      permissionPollInterval = null;
    }
  };

  // Keyboard handler for Opt+T (thinking toggle)
  // Use capture phase to intercept before input field processes it
  const handleKeyDown = (e: KeyboardEvent) => {
    // On macOS, Alt+T produces '†' but we check for the key code
    // e.key might be '†' or 't' depending on the keyboard layout
    if (e.altKey && (e.key === 't' || e.key === 'T' || e.key === '†' || e.code === 'KeyT')) {
      e.preventDefault();
      e.stopPropagation();
      setShowThinking(prev => !prev);
    }
  };

  // Helper to add timeout to a promise
  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      )
    ]);
  };

  onMount(async () => {
    console.log("[MOUNT] Starting session...");

    // Add keyboard listener for thinking toggle (capture phase to get it before input)
    window.addEventListener('keydown', handleKeyDown, true);

    try {
      // Get launch directory (worktree) first
      const launch = await getLaunchDir();
      console.log("[MOUNT] Launch directory:", launch);
      setLaunchDir(launch);

      // Start session with timeout so we don't hang forever on failures
      const dir = await withTimeout(startSession(), 15000, "startSession");
      console.log("[MOUNT] Session started successfully in:", dir);
      setWorkingDir(dir);
      setSessionActive(true);
      startPermissionPolling();
    } catch (e) {
      console.error("[MOUNT] Failed to start session:", e);
      setError(`Failed to start session: ${e}`);
    }
  });

  onCleanup(() => {
    stopPermissionPolling();
    window.removeEventListener('keydown', handleKeyDown, true);
  });

  // Handle /sync command locally with tool-style UI
  const handleSyncCommand = async () => {
    const syncMsgId = `sync-${Date.now()}`;
    const syncToolId = `sync-tool-${Date.now()}`;

    // Helper to update the sync tool result
    const updateSyncResult = (text: string, loading: boolean = true) => {
      setMessages(prev => prev.map(m =>
        m.id === syncMsgId
          ? {
              ...m,
              toolUses: m.toolUses?.map(t =>
                t.id === syncToolId
                  ? {
                      ...t,
                      isLoading: loading,
                      result: text,
                      // Auto-expand when loading completes (survives component recreation)
                      autoExpanded: !loading ? true : t.autoExpanded
                    }
                  : t
              )
            }
          : m
      ));
    };

    // Block input while syncing
    setIsLoading(true);

    // Add message with loading state (tool-style display)
    setMessages(prev => [...prev, {
      id: syncMsgId,
      role: "assistant",
      content: "",
      toolUses: [{
        id: syncToolId,
        name: "Sync",
        input: { operation: "pull & push" },
        isLoading: true,
        result: ""
      }]
    }]);

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
            updateSyncResult(output, false); // Done loading
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
      setIsLoading(false);
    }
  };

  const handleSubmit = async (text: string) => {
    // Handle /sync command locally
    if (text.trim().toLowerCase() === "/sync") {
      await handleSyncCommand();
      return;
    }

    if (isLoading()) return;

    setError(null);
    setIsLoading(true);
    setCurrentToolUses([]);
    currentToolInput = "";

    // Reset streaming blocks
    setStreamingBlocks([]);
    currentTextBlockIndex = -1;

    // Add user message
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Reset streaming content
    setStreamingContent("");

    try {
      console.log("[SUBMIT] Calling sendMessage...");
      await sendMessage(text, handleEvent, owner);
      console.log("[SUBMIT] sendMessage returned");
    } catch (e) {
      console.error("[SUBMIT] Error:", e);
      setError(`Error: ${e}`);
      setIsLoading(false);
    }
  };

  const handleEvent = (event: ClaudeEvent) => {
    const ts = new Date().toISOString().split("T")[1];
    console.log(`[${ts}] Event received:`, event.type, event);

    switch (event.type) {
      case "status":
        // Show status messages inline in the message list
        if (event.message) {
          // If this is "Compacting...", show compaction block immediately with loading state
          if (event.message.includes("Compacting")) {
            const currentContext = sessionInfo().totalContext || 0;
            setLastCompactionPreTokens(currentContext);

            // Create compaction message with loading state (content = "loading")
            const msgId = `compaction-${Date.now()}`;
            setCompactionMessageId(msgId);
            const preK = Math.round(currentContext / 1000);

            const compactionMsg: Message = {
              id: msgId,
              role: "system",
              content: `${preK}k → ...`,  // Loading indicator
              variant: "compaction",
            };
            setMessages((prev) => [...prev, compactionMsg]);
            break;
          }

          // Handle compaction completion - update the existing compaction block
          if (event.is_compaction) {
            const preTokens = lastCompactionPreTokens() || event.pre_tokens || 0;
            const summaryTokens = event.post_tokens || 0;

            // Estimate full context: baseContext (system prompt) + summary tokens
            // post_tokens from CLI is just the summary, not including system prompt
            const baseContext = sessionInfo().baseContext || 0;
            const estimatedContext = baseContext + summaryTokens;

            // Update context with estimated value
            if (estimatedContext > 0) {
              setSessionInfo((prev) => ({
                ...prev,
                totalContext: estimatedContext,
              }));
            }

            // Build compact display: "145k → 34k"
            const preK = Math.round(preTokens / 1000);
            const postK = estimatedContext > 0 ? Math.round(estimatedContext / 1000) : '?';
            const content = `${preK}k → ${postK}k`;

            // Update existing compaction message or create new one
            const existingMsgId = compactionMessageId();
            if (existingMsgId) {
              setMessages((prev) => prev.map((msg) =>
                msg.id === existingMsgId
                  ? { ...msg, content }
                  : msg
              ));
            } else {
              const compactionMsg: Message = {
                id: `compaction-${Date.now()}`,
                role: "system",
                content,
                variant: "compaction",
              };
              setMessages((prev) => [...prev, compactionMsg]);
            }

            // Clear compaction tracking
            setLastCompactionPreTokens(null);
            setCompactionMessageId(null);
            setWarningDismissed(false);
            break;
          }

          // Regular status messages
          const statusMsg: Message = {
            id: `status-${Date.now()}`,
            role: "system",
            content: event.message,
            variant: "status",
          };
          setMessages((prev) => [...prev, statusMsg]);
        }
        break;

      case "ready":
        setSessionActive(true);
        // Preserve existing totalContext if we have it (ready can fire multiple times)
        setSessionInfo((prev) => ({
          ...prev,
          model: event.model,
          // Only reset totalContext if we don't have a value yet
          totalContext: prev.totalContext || 0,
        }));
        break;

      case "processing":
        // User message being processed
        break;

      case "thinking_start":
        // New thinking block starting - reset thinking content
        setStreamingThinking("");
        break;

      case "thinking_delta":
        // Append thinking chunk
        setStreamingThinking(prev => prev + (event.thinking || ""));

        // Also add to streamingBlocks for persistence in completed messages
        setStreamingBlocks(prev => {
          const blocks = [...prev];
          // If last block is thinking, append to it
          if (blocks.length > 0 && blocks[blocks.length - 1].type === "thinking") {
            const lastBlock = blocks[blocks.length - 1] as { type: "thinking"; content: string };
            blocks[blocks.length - 1] = {
              type: "thinking",
              content: lastBlock.content + (event.thinking || "")
            };
          } else {
            // Create new thinking block
            blocks.push({ type: "thinking", content: event.thinking || "" });
          }
          return blocks;
        });
        break;

      case "text_delta":
        // Streaming text chunk - append to current content
        console.log(`  -> text_delta: "${event.text}"`);

        // If we're receiving text and there are loading tools, mark them as completed
        // (Text after tool_pending means the tool finished executing)
        setCurrentToolUses(prev => {
          const hasLoadingTool = prev.some(t => t.isLoading);
          if (hasLoadingTool) {
            return prev.map(t => ({ ...t, isLoading: false }));
          }
          return prev;
        });
        setStreamingBlocks(prev => {
          let updated = false;
          const blocks = prev.map(block => {
            if (block.type === "tool_use" && block.tool.isLoading) {
              updated = true;
              return { ...block, tool: { ...block.tool, isLoading: false } };
            }
            return block;
          });
          return updated ? blocks : prev;
        });

        // Update legacy streamingContent for backwards compatibility
        setStreamingContent((prev) => {
          const newContent = prev + (event.text || "");

          // Extract plan file path if present (from system-reminder)
          const planMatch = newContent.match(/plan file[^\/]*?(\/[^\s]+\.md)/i);
          if (planMatch && !planFilePath()) {
            setPlanFilePath(planMatch[1]);
          }

          return newContent;
        });

        // Update streamingBlocks with proper ordering
        setStreamingBlocks((prev) => {
          const blocks = [...prev];
          const text = event.text || "";

          // If last block is text, append to it
          if (blocks.length > 0 && blocks[blocks.length - 1].type === "text") {
            const lastBlock = blocks[blocks.length - 1] as { type: "text"; content: string };
            blocks[blocks.length - 1] = { type: "text", content: lastBlock.content + text };
          } else {
            // Create new text block
            blocks.push({ type: "text", content: text });
          }
          currentTextBlockIndex = blocks.length - 1;
          return blocks;
        });
        break;

      case "tool_start":
        // New tool invocation starting
        currentToolInput = "";

        // Special handling for TodoWrite
        if (event.name === "TodoWrite") {
          isCollectingTodoWrite = true;
          todoWriteJson = "";
          setShowTodoPanel(true);
          setTodoPanelHiding(false);
        } else if (event.name === "AskUserQuestion") {
          isCollectingQuestion = true;
          questionJson = "";
        } else if (event.name === "EnterPlanMode") {
          setIsPlanning(true);
          // Don't add to currentToolUses - shown in banner
        } else if (event.name === "ExitPlanMode") {
          // Show plan approval modal
          setShowPlanApproval(true);
          // Don't add to currentToolUses - shown in modal
        } else {
          const newTool: ToolUse = {
            id: event.id || "",
            name: event.name || "unknown",
            input: {},
            isLoading: true,
          };

          // Add to legacy currentToolUses
          setCurrentToolUses(prev => [...prev, newTool]);

          // Add to streamingBlocks for proper ordering
          setStreamingBlocks(prev => [...prev, { type: "tool_use", tool: newTool }]);
        }
        break;

      case "tool_input":
        // Accumulate tool input JSON
        if (isCollectingTodoWrite) {
          todoWriteJson += event.json || "";
          // Try to parse and update todos in real-time
          try {
            const parsed = JSON.parse(todoWriteJson);
            if (parsed.todos && Array.isArray(parsed.todos)) {
              setCurrentTodos(parsed.todos);
            }
          } catch {
            // Incomplete JSON, wait for more chunks
          }
        } else if (isCollectingQuestion) {
          questionJson += event.json || "";
          // Try to parse questions
          try {
            const parsed = JSON.parse(questionJson);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              setPendingQuestions(parsed.questions);
              setShowQuestionPanel(true);
            }
          } catch {
            // Incomplete JSON, wait for more chunks
          }
        } else {
          currentToolInput += event.json || "";
        }
        break;

      case "permission_request":
        // Tool needs permission (control_request with can_use_tool)
        setPendingPermission({
          requestId: event.request_id || "",
          toolName: event.tool_name || "unknown",
          toolInput: event.tool_input,
          description: event.description || "",
        });
        break;

      case "tool_pending":
        // Tool about to execute - try to parse accumulated input
        if (isCollectingTodoWrite) {
          // Final parse for TodoWrite
          try {
            const parsed = JSON.parse(todoWriteJson);
            if (parsed.todos && Array.isArray(parsed.todos)) {
              setCurrentTodos(parsed.todos);
            }
          } catch {
            // Parsing failed
          }
        } else if (isCollectingQuestion) {
          // Final parse for AskUserQuestion
          try {
            const parsed = JSON.parse(questionJson);
            if (parsed.questions && Array.isArray(parsed.questions)) {
              setPendingQuestions(parsed.questions);
              setShowQuestionPanel(true);
            }
          } catch {
            // Parsing failed
          }
        } else if (currentToolUses().length > 0) {
          // Parse tool input - handle empty input gracefully
          let parsedInput: unknown = {};
          if (currentToolInput.trim()) {
            try {
              parsedInput = JSON.parse(currentToolInput);
            } catch {
              parsedInput = { raw: currentToolInput };
            }
          }

          // Update input in currentToolUses
          setCurrentToolUses(prev => {
            const updated = [...prev];
            const lastTool = updated[updated.length - 1];
            lastTool.input = parsedInput;
            return updated;
          });

          // Also update in streamingBlocks - create new objects for reactivity
          setStreamingBlocks(prev => {
            const blocks = [...prev];
            // Find last tool_use block
            for (let i = blocks.length - 1; i >= 0; i--) {
              if (blocks[i].type === "tool_use") {
                const toolBlock = blocks[i] as { type: "tool_use"; tool: ToolUse };
                // Create new block object to trigger SolidJS reactivity
                blocks[i] = {
                  type: "tool_use",
                  tool: {
                    ...toolBlock.tool,
                    input: parsedInput,
                  }
                };
                break;
              }
            }
            return blocks;
          });
        }
        break;

      case "tool_result":
        // Tool finished - update the matching tool by ID
        if (isCollectingTodoWrite) {
          isCollectingTodoWrite = false;
          // Don't add to currentToolUses - shown in panel instead
        } else if (isCollectingQuestion) {
          isCollectingQuestion = false;
          // Keep question panel visible until user answers
        } else {
          const resultData = {
            result: event.is_error ? `Error: ${event.stderr || event.stdout}` : (event.stdout || event.stderr || ""),
            isLoading: false,
          };
          const targetToolId = event.tool_use_id;

          console.log("[TOOL_RESULT] Received tool_use_id:", targetToolId, "result length:", resultData.result.length);

          // Update currentToolUses - find by ID or fall back to last tool
          setCurrentToolUses(prev => {
            if (prev.length === 0) {
              console.log("[TOOL_RESULT] No tools in currentToolUses, skipping update");
              return prev;
            }
            const updated = [...prev];
            // Find tool by ID, or use last tool as fallback
            let toolIndex = targetToolId
              ? updated.findIndex(t => t.id === targetToolId)
              : updated.length - 1;
            if (toolIndex === -1) toolIndex = updated.length - 1;

            const tool = updated[toolIndex];
            console.log("[TOOL_RESULT] Updating tool:", tool.name, "at index:", toolIndex);

            // Check if this is a Read tool result for the plan file
            if (tool.name === "Read" && planFilePath()) {
              const inputPath = (tool.input as any)?.file_path || "";
              if (inputPath === planFilePath()) {
                setPlanContent(event.stdout || "");
              }
            }
            updated[toolIndex] = {
              ...tool,
              result: resultData.result,
              isLoading: resultData.isLoading,
            };
            return updated;
          });

          // Also update in streamingBlocks - find by ID for correct matching
          setStreamingBlocks(prev => {
            const blocks = [...prev];
            // Find matching tool_use block by ID, or fall back to last one
            let foundIndex = -1;
            for (let i = blocks.length - 1; i >= 0; i--) {
              if (blocks[i].type === "tool_use") {
                const toolBlock = blocks[i] as { type: "tool_use"; tool: ToolUse };
                if (targetToolId && toolBlock.tool.id === targetToolId) {
                  foundIndex = i;
                  break;
                }
                if (foundIndex === -1) foundIndex = i; // Remember last one as fallback
              }
            }

            if (foundIndex !== -1) {
              const toolBlock = blocks[foundIndex] as { type: "tool_use"; tool: ToolUse };
              console.log("[TOOL_RESULT] Updating streamingBlocks tool:", toolBlock.tool.name, "at index:", foundIndex);
              // Create new block object to trigger SolidJS reactivity
              blocks[foundIndex] = {
                type: "tool_use",
                tool: {
                  ...toolBlock.tool,
                  result: resultData.result,
                  isLoading: resultData.isLoading,
                }
              };
            } else {
              console.log("[TOOL_RESULT] No matching tool_use block found in streamingBlocks");
            }
            return blocks;
          });
        }
        break;

      case "block_end":
        // Content block ended - nothing special needed
        break;

      case "context_update":
        // Real-time context size from message_start event
        // This fires at the START of each response with current token usage
        // Total = raw_input + cache_read + cache_write (all represent context window usage)
        const contextTotal = event.input_tokens || 0;
        if (contextTotal > 0) {
          // Track baseContext (system prompt size) for post-compaction estimation
          // It's the larger of cache_read or cache_write (cache_write on first msg, cache_read after)
          // Always take MAX seen - cache can grow as MCP servers load, etc.
          const cacheSize = Math.max(event.cache_read || 0, event.cache_write || 0);
          setSessionInfo((prev) => ({
            ...prev,
            totalContext: contextTotal,
            baseContext: Math.max(prev.baseContext || 0, cacheSize),
          }));
        }
        break;

      case "result":
        console.log("[EVENT] *** RESULT EVENT RECEIVED ***", event);
        // Only add output tokens to context - input context handled by context_update
        // result's input_tokens has different semantics (CLI aggregates differently)
        const newOutputTokens = event.output_tokens || 0;
        setSessionInfo((prev) => ({
          ...prev,
          totalContext: (prev.totalContext || 0) + newOutputTokens,
          outputTokens: (prev.outputTokens || 0) + newOutputTokens,
        }));
        console.log("[EVENT] Calling finishStreaming from result");
        finishStreaming();
        break;

      case "done":
        console.log("[EVENT] *** DONE EVENT RECEIVED ***");
        console.log("[EVENT] Calling finishStreaming from done");
        finishStreaming();
        break;

      case "closed":
        setSessionActive(false);
        setError(`Session closed (code ${event.code})`);
        break;

      case "error":
        setError(event.message || "Unknown error");
        finishStreaming();
        break;
    }
  };

  const handleQuestionAnswer = async (answers: Record<string, string>) => {
    // Hide the question panel
    setShowQuestionPanel(false);
    setPendingQuestions([]);

    // Focus back to the input line
    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });

    // Format the answer and send as a follow-up message
    const answerText = Object.entries(answers)
      .map(([q, a]) => a)
      .join(", ");

    // Send the answer as the user's response
    await handleSubmit(answerText);
  };

  const handlePlanApprove = async () => {
    setShowPlanApproval(false);
    setIsPlanning(false);
    setPlanContent("");
    // Don't clear planFilePath yet - might be referenced
    await handleSubmit("I approve this plan. Proceed with implementation.");
  };

  const handlePlanRequestChanges = async (feedback: string) => {
    setShowPlanApproval(false);
    // Stay in planning mode
    await handleSubmit(feedback);
  };

  const handlePlanCancel = async () => {
    setShowPlanApproval(false);
    setIsPlanning(false);
    setPlanContent("");
    setPlanFilePath(null);
    await handleSubmit("Cancel this plan. Let's start over with a different approach.");
  };

  const handlePermissionAllow = async (remember: boolean) => {
    const permission = pendingPermission();
    if (!permission) return;
    setPendingPermission(null);
    // Use hook-based response (writes to file for hook to read)
    await respondToPermission(true);
    console.log("[PERMISSION] Allowed:", permission.toolName);
  };

  const handlePermissionDeny = async () => {
    const permission = pendingPermission();
    if (!permission) return;
    setPendingPermission(null);
    // Use hook-based response (writes to file for hook to read)
    await respondToPermission(false, "User denied permission");
    console.log("[PERMISSION] Denied:", permission.toolName);
  };

  const finishStreaming = () => {
    console.log("[FINISH] finishStreaming called");
    const content = streamingContent();
    const tools = [...currentToolUses()]; // Create copies to avoid reference issues
    const blocks = [...streamingBlocks()];

    console.log("[FINISH] content length:", content.length, "tools:", tools.length, "blocks:", blocks.length);

    // CRITICAL ORDER: Add message to array FIRST, then set isLoading false, then clear streaming
    // This prevents the UI from showing empty state between clearing streaming and showing messages

    // Step 1: Add the completed message to the messages array
    if (content || tools.length > 0 || blocks.length > 0) {
      console.log("[FINISH] Adding message to messages array");
      const newMessage = {
        id: generateId(),
        role: "assistant" as const,
        content: content,
        toolUses: tools.length > 0 ? tools : undefined,
        contentBlocks: blocks.length > 0 ? blocks : undefined,
      };

      const currentMessages = messages();
      const newMessages = [...currentMessages, newMessage];
      setMessages(newMessages);
      console.log("[FINISH] Message added, new count:", newMessages.length);
    }

    // Step 2: Set isLoading to false - this switches MessageList from streaming to messages
    // MessageList uses: isLoading() ? streamingContent() : undefined
    // When isLoading becomes false, it stops looking at streaming state entirely
    setIsLoading(false);
    console.log("[FINISH] isLoading set to false");

    // Step 3: NOW clear streaming state (safe because isLoading is false, so MessageList ignores these)
    setStreamingContent("");
    setStreamingThinking("");
    setCurrentToolUses([]);
    setStreamingBlocks([]);
    currentToolInput = "";
    currentTextBlockIndex = -1;
    console.log("[FINISH] Streaming state cleared, messages count:", messages().length);

    // Auto-hide todo panel after delay
    if (showTodoPanel()) {
      setTodoPanelHiding(true);
      setTimeout(() => {
        // Restore SolidJS context for setTimeout callback
        runWithOwner(owner, () => {
          batch(() => {
            setShowTodoPanel(false);
            setTodoPanelHiding(false);
          });
        });
      }, 2000);
    }

  };

  return (
    <div class="app">
      {/* Fixed top bar background */}
      <div class="top-bar"></div>
      {/* Drag region for window */}
      <div class="drag-region" data-tauri-drag-region="true"></div>

      {/* Floating status indicator */}
      <div class="status-indicator" classList={{ connected: sessionActive(), disconnected: !sessionActive() }}>
        <Show when={launchDir()}>
          <span class="launch-dir" title={launchDir()!}>
            {launchDir()!.split('/').pop() || launchDir()}
          </span>
        </Show>
        <Show when={launchDir() && workingDir()}>
          <span class="dir-separator">:</span>
        </Show>
        <Show when={workingDir()}>
          <span class="working-dir" title={workingDir()!}>
            {workingDir()}
          </span>
        </Show>
        <Show when={sessionActive()} fallback={<span class="status-icon">⊘</span>}>
          <span class="status-icon">⚡</span>
        </Show>
        <Show when={sessionActive()}>
          <span class="context-mini" classList={{
            warning: contextThreshold() === 'warning',
            critical: contextThreshold() === 'critical'
          }}>
            {sessionInfo().totalContext
              ? `${Math.round(sessionInfo().totalContext / 1000)}k`
              : '—'}
          </span>
        </Show>
      </div>

      {/* Planning Mode Banner */}
      <Show when={isPlanning()}>
        <PlanningBanner planFile={planFilePath()} />
      </Show>

      <Show when={error()}>
        <div class="error-banner">
          {error()}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      </Show>

      {/* Context Warning - clickable text in title bar */}
      <Show when={contextThreshold() !== 'ok' && !warningDismissed()}>
        <div
          class={`context-warning ${contextThreshold()}`}
          onClick={() => handleSubmit("/compact")}
          title="Click to compact conversation"
        >
          <span class="warning-icon">⚠</span>
          <span class="warning-text">
            {contextThreshold() === 'critical' && "Context 75%+ — click to compact"}
            {contextThreshold() === 'warning' && "Context 60%+ — click to compact"}
          </span>
        </div>
      </Show>

      <main class="app-main">
        <MessageList
          messages={messages()}
          streamingContent={isLoading() ? streamingContent() : undefined}
          streamingToolUses={isLoading() ? currentToolUses() : undefined}
          streamingBlocks={isLoading() ? streamingBlocks() : undefined}
          streamingThinking={isLoading() ? streamingThinking() : undefined}
          showThinking={showThinking()}
        />
      </main>

      <footer class="app-footer">
        <CommandInput
          ref={(handle) => commandInputRef = handle}
          onSubmit={handleSubmit}
          disabled={isLoading() || !sessionActive()}
          placeholder={
            sessionActive()
              ? "Type a message... (Enter to send, Shift+Tab to change mode)"
              : ""
          }
          mode={currentMode()}
          onModeChange={cycleMode}
        />
      </footer>

      {/* Floating Todo Panel */}
      <Show when={showTodoPanel() && currentTodos().length > 0}>
        <TodoPanel todos={currentTodos()} hiding={todoPanelHiding()} />
      </Show>

      {/* Question Panel Overlay */}
      <Show when={showQuestionPanel() && pendingQuestions().length > 0}>
        <div class="question-overlay">
          <QuestionPanel
            questions={pendingQuestions()}
            onAnswer={handleQuestionAnswer}
          />
        </div>
      </Show>

      {/* Plan Approval Modal */}
      <Show when={showPlanApproval()}>
        <PlanApprovalModal
          planContent={planContent()}
          planFile={planFilePath()}
          onApprove={handlePlanApprove}
          onRequestChanges={handlePlanRequestChanges}
          onCancel={handlePlanCancel}
        />
      </Show>

      {/* Inline Permission Dialog */}
      <Show when={pendingPermission()}>
        <div class="permission-container">
          <PermissionDialog
            toolName={pendingPermission()!.toolName}
            toolInput={pendingPermission()!.toolInput}
            description={pendingPermission()!.description}
            onAllow={handlePermissionAllow}
            onDeny={handlePermissionDeny}
          />
        </div>
      </Show>

      {/* Toast Notification */}
      <Show when={toastMessage()}>
        <div class="toast-notification">
          {toastMessage()}
        </div>
      </Show>
    </div>
  );
}

export default App;
