import { createSignal, onMount, onCleanup, Show, getOwner } from "solid-js";
import MessageList from "./components/MessageList";
import CommandInput, { CommandInputHandle } from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel from "./components/QuestionPanel";
import PlanningBanner from "./components/PlanningBanner";
import PlanApprovalModal from "./components/PlanApprovalModal";
import PermissionDialog from "./components/PermissionDialog";
// import StartupSplash from "./components/StartupSplash";
import { sendMessage } from "./lib/tauri";
import { getContextThreshold, DEFAULT_CONTEXT_LIMIT } from "./lib/context-utils";
import { Mode, getNextMode } from "./lib/mode-utils";
import { createEventHandler } from "./lib/event-handlers";
import {
  useSession,
  useStreamingMessages,
  usePlanningMode,
  usePermissions,
  useTodoPanel,
  useQuestionPanel,
  useLocalCommands,
} from "./hooks";
import "./App.css";

function App() {
  // ============================================================================
  // Constants and Refs
  // ============================================================================

  const CONTEXT_LIMIT = DEFAULT_CONTEXT_LIMIT;

  // Capture SolidJS owner for restoring reactive context in async callbacks
  const owner = getOwner();

  // Ref to CommandInput for focus management
  let commandInputRef: CommandInputHandle | undefined;

  // ============================================================================
  // Hooks Initialization
  // ============================================================================

  // Session management
  const session = useSession();

  // Todo panel (needs owner for setTimeout)
  const todoPanel = useTodoPanel({ owner });

  // Streaming messages (with onFinish callback for todo panel)
  const streaming = useStreamingMessages({
    onFinish: () => todoPanel.startHideTimer(),
  });

  // Planning mode (submitMessage will be wired up below)
  const planning = usePlanningMode({
    submitMessage: async (msg) => handleSubmit(msg),
  });

  // Question panel (submitMessage and focusInput wired up)
  const questionPanel = useQuestionPanel({
    submitMessage: async (msg) => handleSubmit(msg),
    focusInput: () => commandInputRef?.focus(),
  });

  // Permissions (needs owner and mode accessor)
  const [currentMode, setCurrentMode] = createSignal<Mode>("normal");
  const permissions = usePermissions({
    owner,
    getCurrentMode: currentMode,
  });

  // Local commands (slash commands + keyboard shortcuts)
  const localCommands = useLocalCommands({
    streaming,
    session,
    owner,
  });

  // ============================================================================
  // Local State (not extracted to hooks)
  // ============================================================================

  // Context warning state
  const [warningDismissed, setWarningDismissed] = createSignal(false);


  // Track compaction for before/after token display
  const [lastCompactionPreTokens, setLastCompactionPreTokens] = createSignal<number | null>(null);
  const [compactionMessageId, setCompactionMessageId] = createSignal<string | null>(null);

  // Force scroll to bottom when user sends a new message
  const [forceScroll, setForceScroll] = createSignal(false);

  // ============================================================================
  // Computed Values
  // ============================================================================

  // Compute context threshold level
  const contextThreshold = () => {
    const used = session.sessionInfo().totalContext || 0;
    return getContextThreshold(used, CONTEXT_LIMIT);
  };

  // ============================================================================
  // Event Handler Setup
  // ============================================================================

  // Create event handler with all dependencies injected
  const coreEventHandler = createEventHandler({
    // Message state (from streaming hook)
    setMessages: streaming.setMessages,
    setStreamingContent: streaming.setStreamingContent,
    setStreamingBlocks: streaming.setStreamingBlocks,
    setStreamingThinking: streaming.setStreamingThinking,

    // Tool state (from streaming hook)
    setCurrentToolUses: streaming.setCurrentToolUses,

    // Todo state (from todoPanel hook)
    setCurrentTodos: todoPanel.setCurrentTodos,
    setShowTodoPanel: todoPanel.setShowTodoPanel,
    setTodoPanelHiding: todoPanel.setTodoPanelHiding,

    // Question state (from questionPanel hook)
    setPendingQuestions: questionPanel.setPendingQuestions,
    setShowQuestionPanel: questionPanel.setShowQuestionPanel,

    // Planning state (from planning hook)
    setIsPlanning: planning.setIsPlanning,
    setPlanFilePath: planning.setPlanFilePath,
    setShowPlanApproval: planning.setShowPlanApproval,
    setPlanContent: planning.setPlanContent,

    // Permission state (from permissions hook)
    setPendingPermission: permissions.setPendingPermission,

    // Session state (from session hook)
    setSessionActive: session.setSessionActive,
    setSessionInfo: session.setSessionInfo,
    setError: streaming.setError,
    setIsLoading: streaming.setIsLoading,

    // Compaction tracking (local state)
    setLastCompactionPreTokens,
    setCompactionMessageId,
    setWarningDismissed,

    // State accessors
    getSessionInfo: session.sessionInfo,
    getCurrentToolUses: streaming.currentToolUses,
    getStreamingBlocks: streaming.streamingBlocks,
    getPlanFilePath: planning.planFilePath,
    getLastCompactionPreTokens: lastCompactionPreTokens,
    getCompactionMessageId: compactionMessageId,

    // Mutable refs (from streaming hook)
    toolInputRef: streaming.toolInputRef,
    todoJsonRef: streaming.todoJsonRef,
    questionJsonRef: streaming.questionJsonRef,
    isCollectingTodoRef: streaming.isCollectingTodoRef,
    isCollectingQuestionRef: streaming.isCollectingQuestionRef,
    pendingResultsRef: streaming.pendingResultsRef,

    // Callbacks
    generateMessageId: streaming.generateId,
    finishStreaming: streaming.finishStreaming,
  });

  // Wrapper that adds logging
  const handleEvent = (event: Parameters<typeof coreEventHandler>[0]) => {
    const ts = new Date().toISOString().split("T")[1];
    console.log(`[${ts}] Event received:`, event.type, event);
    coreEventHandler(event);
  };

  // ============================================================================
  // Actions
  // ============================================================================

  const cycleMode = () => {
    setCurrentMode(getNextMode(currentMode()));
  };

  // Main message submission handler
  const handleSubmit = async (text: string) => {
    // Handle local commands (slash commands like /sync, /clear, etc.)
    if (await localCommands.dispatch(text)) {
      return;
    }

    if (streaming.isLoading()) return;

    // Force scroll to bottom on new user message
    setForceScroll(true);
    setTimeout(() => setForceScroll(false), 100);

    // Reset streaming state
    streaming.resetStreamingState();

    // Add user message
    streaming.setMessages((prev) => [
      ...prev,
      {
        id: streaming.generateId(),
        role: "user",
        content: text,
      },
    ]);

    try {
      console.log("[SUBMIT] Calling sendMessage...");
      await sendMessage(text, handleEvent, owner);
      console.log("[SUBMIT] sendMessage returned");
    } catch (e) {
      console.error("[SUBMIT] Error:", e);
      streaming.setError(`Error: ${e}`);
      streaming.setIsLoading(false);
    }
  };

  // ============================================================================
  // Keyboard Handler
  // ============================================================================

  // Keyboard handler - delegates to localCommands for all shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    localCommands.handleKeyDown(e);
  };

  // ============================================================================
  // Lifecycle
  // ============================================================================

  onMount(async () => {
    console.log("[MOUNT] Starting session...");

    // Add keyboard listener for local commands
    window.addEventListener("keydown", handleKeyDown, true);

    try {
      await session.startSession();
      permissions.startPolling();
    } catch (e) {
      streaming.setError(`Failed to start session: ${e}`);
    }
  });

  onCleanup(() => {
    permissions.stopPolling();
    window.removeEventListener("keydown", handleKeyDown, true);
  });

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div class="app">
      {/* Fixed top bar background */}
      <div class="top-bar"></div>
      {/* Drag region for window */}
      <div class="drag-region" data-tauri-drag-region="true"></div>

      {/* Centered directory indicator */}
      <div
        class="dir-indicator"
        classList={{ connected: session.sessionActive(), disconnected: !session.sessionActive() }}
      >
        <Show when={session.sessionActive()} fallback={<span class="status-icon">⊘</span>}>
          <span class="status-icon">⚡</span>
        </Show>
        <Show when={session.workingDir()}>
          <span class="working-dir" title={session.workingDir()!}>
            {session.workingDir()!.split("/").pop() || session.workingDir()}
          </span>
        </Show>
      </div>

      {/* Right-aligned token usage */}
      <Show when={session.sessionActive()}>
        <div
          class="token-indicator"
          classList={{
            warning: contextThreshold() === "warning",
            critical: contextThreshold() === "critical",
          }}
        >
          <span class="token-icon">◈</span>
          <span class="token-count">
            {session.sessionInfo().totalContext
              ? `${Math.round(session.sessionInfo().totalContext! / 1000)}k`
              : "—"}
          </span>
        </div>
      </Show>

      {/* Planning Mode Banner */}
      <Show when={planning.isPlanning()}>
        <PlanningBanner planFile={planning.planFilePath()} />
      </Show>

      <Show when={streaming.error()}>
        <div class="error-banner">
          {streaming.error()}
          <button onClick={() => streaming.setError(null)}>Dismiss</button>
        </div>
      </Show>

      {/* Context Warning - clickable text in title bar */}
      <Show when={contextThreshold() !== "ok" && !warningDismissed()}>
        <div
          class={`context-warning ${contextThreshold()}`}
          onClick={() => handleSubmit("/compact")}
          title="Click to compact conversation"
        >
          <span class="warning-icon">⚠</span>
          <span class="warning-text">
            {contextThreshold() === "critical" && "Context 75%+ — click to compact"}
            {contextThreshold() === "warning" && "Context 60%+ — click to compact"}
          </span>
        </div>
      </Show>

      <main class="app-main">
        <MessageList
          messages={streaming.messages()}
          streamingContent={streaming.isLoading() ? streaming.streamingContent() : undefined}
          streamingToolUses={streaming.isLoading() ? streaming.currentToolUses() : undefined}
          streamingBlocks={streaming.isLoading() ? streaming.streamingBlocks() : undefined}
          streamingThinking={streaming.isLoading() ? streaming.streamingThinking() : undefined}
          showThinking={streaming.showThinking()}
          forceScrollToBottom={forceScroll()}
        />
      </main>

      <footer class="app-footer">
        <CommandInput
          ref={(handle) => (commandInputRef = handle)}
          onSubmit={handleSubmit}
          disabled={streaming.isLoading() || !session.sessionActive()}
          placeholder={
            session.sessionActive() ? "Type a message... (Enter to send, Shift+Tab to change mode)" : ""
          }
          mode={currentMode()}
          onModeChange={cycleMode}
        />
      </footer>

      {/* Floating Todo Panel */}
      <Show when={todoPanel.showTodoPanel() && todoPanel.currentTodos().length > 0}>
        <TodoPanel todos={todoPanel.currentTodos()} hiding={todoPanel.todoPanelHiding()} />
      </Show>

      {/* Question Panel Overlay */}
      <Show when={questionPanel.showQuestionPanel() && questionPanel.pendingQuestions().length > 0}>
        <div class="question-overlay">
          <QuestionPanel
            questions={questionPanel.pendingQuestions()}
            onAnswer={questionPanel.handleQuestionAnswer}
          />
        </div>
      </Show>

      {/* Plan Approval Modal */}
      <Show when={planning.showPlanApproval()}>
        <PlanApprovalModal
          planContent={planning.planContent()}
          planFile={planning.planFilePath()}
          onApprove={planning.handlePlanApprove}
          onRequestChanges={planning.handlePlanRequestChanges}
          onCancel={planning.handlePlanCancel}
        />
      </Show>

      {/* Inline Permission Dialog */}
      <Show when={permissions.pendingPermission()}>
        <div class="permission-container">
          <PermissionDialog
            toolName={permissions.pendingPermission()!.toolName}
            toolInput={permissions.pendingPermission()!.toolInput}
            description={permissions.pendingPermission()!.description}
            onAllow={permissions.handlePermissionAllow}
            onDeny={permissions.handlePermissionDeny}
          />
        </div>
      </Show>

    </div>
  );
}

export default App;
