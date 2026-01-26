import { createSignal, onMount, onCleanup, Show, getOwner, runWithOwner, batch } from "solid-js";
import MessageList from "./components/MessageList";
import CommandInput, { CommandInputHandle } from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel from "./components/QuestionPanel";
import PlanningBanner from "./components/PlanningBanner";
import PlanApprovalModal from "./components/PlanApprovalModal";
import PermissionDialog from "./components/PermissionDialog";
import { startSession, sendMessage, pollPermissionRequest, respondToPermission, getLaunchDir, runStreamingCommand, CommandEvent } from "./lib/tauri";
import { getContextThreshold, DEFAULT_CONTEXT_LIMIT } from "./lib/context-utils";
import { Mode, getNextMode } from "./lib/mode-utils";
import { createEventHandler, type PermissionRequest, type SessionInfo } from "./lib/event-handlers";
import type { Todo, Question, Message, ToolUse, ContentBlock } from "./lib/types";
import "./App.css";

function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sessionActive, setSessionActive] = createSignal(false);
  const [launchDir, setLaunchDir] = createSignal<string | null>(null);
  const [workingDir, setWorkingDir] = createSignal<string | null>(null);
  const [sessionInfo, setSessionInfo] = createSignal<SessionInfo>({});

  const CONTEXT_LIMIT = DEFAULT_CONTEXT_LIMIT;

  let messageIdCounter = 0;
  const generateId = () => `msg-${++messageIdCounter}`;

  // Current tool uses being collected for the streaming message
  const [currentToolUses, setCurrentToolUses] = createSignal<ToolUse[]>([]);

  // Ordered content blocks for proper interleaving of text and tools
  const [streamingBlocks, setStreamingBlocks] = createSignal<ContentBlock[]>([]);

  // Thinking mode tracking
  const [streamingThinking, setStreamingThinking] = createSignal("");
  const [showThinking, setShowThinking] = createSignal(false);

  // TodoWrite tracking for real-time display
  const [currentTodos, setCurrentTodos] = createSignal<Todo[]>([]);
  const [showTodoPanel, setShowTodoPanel] = createSignal(false);
  const [todoPanelHiding, setTodoPanelHiding] = createSignal(false);

  // AskUserQuestion tracking
  const [pendingQuestions, setPendingQuestions] = createSignal<Question[]>([]);
  const [showQuestionPanel, setShowQuestionPanel] = createSignal(false);

  // Mutable refs for JSON accumulation (passed to event handlers)
  const toolInputRef = { current: "" };
  const todoJsonRef = { current: "" };
  const questionJsonRef = { current: "" };
  const isCollectingTodoRef = { current: false };
  const isCollectingQuestionRef = { current: false };
  // Pending results for race condition handling (tool_result before tool_start)
  const pendingResultsRef = { current: new Map<string, { result: string; isError: boolean }>() };

  // Planning mode tracking
  const [isPlanning, setIsPlanning] = createSignal(false);
  const [planFilePath, setPlanFilePath] = createSignal<string | null>(null);
  const [showPlanApproval, setShowPlanApproval] = createSignal(false);
  const [planContent, setPlanContent] = createSignal("");

  // Permission request tracking (control_request with can_use_tool)
  const [pendingPermission, setPendingPermission] = createSignal<PermissionRequest | null>(null);

  // Mode switching (like Claude Code's Shift+Tab)
  // Mode and MODES imported from ./lib/mode-utils
  const [currentMode, setCurrentMode] = createSignal<Mode>("normal");

  // Context warning state
  const [warningDismissed, setWarningDismissed] = createSignal(false);

  // Track compaction for before/after token display
  const [lastCompactionPreTokens, setLastCompactionPreTokens] = createSignal<number | null>(null);
  const [compactionMessageId, setCompactionMessageId] = createSignal<string | null>(null);

  // Compute context threshold level (uses imported getContextThreshold)
  const contextThreshold = () => {
    const used = sessionInfo().totalContext || 0;
    return getContextThreshold(used, CONTEXT_LIMIT);
  };

  // Ref to CommandInput for focus management
  let commandInputRef: CommandInputHandle | undefined;

  // Capture SolidJS owner for restoring reactive context in async callbacks
  // This is critical for Tauri channel callbacks, setTimeout, setInterval
  const owner = getOwner();

  const cycleMode = () => {
    setCurrentMode(getNextMode(currentMode()));
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

  // finishStreaming must be declared before createEventHandler which uses it
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
    toolInputRef.current = "";
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

  // Create event handler with all dependencies injected
  const coreEventHandler = createEventHandler({
    // Message state
    setMessages,
    setStreamingContent,
    setStreamingBlocks,
    setStreamingThinking,

    // Tool state
    setCurrentToolUses,

    // Todo state
    setCurrentTodos,
    setShowTodoPanel,
    setTodoPanelHiding,

    // Question state
    setPendingQuestions,
    setShowQuestionPanel,

    // Planning state
    setIsPlanning,
    setPlanFilePath,
    setShowPlanApproval,
    setPlanContent,

    // Permission state
    setPendingPermission,

    // Session state
    setSessionActive,
    setSessionInfo,
    setError,
    setIsLoading,

    // Compaction tracking
    setLastCompactionPreTokens,
    setCompactionMessageId,
    setWarningDismissed,

    // State accessors
    getSessionInfo: sessionInfo,
    getCurrentToolUses: currentToolUses,
    getStreamingBlocks: streamingBlocks,
    getPlanFilePath: planFilePath,
    getLastCompactionPreTokens: lastCompactionPreTokens,
    getCompactionMessageId: compactionMessageId,

    // Mutable refs
    toolInputRef,
    todoJsonRef,
    questionJsonRef,
    isCollectingTodoRef,
    isCollectingQuestionRef,
    pendingResultsRef,

    // Callbacks
    generateMessageId: generateId,
    finishStreaming,
  });

  // Wrapper that adds logging
  const handleEvent = (event: Parameters<typeof coreEventHandler>[0]) => {
    const ts = new Date().toISOString().split("T")[1];
    console.log(`[${ts}] Event received:`, event.type, event);
    coreEventHandler(event);
  };

  // handleSubmit must be after handleEvent since it uses it
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
    toolInputRef.current = "";

    // Reset streaming blocks
    setStreamingBlocks([]);

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

  const handleQuestionAnswer = async (answers: Record<string, string>) => {
    // Hide the question panel
    setShowQuestionPanel(false);
    setPendingQuestions([]);

    // Focus back to the input line
    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });

    // Format the answer and send as a follow-up message
    const answerText = Object.values(answers).join(", ");

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

  const handlePermissionAllow = async (_remember: boolean) => {
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
              ? `${Math.round(sessionInfo().totalContext! / 1000)}k`
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

    </div>
  );
}

export default App;
