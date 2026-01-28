import { createSignal, onMount, onCleanup, Show, getOwner } from "solid-js";
import MessageList from "./components/MessageList";
import CommandInput, { CommandInputHandle } from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel from "./components/QuestionPanel";
import PlanningBanner from "./components/PlanningBanner";
import PlanApprovalModal from "./components/PlanApprovalModal";
import PermissionDialog from "./components/PermissionDialog";
import Sidebar from "./components/Sidebar";
// import StartupSplash from "./components/StartupSplash";
import { sendMessage, resumeSession, getSessionHistory, clearSession, sendPermissionResponse, saveWindowSize } from "./lib/tauri";
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
  useSidebar,
  useSettings,
} from "./hooks";
import SettingsModal from "./components/SettingsModal";
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
  const [currentMode, setCurrentMode] = createSignal<Mode>("auto");
  const permissions = usePermissions({
    owner,
    getCurrentMode: currentMode,
  });

  // Sidebar (session history) - initialized before localCommands so it can be passed
  const sidebar = useSidebar({
    owner,
    workingDir: () => session.workingDir(),
  });

  // Settings modal
  const settings = useSettings();

  // Local commands (slash commands + keyboard shortcuts)
  const localCommands = useLocalCommands({
    streaming,
    session,
    sidebar,
    owner,
    onOpenSettings: settings.openSettings,
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
    getCurrentMode: currentMode,
    sendPermissionResponse,

    // Session state (from session hook)
    setSessionActive: session.setSessionActive,
    setSessionInfo: session.setSessionInfo,
    setError: streaming.setError,
    setIsLoading: streaming.setIsLoading,

    // Launch session tracking (for "Original Session" feature)
    getLaunchSessionId: session.launchSessionId,
    setLaunchSessionId: session.setLaunchSessionId,

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

  // Start a new session from the sidebar - completely blank screen
  const handleNewSession = async () => {
    console.log("[NEW_SESSION] Starting new session");

    // Close the sidebar first
    sidebar.toggleSidebar();

    // Reset launch session ID so the new session becomes the "home"
    session.setLaunchSessionId(null);

    // Clear all messages completely (blank screen, no dividers)
    streaming.setMessages([]);
    streaming.resetStreamingState();
    streaming.setError(null);

    // Reset context display
    session.setSessionInfo((prev) => ({
      ...prev,
      totalContext: prev.baseContext || 0,
    }));

    // Restart Claude to get a fresh session
    // The ready event handler will capture the new session ID
    await clearSession(handleEvent, owner);
  };

  // Return to the original session (the one created when app launched)
  // This works even if the original session was blank (never saved)
  const handleReturnToOriginal = async () => {
    const launchId = session.launchSessionId();
    if (!launchId) {
      console.log("[ORIGINAL] No launch session ID");
      return;
    }

    console.log("[ORIGINAL] Returning to original session:", launchId);

    // Check if the launch session exists in the sessions list (has been saved)
    const sessionExists = sidebar.sessions().some((s) => s.sessionId === launchId);

    if (sessionExists) {
      // Session was saved (user typed messages), resume it normally
      console.log("[ORIGINAL] Session exists, resuming normally");
      await handleResumeSession(launchId);
    } else {
      // Session was never saved (user never typed anything)
      // Return to blank state without changing the launch session ID
      console.log("[ORIGINAL] Session not saved, returning to blank state");

      // Close the sidebar
      sidebar.toggleSidebar();

      // Clear all messages completely (blank screen)
      streaming.setMessages([]);
      streaming.resetStreamingState();
      streaming.setError(null);

      // Reset context display
      session.setSessionInfo((prev) => ({
        ...prev,
        totalContext: prev.baseContext || 0,
      }));

      // Restart Claude to get a fresh blank session
      // Keep the same launchSessionId so "Original Session" still works
      await clearSession(handleEvent, owner);
    }
  };

  // Resume a session from the sidebar
  const handleResumeSession = async (sessionId: string) => {
    console.log("[RESUME] Resuming session:", sessionId);

    // Clear current messages and reset state
    streaming.setMessages([]);
    streaming.resetStreamingState();
    streaming.setError(null);

    // Close the sidebar
    sidebar.toggleSidebar();

    const workingDir = session.workingDir();
    if (!workingDir) {
      streaming.setError("No working directory set");
      return;
    }

    try {
      // First, load the session history to display old messages
      console.log("[RESUME] Loading session history...");
      const history = await getSessionHistory(sessionId, workingDir);
      console.log("[RESUME] Loaded", history.length, "messages from history");

      // Convert history to our Message format and display them
      const historyMessages = history.map((msg) => ({
        id: msg.id || streaming.generateId(),
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));
      streaming.setMessages(historyMessages);

      // Scroll to bottom to show most recent messages
      setForceScroll(true);
      setTimeout(() => setForceScroll(false), 100);

      // Now resume the Claude session (restarts CLI with --resume flag)
      console.log("[RESUME] Resuming Claude session...");
      await resumeSession(sessionId, handleEvent);
      console.log("[RESUME] Session resumed successfully");

      // Update session info with new session ID
      session.setSessionInfo((prev) => ({
        ...prev,
        sessionId,
      }));

      // Refresh the sidebar to show updated list
      sidebar.loadSessions();
    } catch (e) {
      console.error("[RESUME] Failed to resume session:", e);
      streaming.setError(`Failed to resume session: ${e}`);
    }
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

      // In plan mode, prepend instructions to analyze without modifying
      let messageToSend = text;
      if (currentMode() === "plan") {
        messageToSend = `[PLAN MODE: Analyze and explain your approach, but do not modify any files or run any commands. Show me what you would do without actually doing it.]\n\n${text}`;
      }

      await sendMessage(messageToSend, handleEvent, owner);
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

  // Refocus input after clicks complete (but not for interactive elements)
  const handleAppClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Always allow refocus for buttons marked with refocus-after class (toggle buttons)
    const refocusButton = target.closest('.refocus-after');
    if (refocusButton) {
      setTimeout(() => {
        commandInputRef?.focus();
      }, 10);
      return;
    }

    // Don't refocus if clicking on interactive elements that need focus
    const interactive = target.closest('button, input, textarea, select, [role="button"], a, .question-panel, .plan-approval-modal, .permission-dialog');
    if (interactive) return;

    // Small delay to let click complete, then refocus
    setTimeout(() => {
      commandInputRef?.focus();
    }, 10);
  };

  // Debounced window resize handler
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  const handleResize = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const width = window.outerWidth;
      const height = window.outerHeight;
      saveWindowSize(width, height).catch(console.error);
    }, 500); // Debounce 500ms
  };

  onMount(async () => {
    console.log("[MOUNT] Starting session...");

    // Add keyboard listener for local commands
    window.addEventListener("keydown", handleKeyDown, true);

    // Add click listener to refocus input
    window.addEventListener("click", handleAppClick, true);

    // Listen for window resize to save size
    window.addEventListener("resize", handleResize);

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
    window.removeEventListener("click", handleAppClick, true);
    window.removeEventListener("resize", handleResize);
    if (resizeTimeout) clearTimeout(resizeTimeout);
  });

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div class="app">
      {/* Session Sidebar */}
      <Sidebar
        collapsed={sidebar.collapsed()}
        onToggle={sidebar.toggleSidebar}
        sessions={sidebar.sessions()}
        currentSessionId={session.sessionInfo().sessionId || null}
        launchSessionId={session.launchSessionId()}
        isLoading={sidebar.isLoading()}
        error={sidebar.error()}
        onResume={handleResumeSession}
        onDelete={sidebar.handleDeleteSession}
        onNewSession={handleNewSession}
        onReturnToOriginal={handleReturnToOriginal}
      />

      {/* Main content area */}
      <div class="app-content">
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
          <Show when={typeof __CT_WORKTREE__ !== "undefined" && __CT_WORKTREE__}>
            <span class="worktree-indicator"> : {__CT_WORKTREE__}</span>
          </Show>
        </div>

        {/* Settings button */}
        <button
          class="settings-btn"
          onClick={settings.openSettings}
          title="Settings (Cmd+,)"
          aria-label="Open settings"
        >
          ⚙
        </button>

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
      </div>

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

      {/* Settings Modal */}
      <Show when={settings.isOpen()}>
        <SettingsModal
          contentMargin={settings.contentMargin()}
          fontFamily={settings.fontFamily()}
          fontSize={settings.fontSize()}
          colorScheme={settings.colorScheme()}
          availableSchemes={settings.availableSchemes()}
          availableFonts={settings.availableFonts}
          saveLocally={settings.saveLocally()}
          onMarginChange={settings.setContentMargin}
          onFontChange={settings.setFontFamily}
          onFontSizeChange={settings.setFontSize}
          onColorSchemeChange={settings.setColorScheme}
          onSaveLocallyChange={settings.setSaveLocally}
          onResetDefaults={settings.resetToDefaults}
          onClose={settings.closeSettings}
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
