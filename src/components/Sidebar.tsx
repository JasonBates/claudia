import { Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import type { SessionEntry } from "../lib/types";
import SessionItem from "./SessionItem";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  sessions: SessionEntry[];
  sessionNames: Record<string, string>;
  currentSessionId: string | null;
  launchSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onResume: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onNewSession: () => void;
  onReturnToOriginal: () => void;
}

const SIDEBAR_WIDTH_KEY = "claudia-sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

const Sidebar: Component<SidebarProps> = (props) => {
  // Resizable width state
  const [width, setWidth] = createSignal(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = createSignal(false);
  // Edit mode state
  const [editMode, setEditMode] = createSignal(false);

  // Load saved width on mount
  onMount(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (saved) {
        const w = parseInt(saved, 10);
        if (w >= MIN_WIDTH && w <= MAX_WIDTH) {
          setWidth(w);
        }
      }
    } catch {
      // localStorage might be unavailable
    }
  });

  // Handle resize drag
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing()) return;
    // Sidebar is on the left, so width = mouse X position
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    setWidth(newWidth);
  };

  const handleMouseUp = () => {
    if (isResizing()) {
      setIsResizing(false);
      // Save width to localStorage
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width()));
      } catch {
        // localStorage might be unavailable
      }
    }
  };

  // Global mouse listeners for resize
  onMount(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  });

  onCleanup(() => {
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  });

  // Sort sessions by modified date (newest first)
  // Current session stays in its natural position based on last meaningful content
  const sortedSessions = () => {
    let sessions = [...props.sessions];

    // Ensure current session is in the list (might be filtered if only warmup messages)
    const currentId = props.currentSessionId;
    if (currentId && !sessions.some((s) => s.sessionId === currentId)) {
      // Add a placeholder for the current session at the top
      sessions.unshift({
        sessionId: currentId,
        fullPath: "",
        fileMtime: Date.now(),
        firstPrompt: "Current session",
        messageCount: 0,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        gitBranch: "",
        projectPath: "",
        isSidechain: false,
      });
    }

    return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  };

  // Show "Original Session" button when:
  // 1. We have a launch session ID
  // 2. Current session is different from launch session
  // 3. Launch session exists in the session list (or hasn't been saved yet)
  const showOriginalSession = () => {
    const launch = props.launchSessionId;
    const current = props.currentSessionId;
    if (!launch || !current) return false;
    if (launch === current) return false;
    return true;
  };

  // Toggle edit mode
  const toggleEditMode = () => {
    setEditMode(!editMode());
  };

  return (
    <>
      {/* Sidebar panel - toggled via Cmd+Shift+[ or /resume command */}
      <div
        class="sidebar"
        classList={{ collapsed: props.collapsed, resizing: isResizing() }}
        style={{ width: props.collapsed ? undefined : `${width()}px` }}
      >
        <div class="sidebar-header">
          <span class="sidebar-title">Sessions</span>
          <div class="sidebar-header-actions">
            <button
              type="button"
              class="sidebar-edit-button"
              classList={{ active: editMode() }}
              onClick={toggleEditMode}
            >
              {editMode() ? "Done" : "Edit"}
            </button>
            <span class="sidebar-count">{props.sessions.length}</span>
          </div>
        </div>

        <div class="sidebar-content">
          {/* Loading state */}
          <Show when={props.isLoading}>
            <div class="sidebar-loading">
              <span class="sidebar-spinner">◌</span>
              <span>Loading sessions...</span>
            </div>
          </Show>

          {/* Error state */}
          <Show when={props.error && !props.isLoading}>
            <div class="sidebar-error">
              <span>Failed to load sessions</span>
              <span class="sidebar-error-detail">{props.error}</span>
            </div>
          </Show>

          {/* Empty state */}
          <Show when={!props.isLoading && !props.error && props.sessions.length === 0}>
            <div class="sidebar-empty">
              <span class="sidebar-empty-icon">📭</span>
              <span>No previous sessions</span>
              <span class="sidebar-empty-hint">
                Your conversations will appear here
              </span>
            </div>
          </Show>

          {/* New Session button - always visible at top */}
          <button
            type="button"
            class="new-session-button"
            onClick={() => props.onNewSession()}
          >
            <span class="new-session-icon">+</span>
            <span class="new-session-label">New Session</span>
          </button>

          {/* Original Session button - shows when viewing a different session */}
          <Show when={showOriginalSession()}>
            <button
              type="button"
              class="original-session-button"
              onClick={() => props.onReturnToOriginal()}
            >
              <span class="original-session-icon">⌂</span>
              <span class="original-session-label">Original Session</span>
            </button>
          </Show>

          {/* Session list - current session at top */}
          <Show when={!props.isLoading && !props.error && props.sessions.length > 0}>
            <div class="session-list">
              <For each={sortedSessions()}>
                {(session) => (
                  <SessionItem
                    session={session}
                    customName={props.sessionNames[session.sessionId]}
                    isActive={session.sessionId === props.currentSessionId}
                    editMode={editMode()}
                    onClick={() => props.onResume(session.sessionId)}
                    onDelete={() => props.onDelete(session.sessionId)}
                    onRename={(name) => props.onRename(session.sessionId, name)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Resize handle */}
        <div
          class="sidebar-resize-handle"
          onMouseDown={handleMouseDown}
        />
      </div>
    </>
  );
};

export default Sidebar;
