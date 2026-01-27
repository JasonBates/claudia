import { Component, For, Show } from "solid-js";
import type { SessionEntry } from "../lib/types";
import SessionItem from "./SessionItem";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  sessions: SessionEntry[];
  currentSessionId: string | null;
  launchSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onResume: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onNewSession: () => void;
  onReturnToOriginal: () => void;
}

const Sidebar: Component<SidebarProps> = (props) => {
  // Sort sessions with current session at top, then by modified date
  const sortedSessions = () => {
    const sessions = [...props.sessions];
    return sessions.sort((a, b) => {
      // Current session always first
      if (a.sessionId === props.currentSessionId) return -1;
      if (b.sessionId === props.currentSessionId) return 1;
      // Then by modified date (newest first)
      return b.modified.localeCompare(a.modified);
    });
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

  return (
    <>
      {/* Sidebar panel - toggled via Cmd+Shift+[ or /resume command */}
      <div class="sidebar" classList={{ collapsed: props.collapsed }}>
        <div class="sidebar-header">
          <span class="sidebar-title">Sessions</span>
          <span class="sidebar-count">{props.sessions.length}</span>
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
                    isActive={session.sessionId === props.currentSessionId}
                    onClick={() => props.onResume(session.sessionId)}
                    onDelete={() => props.onDelete(session.sessionId)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
