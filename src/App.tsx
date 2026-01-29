import { createSignal, onMount, onCleanup, Show, getOwner } from "solid-js";
import { batch, runWithOwner } from "solid-js";
import MessageList from "./components/MessageList";
import CommandInput, { CommandInputHandle } from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel from "./components/QuestionPanel";
import PlanningBanner from "./components/PlanningBanner";
import PlanApprovalModal from "./components/PlanApprovalModal";
import PermissionDialog from "./components/PermissionDialog";
import Sidebar from "./components/Sidebar";
import { sendMessage, resumeSession, getSessionHistory, clearSession, sendPermissionResponse } from "./lib/tauri";
import { getContextThreshold, DEFAULT_CONTEXT_LIMIT } from "./lib/context-utils";
import { Mode, getNextMode } from "./lib/mode-utils";
import { useStore, createEventDispatcher, actions, resetStreamingRefs } from "./lib/store";
import { normalizeClaudeEvent } from "./lib/claude-event-normalizer";
import type { ClaudeEvent } from "./lib/tauri";
import {
  useSession,
  usePermissions,
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
  // Store - Single Source of Truth
  // ============================================================================

  const store = useStore();

  // ============================================================================
  // Hooks (for behavior, not state)
  // ============================================================================

  // Session management (handles startup, working dir)
  const session = useSession();

  // Permission mode state (local, not in store)
  const [currentMode, setCurrentMode] = createSignal<Mode>("auto");

  // Permissions hook (polling logic)
  const permissions = usePermissions({
    owner,
    getCurrentMode: currentMode,
  });

  // Sidebar (session history)
  const sidebar = useSidebar({
    owner,
    workingDir: () => session.workingDir(),
  });

  // Settings modal
  const settings = useSettings();

  // Force scroll to bottom when user sends a new message
  const [forceScroll, setForceScroll] = createSignal(false);

  // ============================================================================
  // Store-based Helpers
  // ============================================================================

  // Create a streaming-style interface for localCommands compatibility
  const streamingInterface = {
    messages: store.messages,
    setMessages: (msgs: Parameters<typeof actions.setMessages>[0] | ((prev: ReturnType<typeof store.messages>) => ReturnType<typeof store.messages>)) => {
      if (typeof msgs === "function") {
        store.dispatch(actions.setMessages(msgs(store.messages())));
      } else {
        store.dispatch(actions.setMessages(msgs));
      }
    },
    isLoading: store.isLoading,
    setIsLoading: (loading: boolean | ((prev: boolean) => boolean)) => {
      if (typeof loading === "function") {
        store.dispatch(actions.setLoading(loading(store.isLoading())));
      } else {
        store.dispatch(actions.setLoading(loading));
      }
    },
    error: store.error,
    setError: (error: string | null | ((prev: string | null) => string | null)) => {
      if (typeof error === "function") {
        store.dispatch(actions.setSessionError(error(store.error())));
      } else {
        store.dispatch(actions.setSessionError(error));
      }
    },
    generateId: store.generateMessageId,
    resetStreamingState: () => {
      store.dispatch(actions.resetStreaming());
      resetStreamingRefs(store.refs);
    },
    finishStreaming: (interrupted = false) => {
      store.dispatch(actions.finishStreaming({ interrupted, generateId: store.generateMessageId }));
    },
    currentToolUses: store.currentToolUses,
    streamingContent: store.streamingContent,
    streamingBlocks: store.streamingBlocks,
    streamingThinking: store.streamingThinking,
    showThinking: store.showThinking,
    setShowThinking: (show: boolean | ((prev: boolean) => boolean)) => {
      if (typeof show === "function") {
        store.dispatch(actions.setShowThinking(show(store.showThinking())));
      } else {
        store.dispatch(actions.setShowThinking(show));
      }
    },
  };

  // Local commands (slash commands + keyboard shortcuts)
  const localCommands = useLocalCommands({
    streaming: streamingInterface,
    session,
    sidebar,
    owner,
    onOpenSettings: settings.openSettings,
  });

  // ============================================================================
  // Computed Values
  // ============================================================================

  // Compute context threshold level
  const contextThreshold = () => {
    const used = store.sessionInfo().totalContext || 0;
    return getContextThreshold(used, CONTEXT_LIMIT);
  };

  // ============================================================================
  // Event Handler Setup
  // ============================================================================

  // Create event dispatcher with minimal context
  const coreEventHandler = createEventDispatcher({
    dispatch: store.dispatch,
    refs: store.refs,
    generateMessageId: store.generateMessageId,

    // External callbacks
    sendPermissionResponse,
    getCurrentMode: currentMode,

    // State accessors for conditional logic
    getSessionInfo: store.sessionInfo,
    getLaunchSessionId: store.launchSessionId,
    getPlanFilePath: store.planFilePath,
    getCompactionPreTokens: store.lastCompactionPreTokens,
    getCompactionMessageId: store.compactionMessageId,
    getCurrentToolUses: store.currentToolUses,
  });

// Wrapper that normalizes events, adds logging, and triggers todo hide timer
  const handleEvent = (event: ClaudeEvent) => {
    const ts = new Date().toISOString().split("T")[1];
    console.log(`[${ts}] Event received (raw):`, event.type, event);

    // Normalize the event to canonical camelCase format
    const normalized = normalizeClaudeEvent(event);

    const wasLoading = store.isLoading();
    coreEventHandler(normalized);

    // Trigger todo panel hide timer when streaming finishes
    if (wasLoading && !store.isLoading()) {
      startTodoHideTimer();
    }

    // Sync session state to useSession hook for session.workingDir() etc.
    // This keeps the session hook in sync for sidebar functionality
    session.setSessionActive(store.sessionActive());
    session.setSessionInfo(store.sessionInfo());
    session.setLaunchSessionId(store.launchSessionId());
  };

  // ============================================================================
  // Todo Panel Hide Timer
  // ============================================================================

  const startTodoHideTimer = () => {
    if (!store.showTodoPanel()) return;

    store.dispatch(actions.setTodoPanelHiding(true));

    setTimeout(() => {
      runWithOwner(owner, () => {
        batch(() => {
          store.dispatch(actions.setTodoPanelVisible(false));
          store.dispatch(actions.setTodoPanelHiding(false));
        });
      });
    }, 2000);
  };

  // ============================================================================
  // Actions
  // ============================================================================

  const cycleMode = () => {
    setCurrentMode(getNextMode(currentMode()));
  };

  // Handle question panel answer
  const handleQuestionAnswer = async (answers: Record<string, string>) => {
    store.dispatch(actions.clearQuestionPanel());

    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });

    const answerText = Object.values(answers).join(", ");
    await handleSubmit(answerText);
  };

  // Plan approval actions
  const handlePlanApprove = async () => {
    store.dispatch(actions.setPlanApprovalVisible(false));
    store.dispatch(actions.setPlanningActive(false));
    store.dispatch(actions.setPlanContent(""));
    await handleSubmit("I approve this plan. Proceed with implementation.");
  };

  const handlePlanRequestChanges = async (feedback: string) => {
    store.dispatch(actions.setPlanApprovalVisible(false));
    await handleSubmit(feedback);
  };

  const handlePlanCancel = async () => {
    store.dispatch(actions.exitPlanning());
    await handleSubmit("Cancel this plan. Let's start over with a different approach.");
  };

  // Start a new session from the sidebar
  const handleNewSession = async () => {
    console.log("[NEW_SESSION] Starting new session");

    sidebar.toggleSidebar();
    store.dispatch(actions.setLaunchSessionId(null));
    store.dispatch(actions.clearMessages());
    store.dispatch(actions.resetStreaming());
    resetStreamingRefs(store.refs);
    store.dispatch(actions.setSessionError(null));

    // Reset context display
    const currentInfo = store.sessionInfo();
    store.dispatch(actions.setSessionInfo({
      ...currentInfo,
      totalContext: currentInfo.baseContext || 0,
    }));

    await clearSession(handleEvent, owner);
  };

  // Return to the original session
  const handleReturnToOriginal = async () => {
    const launchId = store.launchSessionId();
    if (!launchId) {
      console.log("[ORIGINAL] No launch session ID");
      return;
    }

    console.log("[ORIGINAL] Returning to original session:", launchId);

    const sessionExists = sidebar.sessions().some((s) => s.sessionId === launchId);

    if (sessionExists) {
      console.log("[ORIGINAL] Session exists, resuming normally");
      await handleResumeSession(launchId);
    } else {
      console.log("[ORIGINAL] Session not saved, returning to blank state");

      sidebar.toggleSidebar();
      store.dispatch(actions.clearMessages());
      store.dispatch(actions.resetStreaming());
      resetStreamingRefs(store.refs);
      store.dispatch(actions.setSessionError(null));

      const currentInfo = store.sessionInfo();
      store.dispatch(actions.setSessionInfo({
        ...currentInfo,
        totalContext: currentInfo.baseContext || 0,
      }));

      await clearSession(handleEvent, owner);
    }
  };

  // Resume a session from the sidebar
  const handleResumeSession = async (sessionId: string) => {
    console.log("[RESUME] Resuming session:", sessionId);

    store.dispatch(actions.clearMessages());
    store.dispatch(actions.resetStreaming());
    resetStreamingRefs(store.refs);
    store.dispatch(actions.setSessionError(null));

    sidebar.toggleSidebar();

    const workingDir = session.workingDir();
    if (!workingDir) {
      store.dispatch(actions.setSessionError("No working directory set"));
      return;
    }

    try {
      console.log("[RESUME] Loading session history...");
      const history = await getSessionHistory(sessionId, workingDir);
      console.log("[RESUME] Loaded", history.length, "messages from history");

      const historyMessages = history.map((msg) => ({
        id: msg.id || store.generateMessageId(),
        role: msg.role as "user" | "assistant",
        content: msg.content,
      }));
      store.dispatch(actions.setMessages(historyMessages));

      setForceScroll(true);
      setTimeout(() => setForceScroll(false), 100);

      console.log("[RESUME] Resuming Claude session...");
      await resumeSession(sessionId, handleEvent);
      console.log("[RESUME] Session resumed successfully");

      store.dispatch(actions.updateSessionInfo({ sessionId }));

      sidebar.loadSessions();
    } catch (e) {
      console.error("[RESUME] Failed to resume session:", e);
      store.dispatch(actions.setSessionError(`Failed to resume session: ${e}`));
    }
  };

  // Main message submission handler
  const handleSubmit = async (text: string) => {
    if (await localCommands.dispatch(text)) {
      return;
    }

    if (store.isLoading()) return;

    setForceScroll(true);
    setTimeout(() => setForceScroll(false), 100);

    // Reset streaming state
    store.dispatch(actions.resetStreaming());
    resetStreamingRefs(store.refs);

    // Add user message
    store.dispatch(actions.addMessage({
      id: store.generateMessageId(),
      role: "user",
      content: text,
    }));

    try {
      console.log("[SUBMIT] Calling sendMessage...");

      let messageToSend = text;
      if (currentMode() === "plan") {
        messageToSend = `[PLAN MODE: Analyze and explain your approach, but do not modify any files or run any commands. Show me what you would do without actually doing it.]\n\n${text}`;
      }

      await sendMessage(messageToSend, handleEvent, owner);
      console.log("[SUBMIT] sendMessage returned");
    } catch (e) {
      console.error("[SUBMIT] Error:", e);
      store.dispatch(actions.setSessionError(`Error: ${e}`));
      store.dispatch(actions.setLoading(false));
    }
  };

  // ============================================================================
  // Keyboard Handler
  // ============================================================================

  const handleKeyDown = (e: KeyboardEvent) => {
    localCommands.handleKeyDown(e);
  };

  // ============================================================================
  // Lifecycle
  // ============================================================================

  const handleRefocusClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const focusableSelector = 'input:not(.command-input), select, [contenteditable="true"]';
    if (target.matches(focusableSelector) || target.closest(focusableSelector)) {
      return;
    }
    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });
  };

  onMount(async () => {
    console.log("[MOUNT] Starting session...");

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleRefocusClick, true);

    try {
      await session.startSession();

      // Sync session state to store after startup
      // The Tauri startSession doesn't emit events, so we need to sync manually
      store.dispatch(actions.setSessionActive(true));

      permissions.startPolling();
    } catch (e) {
      store.dispatch(actions.setSessionError(`Failed to start session: ${e}`));
    }
  });

  onCleanup(() => {
    permissions.stopPolling();
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("click", handleRefocusClick, true);
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
        currentSessionId={store.sessionInfo().sessionId || null}
        launchSessionId={store.launchSessionId()}
        isLoading={sidebar.isLoading()}
        error={sidebar.error()}
        onResume={handleResumeSession}
        onDelete={sidebar.handleDeleteSession}
        onNewSession={handleNewSession}
        onReturnToOriginal={handleReturnToOriginal}
      />

      {/* Main content area */}
      <div class="app-content">
        <div class="top-bar"></div>
        <div class="drag-region" data-tauri-drag-region="true"></div>

        <Show when={session.workingDir()}>
          <div class="dir-indicator" title={session.workingDir()!}>
            <Show when={__CT_WORKTREE__}>
              <span class="worktree-indicator">{__CT_WORKTREE__}</span>
              <span class="worktree-separator">:</span>
            </Show>
            {session.workingDir()!.split("/").pop() || session.workingDir()}
          </div>
        </Show>

        <button
          class="settings-btn"
          onClick={settings.openSettings}
          title="Settings (Cmd+,)"
          aria-label="Open settings"
        >
          ⚙
        </button>

        <div
          class="connection-icon"
          classList={{ connected: store.sessionActive(), disconnected: !store.sessionActive() }}
          title={store.sessionActive() ? "Connected" : "Disconnected"}
        >
          <Show when={store.sessionActive()} fallback="⊘">
            ⚡
          </Show>
        </div>

        <Show when={store.sessionActive()}>
          <div
            class="token-indicator"
            classList={{
              warning: contextThreshold() === "warning",
              critical: contextThreshold() === "critical",
            }}
          >
            <span class="token-icon">◈</span>
            <span class="token-count">
              {store.sessionInfo().totalContext
                ? `${Math.round(store.sessionInfo().totalContext! / 1000)}k`
                : "—"}
            </span>
          </div>
        </Show>

        <Show when={store.isPlanning()}>
          <PlanningBanner planFile={store.planFilePath()} />
        </Show>

        <Show when={store.error()}>
          <div class="error-banner">
            {store.error()}
            <button onClick={() => store.dispatch(actions.setSessionError(null))}>Dismiss</button>
          </div>
        </Show>

        <Show when={contextThreshold() !== "ok" && !store.warningDismissed()}>
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
            messages={store.messages()}
            streamingContent={store.isLoading() ? store.streamingContent() : undefined}
            streamingToolUses={store.isLoading() ? store.currentToolUses() : undefined}
            streamingBlocks={store.isLoading() ? store.streamingBlocks() : undefined}
            streamingThinking={store.isLoading() ? store.streamingThinking() : undefined}
            showThinking={store.showThinking()}
            forceScrollToBottom={forceScroll()}
          />
        </main>

        <footer class="app-footer">
          <CommandInput
            ref={(handle) => (commandInputRef = handle)}
            onSubmit={handleSubmit}
            disabled={store.isLoading() || !store.sessionActive()}
            placeholder={
              store.sessionActive() ? "Type a message... (Enter to send, Shift+Tab to change mode)" : ""
            }
            mode={currentMode()}
            onModeChange={cycleMode}
          />
        </footer>
      </div>

      {/* Floating Todo Panel */}
      <Show when={store.showTodoPanel() && store.currentTodos().length > 0}>
        <TodoPanel todos={store.currentTodos()} hiding={store.todoPanelHiding()} />
      </Show>

      {/* Question Panel Overlay */}
      <Show when={store.showQuestionPanel() && store.pendingQuestions().length > 0}>
        <div class="question-overlay">
          <QuestionPanel
            questions={store.pendingQuestions()}
            onAnswer={handleQuestionAnswer}
          />
        </div>
      </Show>

      {/* Plan Approval Modal */}
      <Show when={store.showPlanApproval()}>
        <PlanApprovalModal
          planContent={store.planContent()}
          planFile={store.planFilePath()}
          onApprove={handlePlanApprove}
          onRequestChanges={handlePlanRequestChanges}
          onCancel={handlePlanCancel}
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
      <Show when={store.pendingPermission()}>
        <div class="permission-container">
          <PermissionDialog
            toolName={store.pendingPermission()!.toolName}
            toolInput={store.pendingPermission()!.toolInput}
            description={store.pendingPermission()!.description}
            onAllow={permissions.handlePermissionAllow}
            onDeny={permissions.handlePermissionDeny}
          />
        </div>
      </Show>
    </div>
  );
}

export default App;
