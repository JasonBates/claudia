import { createSignal, createEffect, onMount, onCleanup, Show, getOwner } from "solid-js";
import { batch, runWithOwner } from "solid-js";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitTo } from "@tauri-apps/api/event";
import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import MessageList from "./components/MessageList";
import CommandInput, { CommandInputHandle } from "./components/CommandInput";
import TodoPanel from "./components/TodoPanel";
import QuestionPanel, { type QuestionAnswers } from "./components/QuestionPanel";
import PlanApprovalBar from "./components/PlanApprovalBar";
import PermissionDialog from "./components/PermissionDialog";
import Sidebar from "./components/Sidebar";
import { sendMessage, resumeSession, getSessionHistory, clearSession, sendPermissionResponse, sendQuestionResponse, sendQuestionCancel, getSchemeColors, openInNewWindow, getConfig, saveConfig, checkForUpdate, downloadAndInstallUpdate, restartApp, getAppVersion, hasBotApiKey } from "./lib/tauri";
import type { ThemeSettings } from "./lib/theme-utils";
import { getContextThreshold, DEFAULT_CONTEXT_LIMIT } from "./lib/context-utils";
import { Mode, getNextMode, isValidMode } from "./lib/mode-utils";
import { useStore, createEventDispatcher, actions, resetStreamingRefs } from "./lib/store";
import { normalizeClaudeEvent } from "./lib/claude-event-normalizer";
import type { ClaudeEvent } from "./lib/tauri";
import type { ImageAttachment } from "./lib/types";
import {
  useSession,
  usePermissions,
  useLocalCommands,
  useSidebar,
  useSettings,
  useKeyboardCursor,
} from "./hooks";
import SettingsModal from "./components/SettingsModal";
import BotSettings from "./components/BotSettings";
import UpdateBanner from "./components/UpdateBanner";
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

  // Ref to track todo panel hide timer (so it can be cancelled)
  let todoHideTimerRef: ReturnType<typeof setTimeout> | null = null;

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
  // Use localStorage for instant access on load, with Tauri config as source of truth
  const getInitialMode = (): Mode => {
    try {
      const stored = localStorage.getItem("claudia_permission_mode");
      if (stored && isValidMode(stored)) {
        return stored;
      }
    } catch {
      // localStorage may be unavailable
    }
    return "auto";
  };
  const [currentMode, setCurrentMode] = createSignal<Mode>(getInitialMode());

  // Bot settings panel state
  const [botSettingsOpen, setBotSettingsOpen] = createSignal(false);
  const [botSettingsError, setBotSettingsError] = createSignal<string | null>(null);

  // App version (loaded from Tauri on mount)
  const [appVersion, setAppVersion] = createSignal<string>("0.1.0");

  // Permissions hook (polling logic + handlers)
  const permissions = usePermissions({
    owner,
    getCurrentMode: currentMode,
    pendingPermission: store.pendingPermission,
    clearPendingPermission: () => store.dispatch(actions.setPendingPermission(null)),
    // Bot mode review state
    isReviewing: store.permissionIsReviewing,
    setIsReviewing: (value: boolean) => store.dispatch(actions.setPermissionReviewing(value)),
    reviewResult: store.permissionReviewResult,
    setReviewResult: (value) => store.dispatch(actions.setReviewResult(value)),
    // Open settings when API key is missing or invalid
    onBotApiKeyRequired: () => {
      setBotSettingsError("API key required for BotGuard");
      setBotSettingsOpen(true);
    },
  });

  // Sidebar (session history)
  const sidebar = useSidebar({
    owner,
    workingDir: () => session.workingDir(),
  });

  // Settings modal
  const settings = useSettings();

  // Hide mouse cursor while typing
  const keyboardCursor = useKeyboardCursor();

  // Force scroll to bottom when user sends a new message
  const [forceScroll, setForceScroll] = createSignal(false);

  // Window-level drag state for drop zone overlay (Tauri native)
  const [windowDragOver, setWindowDragOver] = createSignal(false);

  // Track plan viewer window
  const [planWindowOpen, setPlanWindowOpen] = createSignal(false);

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

  // Handle opening a new window for the current project
  const handleOpenNewWindow = async () => {
    const dir = session.workingDir();
    if (!dir) return;

    console.log("[NEW_WINDOW] Opening new window for:", dir);
    try {
      await openInNewWindow(dir);
    } catch (e) {
      console.error("[NEW_WINDOW] Failed:", e);
      store.dispatch(actions.setSessionError(`Failed to open new window: ${e}`));
    }
  };

  // Local commands (slash commands + keyboard shortcuts)
  const localCommands = useLocalCommands({
    streaming: streamingInterface,
    session,
    sidebar,
    owner,
    onOpenSettings: settings.openSettings,
    onFocusInput: () => commandInputRef?.focus(),
    onOpenNewWindow: handleOpenNewWindow,
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
    getPlanningToolId: store.planningToolId,
    isPlanning: store.isPlanning,
    getCompactionPreTokens: store.lastCompactionPreTokens,
    getCompactionMessageId: store.compactionMessageId,
    getCurrentToolUses: store.currentToolUses,
  });

// Wrapper that normalizes events and triggers todo hide timer
  const handleEvent = (event: ClaudeEvent) => {
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

    // Clear any existing timer first
    if (todoHideTimerRef) {
      clearTimeout(todoHideTimerRef);
      todoHideTimerRef = null;
    }

    // Only auto-hide if all tasks are completed
    const todos = store.currentTodos();
    const hasIncompleteTasks = todos.some(
      (t) => t.status === "pending" || t.status === "in_progress"
    );
    if (hasIncompleteTasks) {
      return; // Don't hide while there are still tasks to do
    }

    store.dispatch(actions.setTodoPanelHiding(true));

    todoHideTimerRef = setTimeout(() => {
      runWithOwner(owner, () => {
        batch(() => {
          store.dispatch(actions.setTodoPanelVisible(false));
          store.dispatch(actions.setTodoPanelHiding(false));
        });
      });
      todoHideTimerRef = null;
    }, 2000);
  };

  // Cancel hide timer when panel is re-shown (e.g., new TodoWrite)
  createEffect(() => {
    const isVisible = store.showTodoPanel();
    const isHiding = store.todoPanelHiding();

    // If panel is visible and not in hiding state, cancel any pending hide timer
    if (isVisible && !isHiding && todoHideTimerRef) {
      clearTimeout(todoHideTimerRef);
      todoHideTimerRef = null;
    }
  });

  // ============================================================================
  // Actions
  // ============================================================================

  const cycleMode = async () => {
    const prevMode = currentMode();
    const nextMode = getNextMode(prevMode);
    console.log("[CYCLE_MODE] Current:", prevMode, "-> Next:", nextMode);

    // If switching away from bot mode while a review is in progress, cancel it
    if (prevMode === "bot") {
      console.log("[CYCLE_MODE] Leaving bot mode, clearing review state");
      store.dispatch(actions.setPermissionReviewing(false));
      store.dispatch(actions.setReviewResult(null));
    }

    // Helper to set mode and persist to config + localStorage
    const setAndSaveMode = async (mode: Mode) => {
      setCurrentMode(mode);
      // Save to localStorage for instant access on next load
      try {
        localStorage.setItem("claudia_permission_mode", mode);
      } catch {
        // localStorage may be unavailable
      }
      // Save to Tauri config (source of truth)
      try {
        const config = await getConfig();
        config.permission_mode = mode;
        await saveConfig(config);
        console.log("[CYCLE_MODE] Saved mode to config:", mode);
      } catch (e) {
        console.error("[CYCLE_MODE] Failed to save mode:", e);
      }
    };

    // Note: We no longer auto-open settings when switching to bot mode without a key.
    // Users can click the settings cog if they want to configure BotGuard.
    // This avoids the annoying popup every time users cycle through modes.

    await setAndSaveMode(nextMode);
  };

  // Open bot settings panel
  const openBotSettings = () => {
    setBotSettingsError(null);
    setBotSettingsOpen(true);
  };

  // Close bot settings panel
  const closeBotSettings = () => {
    setBotSettingsOpen(false);
    setBotSettingsError(null);
  };

  // Handle question panel answer
  const handleQuestionAnswer = async (answers: QuestionAnswers) => {
    const requestId = store.questionRequestId();
    const questions = store.pendingQuestions();

    store.dispatch(actions.clearQuestionPanel());

    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });

    // Send response via control protocol if we have a request ID
    if (requestId) {
      console.log("[QUESTION_ANSWER] Sending via control protocol:", requestId, answers);
      await sendQuestionResponse(requestId, questions, answers);
    } else {
      // Fallback: send as regular message (old behavior)
      console.log("[QUESTION_ANSWER] No request ID, sending as message");
      const answerText = Object.values(answers)
        .map(v => Array.isArray(v) ? v.join(", ") : v)
        .join("; ");
      await handleSubmit(answerText);
    }
  };

  // Handle question panel cancel
  const handleQuestionCancel = async () => {
    const requestId = store.questionRequestId();

    console.log("[QUESTION_CANCEL] User cancelled question panel, requestId:", requestId);
    store.dispatch(actions.clearQuestionPanel());

    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });

    // Send deny response so Claude can continue
    if (requestId) {
      await sendQuestionCancel(requestId);
    }
  };

  // Plan approval actions - send control_response to the ExitPlanMode permission request
  const handlePlanApprove = async () => {
    const requestId = store.planPermissionRequestId();
    // Update UI immediately for responsiveness
    store.dispatch(actions.exitPlanning());
    setPlanWindowOpen(false);
    // Then send the approval (don't block UI on this)
    if (requestId) {
      console.log("[PLAN_APPROVE] Sending approval control_response, requestId:", requestId);
      sendPermissionResponse(requestId, true, false).catch(err => {
        console.error("[PLAN_APPROVE] Failed to send approval:", err);
      });
    }
  };

  const handlePlanRequestChanges = async (feedback: string) => {
    const requestId = store.planPermissionRequestId();
    // Reset ready state but keep planning active for iteration
    store.dispatch(actions.setPlanReady(false));
    store.dispatch(actions.setPlanPermissionRequestId(null));

    // Deny ExitPlanMode with feedback message - Claude stays in plan mode and iterates
    // The message is passed to Claude as context for revising the plan
    if (requestId) {
      const feedbackMessage = `User requested changes to the plan. Please revise the plan based on this feedback:\n\n${feedback}`;
      console.log("[PLAN_FEEDBACK] Denying ExitPlanMode with feedback, requestId:", requestId);
      await sendPermissionResponse(requestId, false, false, undefined, feedbackMessage);
    }
  };

  const handlePlanCancel = async () => {
    const requestId = store.planPermissionRequestId();
    // Update UI immediately for responsiveness
    store.dispatch(actions.exitPlanning());
    setPlanWindowOpen(false);
    // Then send the denial (don't block UI on this)
    if (requestId) {
      console.log("[PLAN_CANCEL] Sending denial control_response, requestId:", requestId);
      sendPermissionResponse(requestId, false, false).catch(err => {
        console.error("[PLAN_CANCEL] Failed to send denial:", err);
      });
    }
  };

  // Open plan in a separate window with file path
  const openPlanWindow = async (filePath: string) => {
    // Quick check using local state
    if (planWindowOpen()) {
      // Try to focus existing window
      const existing = await WebviewWindow.getByLabel("plan-viewer");
      if (existing) {
        await existing.setFocus();
        return;
      }
      // Window was closed externally, reset state
      setPlanWindowOpen(false);
    }

    console.log("[PLAN_WINDOW] Opening plan viewer for:", filePath);

    // Get current theme settings
    const currentScheme = settings.colorScheme() || "Gruvbox Dark";

    // Fetch the background color for the current scheme
    let backgroundColor = "#282828"; // Default fallback (Gruvbox Dark)
    try {
      const colors = await getSchemeColors(currentScheme);
      backgroundColor = colors.bg;
    } catch (e) {
      console.error("[PLAN_WINDOW] Failed to get scheme colors:", e);
    }

    // Build URL with theme settings
    const params = new URLSearchParams({
      "plan-viewer": "true",
      file: filePath,
      colorScheme: currentScheme,
      fontFamily: settings.fontFamily(),
      fontSize: String(settings.fontSize()),
      contentMargin: String(settings.contentMargin()),
    });

    const planWindow = new WebviewWindow("plan-viewer", {
      url: `index.html?${params.toString()}`,
      title: "Plan",
      width: 600,
      height: 800,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      backgroundColor,
    });

    planWindow.once("tauri://created", () => {
      console.log("[PLAN_WINDOW] Window created");
      setPlanWindowOpen(true);
    });

    planWindow.once("tauri://error", (e) => {
      console.error("[PLAN_WINDOW] Failed to create window:", e);
    });

    planWindow.once("tauri://destroyed", () => {
      console.log("[PLAN_WINDOW] Window destroyed");
      setPlanWindowOpen(false);
    });
  };

  // Emit plan content updates to the plan viewer window
  createEffect(() => {
    const content = store.planContent();
    if (planWindowOpen() && content) {
      console.log("[PLAN_CONTENT] Emitting update to plan-viewer");
      emitTo("plan-viewer", "plan-content-updated", content);
    }
  });

  // Emit theme updates to the plan viewer window when settings change
  createEffect(() => {
    // Track all theme-related settings
    const scheme = settings.colorScheme();
    const font = settings.fontFamily();
    const size = settings.fontSize();
    const margin = settings.contentMargin();

    // Only emit if plan window is open and we have a scheme
    if (planWindowOpen() && scheme) {
      const themeSettings: ThemeSettings = {
        colorScheme: scheme,
        fontFamily: font,
        fontSize: size,
        contentMargin: margin,
      };
      console.log("[PLAN_THEME] Emitting theme update to plan-viewer");
      emitTo("plan-viewer", "theme-updated", themeSettings).catch(() => {
        // Plan viewer window may have been closed, ignore errors
      });
    }
  });

  // Automatically open plan window when plan is ready AND we have a file path
  createEffect(() => {
    const ready = store.planReady();
    const planning = store.isPlanning();
    const filePath = store.planFilePath();
    const windowOpen = planWindowOpen();

    console.log("[PLAN_AUTO_OPEN] State:", { ready, planning, filePath, windowOpen });

    if (ready && planning && filePath && !windowOpen) {
      console.log("[PLAN_AUTO_OPEN] Opening plan window...");
      openPlanWindow(filePath);
    }
  });

  // Re-read plan file when Edit tool modifies it
  createEffect(() => {
    const needsRefresh = store.planNeedsRefresh();
    if (needsRefresh) {
      console.log("[PLAN_REFRESH] Re-reading plan file:", needsRefresh);
      readTextFile(needsRefresh)
        .then((content) => {
          console.log("[PLAN_REFRESH] Got updated content");
          store.dispatch(actions.setPlanContent(content));
          store.dispatch(actions.clearPlanNeedsRefresh());
        })
        .catch((err) => {
          console.error("[PLAN_REFRESH] Failed to read file:", err);
          store.dispatch(actions.clearPlanNeedsRefresh());
        });
    }
  });

  // Reset all session-related state (used when switching/starting sessions)
  const resetSessionState = () => {
    store.dispatch(actions.clearMessages());
    store.dispatch(actions.resetStreaming());
    store.dispatch(actions.exitPlanning());
    resetStreamingRefs(store.refs);
    store.dispatch(actions.setSessionError(null));
  };

  // Start a new session from the sidebar
  const handleNewSession = async () => {
    console.log("[NEW_SESSION] Starting new session");

    sidebar.toggleSidebar();
    store.dispatch(actions.setLaunchSessionId(null));
    resetSessionState();

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
      resetSessionState();

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

    resetSessionState();
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
  const handleSubmit = async (text: string, images?: ImageAttachment[]) => {
    // Only process local commands for text-only messages
    if (!images && await localCommands.dispatch(text)) {
      return;
    }

    // In bot mode, require API key before allowing any prompts
    // This prevents partial functionality where heuristics work but LLM fallback fails
    if (currentMode() === "bot") {
      try {
        const hasKey = await hasBotApiKey();
        if (!hasKey) {
          setBotSettingsError("API key required for BotGuard mode");
          setBotSettingsOpen(true);
          return;
        }
      } catch (e) {
        setBotSettingsError(`Failed to check API key: ${e}`);
        setBotSettingsOpen(true);
        return;
      }
    }

    if (store.isLoading()) return;

    setForceScroll(true);
    setTimeout(() => setForceScroll(false), 100);

    // Reset streaming state
    store.dispatch(actions.resetStreaming());
    resetStreamingRefs(store.refs);

    // Add user message (display text with image placeholders)
    const displayText = images && images.length > 0
      ? `${images.map(() => "[Image]").join(" ")} ${text}`.trim()
      : text;

    store.dispatch(actions.addMessage({
      id: store.generateMessageId(),
      role: "user",
      content: displayText,
    }));

    try {
      console.log("[SUBMIT] Calling sendMessage...", images ? `with ${images.length} images` : "");

      let messageToSend: string;

      if (images && images.length > 0) {
        // Build content blocks array for multimodal message
        const contentBlocks: unknown[] = [];

        // Add images first (Claude processes them in order)
        for (const img of images) {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mediaType,
              data: img.data,
            },
          });
        }

        // Add text if present
        if (text) {
          const textContent = currentMode() === "plan"
            ? `[PLAN MODE: Analyze and explain your approach, but do not modify any files or run any commands. Show me what you would do without actually doing it.]\n\n${text}`
            : text;
          contentBlocks.push({
            type: "text",
            text: textContent,
          });
        }

        // Send as JSON-prefixed message for SDK bridge
        messageToSend = `__JSON__${JSON.stringify({ content: contentBlocks })}`;
      } else {
        // Plain text message (existing behavior)
        messageToSend = currentMode() === "plan"
          ? `[PLAN MODE: Analyze and explain your approach, but do not modify any files or run any commands. Show me what you would do without actually doing it.]\n\n${text}`
          : text;
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
    // Don't steal focus from message list - users need to select text there
    if (target.closest('.message-list')) {
      return;
    }
    requestAnimationFrame(() => {
      commandInputRef?.focus();
    });
  };

  // Tauri drag/drop unlisten function
  let unlistenDragDrop: (() => void) | undefined;

  // Helper to get media type from file extension
  const getMediaTypeFromPath = (path: string): string | null => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      default:
        return null;
    }
  };

  // Handle file drop from Tauri's native drag/drop API
  const handleTauriFileDrop = async (paths: string[]) => {
    if (!commandInputRef) {
      console.log("[TAURI DROP] No commandInputRef");
      return;
    }

    console.log("[TAURI DROP] Processing", paths.length, "files");

    for (const path of paths) {
      const mediaType = getMediaTypeFromPath(path);
      if (!mediaType) {
        console.log("[TAURI DROP] Skipping non-image:", path);
        continue;
      }

      console.log("[TAURI DROP] Loading image:", path);

      try {
        console.log("[TAURI DROP] Calling readFile for:", path);
        // Read file as binary using Tauri's fs plugin
        const fileData = await readFile(path);
        console.log("[TAURI DROP] File read, size:", fileData.byteLength);

        // Create a File-like object to pass to addImageFile
        const fileName = path.split("/").pop() || "image";
        const blob = new Blob([fileData], { type: mediaType });
        const file = new File([blob], fileName, { type: mediaType });
        console.log("[TAURI DROP] Created File object:", file.name, file.type, file.size);

        await commandInputRef.addImageFile(file);
        console.log("[TAURI DROP] addImageFile completed");
      } catch (err) {
        console.error("[TAURI DROP] Error reading file:", path, err);
        // Log more details about the error
        if (err instanceof Error) {
          console.error("[TAURI DROP] Error message:", err.message);
          console.error("[TAURI DROP] Error stack:", err.stack);
        }
      }
    }

    // Focus the input after dropping
    commandInputRef.focus();
  };

  // ============================================================================
  // Auto-Update
  // ============================================================================

  // Ref to hold update check interval ID
  let updateCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Silently check for updates in the background.
   * Doesn't show errors to user unless there's an update available.
   */
  const checkForUpdatesQuietly = async () => {
    // Don't interrupt an active download/install
    const currentStatus = store.updateStatus();
    if (currentStatus === "downloading" || currentStatus === "ready") {
      console.log("[UPDATE] Skipping background check - update in progress");
      return;
    }

    try {
      store.dispatch(actions.setUpdateStatus("checking"));
      const update = await checkForUpdate();
      if (update) {
        console.log("[UPDATE] Update available:", update.version);
        store.dispatch(actions.setUpdateAvailable(update));
      } else {
        console.log("[UPDATE] No update available");
        // Clear any stale update state
        store.dispatch(actions.setUpdateAvailable(null));
        store.dispatch(actions.setUpdateError(null));
      }
      store.dispatch(actions.setUpdateStatus("idle"));
    } catch (e) {
      console.error("[UPDATE] Check failed:", e);
      // Don't show error to user for background check
      store.dispatch(actions.setUpdateStatus("idle"));
    }
  };

  /**
   * Check for updates interactively (from Settings).
   * Throws errors so the UI can show failure state.
   */
  const checkForUpdatesInteractive = async () => {
    store.dispatch(actions.setUpdateStatus("checking"));
    try {
      const update = await checkForUpdate();
      if (update) {
        console.log("[UPDATE] Update available:", update.version);
        store.dispatch(actions.setUpdateAvailable(update));
      } else {
        console.log("[UPDATE] No update available");
        // Clear any stale update state
        store.dispatch(actions.setUpdateAvailable(null));
        store.dispatch(actions.setUpdateError(null));
      }
      store.dispatch(actions.setUpdateStatus("idle"));
    } catch (e) {
      console.error("[UPDATE] Check failed:", e);
      store.dispatch(actions.setUpdateStatus("error"));
      store.dispatch(actions.setUpdateError(`Check failed: ${e}`));
      throw e; // Re-throw so Settings modal can show error state
    }
  };

  const handleDownloadUpdate = async () => {
    store.dispatch(actions.setUpdateStatus("downloading"));
    store.dispatch(actions.setUpdateProgress(0));

    try {
      await downloadAndInstallUpdate((progress) => {
        store.dispatch(actions.setUpdateProgress(progress));
      });
      store.dispatch(actions.setUpdateStatus("ready"));
    } catch (e) {
      console.error("[UPDATE] Download failed:", e);
      store.dispatch(actions.setUpdateError(`Download failed: ${e}`));
      store.dispatch(actions.setUpdateStatus("error"));
    }
  };

  const handleInstallUpdate = async () => {
    await restartApp();
  };

  const handleDismissUpdate = () => {
    const version = store.updateAvailable()?.version;
    if (version) {
      store.dispatch(actions.dismissUpdate(version));
    }
  };

  onMount(async () => {
    console.log("[MOUNT] Starting session...");

    // Load app version from Tauri
    try {
      const version = await getAppVersion();
      setAppVersion(version);
      console.log("[MOUNT] App version:", version);
    } catch (e) {
      console.error("[MOUNT] Failed to get app version:", e);
    }

    // Load saved permission mode from config (source of truth)
    // and sync to localStorage for instant access on next load
    try {
      const config = await getConfig();
      if (config.permission_mode) {
        const savedMode = config.permission_mode as Mode;
        console.log("[MOUNT] Loaded saved permission mode:", savedMode);
        setCurrentMode(savedMode);
        // Sync to localStorage
        try {
          localStorage.setItem("claudia_permission_mode", savedMode);
        } catch {
          // localStorage may be unavailable
        }
      }
    } catch (e) {
      console.error("[MOUNT] Failed to load config:", e);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleRefocusClick, true);

    // Prevent browser's default drag/drop so Tauri's native handler works
    const preventDefaultDrag = (e: DragEvent) => e.preventDefault();
    document.addEventListener("dragover", preventDefaultDrag);
    document.addEventListener("drop", preventDefaultDrag);

    // Tauri native drag/drop for files from filesystem
    try {
      const webview = getCurrentWebview();
      unlistenDragDrop = await webview.onDragDropEvent((event) => {
        console.log("[TAURI DRAG]", event.payload.type);

        if (event.payload.type === "enter" || event.payload.type === "over") {
          setWindowDragOver(true);
        } else if (event.payload.type === "leave") {
          setWindowDragOver(false);
        } else if (event.payload.type === "drop") {
          setWindowDragOver(false);
          // event.payload.paths contains array of file paths
          const paths = event.payload.paths as string[];
          handleTauriFileDrop(paths);
        }
      });
      console.log("[MOUNT] Tauri drag/drop listener registered");
    } catch (err) {
      console.error("[MOUNT] Failed to register Tauri drag/drop:", err);
    }

    try {
      await session.startSession();

      // Sync session state to store after startup
      // The Tauri startSession doesn't emit events, so we need to sync manually
      store.dispatch(actions.setSessionActive(true));

      permissions.startPolling();
    } catch (e) {
      store.dispatch(actions.setSessionError(`Failed to start session: ${e}`));
    }

    // Check for updates in the background (non-blocking)
    checkForUpdatesQuietly();

    // Set up periodic update check (every 4 hours)
    updateCheckInterval = setInterval(checkForUpdatesQuietly, 4 * 60 * 60 * 1000);
  });

  onCleanup(() => {
    permissions.stopPolling();
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("click", handleRefocusClick, true);
    unlistenDragDrop?.();
    if (updateCheckInterval) {
      clearInterval(updateCheckInterval);
    }
  });

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div class="app" classList={{ "cursor-hidden": keyboardCursor.cursorHidden() }}>
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

        {/* Hide dir-indicator when context warning is shown - they overlap in the title bar.
            Condition is inverse of warning: !(threshold !== "ok" && !dismissed) = (threshold === "ok" || dismissed) */}
        <Show when={session.workingDir() && (contextThreshold() === "ok" || store.warningDismissed())}>
          <div class="dir-indicator" title={session.workingDir()!}>
            <Show when={__CT_WORKTREE__}>
              <span class="worktree-indicator">{__CT_WORKTREE__}</span>
              <span class="worktree-separator">:</span>
            </Show>
            {session.workingDir()!.split("/").pop() || session.workingDir()}
          </div>
        </Show>

        <button
          class="top-bar-btn"
          onClick={handleOpenNewWindow}
          title="New Window (Cmd+N)"
          aria-label="Open new window"
        >
          +
        </button>

        <button
          class="top-bar-btn"
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

        <Show when={store.error()}>
          <div class="error-banner">
            {store.error()}
            <button onClick={() => store.dispatch(actions.setSessionError(null))}>Dismiss</button>
          </div>
        </Show>

        <Show when={store.updateAvailable() && store.updateDismissedVersion() !== store.updateAvailable()?.version}>
          <UpdateBanner
            version={store.updateAvailable()!.version}
            currentVersion={store.updateAvailable()!.currentVersion}
            releaseNotes={store.updateAvailable()!.body}
            downloadProgress={store.updateProgress()}
            status={store.updateStatus()}
            error={store.updateError()}
            onDownload={handleDownloadUpdate}
            onInstall={handleInstallUpdate}
            onDismiss={handleDismissUpdate}
          />
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
            planning={{
              nestedTools: store.planningNestedTools(),
              isReady: store.planReady(),
            }}
          />
        </main>

        <footer class="app-footer">
          <Show when={store.isPlanning() && planWindowOpen()}>
            <PlanApprovalBar
              onApprove={handlePlanApprove}
              onCancel={handlePlanCancel}
            />
          </Show>
          <CommandInput
            ref={(handle) => (commandInputRef = handle)}
            onSubmit={(text, images) => {
              // Route to plan feedback when in planning mode with window open
              if (store.isPlanning() && planWindowOpen() && text.trim()) {
                handlePlanRequestChanges(text);
              } else {
                handleSubmit(text, images);
              }
            }}
            disabled={(store.isLoading() && !store.planReady()) || !store.sessionActive()}
            placeholder={
              store.isPlanning() && planWindowOpen()
                ? "How can I improve the plan?"
                : store.sessionActive()
                  ? "Type a message..."
                  : ""
            }
            mode={currentMode()}
            onModeChange={cycleMode}
            isPlanning={store.isPlanning()}
            onSettingsClick={currentMode() === "bot" ? openBotSettings : undefined}
          />
        </footer>
      </div>

      {/* Floating Todo Panel */}
      <Show when={store.showTodoPanel() && store.currentTodos().length > 0}>
        <TodoPanel
          todos={store.currentTodos()}
          hiding={store.todoPanelHiding()}
          onClose={() => store.dispatch(actions.setTodoPanelVisible(false))}
        />
      </Show>

      {/* Question Panel Overlay */}
      <Show when={store.showQuestionPanel() && store.pendingQuestions().length > 0}>
        <div class="question-overlay">
          <QuestionPanel
            questions={store.pendingQuestions()}
            onAnswer={handleQuestionAnswer}
            onCancel={handleQuestionCancel}
          />
        </div>
      </Show>

      {/* Plan approval is now inline in PlanningTool component */}

      {/* Bot Settings Panel */}
      <BotSettings
        isOpen={botSettingsOpen()}
        onClose={closeBotSettings}
        error={botSettingsError()}
        highlightApiKey={!!botSettingsError()}
      />

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
          currentVersion={appVersion()}
          updateAvailable={store.updateAvailable()}
          updateStatus={store.updateStatus()}
          downloadProgress={store.updateProgress()}
          onCheckForUpdates={checkForUpdatesInteractive}
          onDownload={handleDownloadUpdate}
          onInstall={handleInstallUpdate}
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
            isReviewing={store.permissionIsReviewing()}
            reviewResult={store.permissionReviewResult()}
          />
        </div>
      </Show>

      {/* Drop Zone Overlay */}
      <Show when={windowDragOver()}>
        <div class="drop-zone-overlay">
          <div class="drop-zone-content">
            <div class="drop-zone-icon">📷</div>
            <div class="drop-zone-text">Drop image here</div>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default App;
