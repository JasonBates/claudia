import { Component, For, Show } from "solid-js";
import type { SessionEntry } from "../lib/types";
import SessionItem from "./SessionItem";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  sessions: SessionEntry[];
  currentSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  onResume: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

const Sidebar: Component<SidebarProps> = (props) => {
  return (
    <>
      {/* Toggle button - always visible */}
      <button
        class="sidebar-toggle"
        classList={{ "sidebar-expanded": !props.collapsed }}
        onClick={props.onToggle}
        title={props.collapsed ? "Show sessions (⌘⇧[)" : "Hide sessions (⌘⇧[)"}
      >
        {props.collapsed ? "›" : "‹"}
      </button>

      {/* Sidebar panel */}
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

          {/* Session list */}
          <Show when={!props.isLoading && !props.error && props.sessions.length > 0}>
            <div class="session-list">
              <For each={props.sessions}>
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
