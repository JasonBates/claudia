import { Component, Show, createSignal } from "solid-js";
import type { SessionEntry } from "../lib/types";

interface SessionItemProps {
  session: SessionEntry;
  customName?: string;
  isActive: boolean;
  editMode: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

/**
 * Format a relative time string (e.g., "2h ago", "Yesterday", "Jan 15")
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  // Format as date for older items
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

/**
 * Parse injected timestamp from the start of a message.
 * Returns { timestamp, content } where timestamp may be null.
 *
 * Common formats:
 * - "[Fri, 30 Jan 2026, 08:25] actual message" (Conductor format)
 * - "2026-01-30 08:24:03 - actual message"
 * - "2026-01-30T08:24:03.000Z actual message"
 * - "Jan 30, 2026 8:24 AM - actual message"
 */
function parseTimestampPrefix(text: string): { timestamp: string | null; content: string } {
  if (!text) return { timestamp: null, content: text };

  // Pattern 1: "[Day, DD Mon YYYY, HH:MM] content" (Conductor injected format)
  const bracketPattern = /^\[([A-Z][a-z]{2},\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4},\s+\d{2}:\d{2})\]\s*/;
  const bracketMatch = text.match(bracketPattern);
  if (bracketMatch) {
    return {
      timestamp: bracketMatch[1],
      content: text.slice(bracketMatch[0].length).trim(),
    };
  }

  // Pattern 2: "YYYY-MM-DD HH:MM:SS - content" or "YYYY-MM-DD HH:MM:SS content"
  const isoDateTimePattern = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*[-–]?\s*/;
  const isoMatch = text.match(isoDateTimePattern);
  if (isoMatch) {
    return {
      timestamp: isoMatch[1],
      content: text.slice(isoMatch[0].length).trim(),
    };
  }

  // Pattern 3: "YYYY-MM-DDTHH:MM:SS" (ISO with T separator)
  const isoTPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s*[-–]?\s*/;
  const isoTMatch = text.match(isoTPattern);
  if (isoTMatch) {
    return {
      timestamp: isoTMatch[1],
      content: text.slice(isoTMatch[0].length).trim(),
    };
  }

  // Pattern 4: "Mon DD, YYYY H:MM AM/PM - content"
  const verboseDatePattern = /^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]?\s*/i;
  const verboseMatch = text.match(verboseDatePattern);
  if (verboseMatch) {
    return {
      timestamp: verboseMatch[1],
      content: text.slice(verboseMatch[0].length).trim(),
    };
  }

  return { timestamp: null, content: text };
}

const SessionItem: Component<SessionItemProps> = (props) => {
  // Editing state for inline rename
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  const handleClick = (e: MouseEvent) => {
    // Don't navigate if in edit mode or editing
    if (props.editMode || isEditing()) {
      e.stopPropagation();
      return;
    }
    console.log("[SESSION_ITEM] Click detected!", props.session.sessionId);
    e.stopPropagation();
    props.onClick();
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // Context menu delete still works when not in edit mode
    if (!props.editMode && confirm("Delete this session?")) {
      props.onDelete();
    }
  };

  const handleDelete = (e: MouseEvent) => {
    e.stopPropagation();
    props.onDelete();
  };

  const startEditing = (e: MouseEvent) => {
    e.stopPropagation();
    // Initialize with current custom name or the display content
    setEditValue(props.customName || displayContent());
    setIsEditing(true);
    // Focus input on next tick
    setTimeout(() => {
      inputRef?.focus();
      inputRef?.select();
    }, 0);
  };

  const saveEdit = () => {
    const newName = editValue().trim();
    // Only save if name changed
    const currentName = props.customName || "";
    if (newName !== currentName) {
      props.onRename(newName);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleBlur = () => {
    saveEdit();
  };

  // Parse out any injected timestamp from the first prompt
  const parsed = () => parseTimestampPrefix(props.session.firstPrompt || "");
  const displayContent = () => parsed().content || "Empty session";
  const injectedTimestamp = () => parsed().timestamp;

  // Use custom name if available, otherwise fall back to first prompt
  const displayName = () => props.customName || displayContent();

  return (
    <div
      class="session-item"
      classList={{
        active: props.isActive,
        "edit-mode": props.editMode,
        editing: isEditing()
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={props.customName || props.session.firstPrompt}
    >
      {/* Delete button - shown in edit mode */}
      <Show when={props.editMode && !isEditing()}>
        <button
          type="button"
          class="session-delete-btn"
          onClick={handleDelete}
          title="Delete session"
        >
          ×
        </button>
      </Show>

      {/* Main content area */}
      <div class="session-content">
        <Show
          when={!isEditing()}
          fallback={
            <input
              ref={inputRef}
              type="text"
              class="session-name-input"
              value={editValue()}
              onInput={(e) => setEditValue(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
            />
          }
        >
          <div class="session-preview">
            {truncate(displayName(), 60)}
            {/* Rename button - inline with session name */}
            <Show when={props.editMode}>
              <button
                type="button"
                class="session-rename-btn"
                onClick={startEditing}
                title="Rename session"
              >
                ✎
              </button>
            </Show>
          </div>
          <div class="session-meta">
            {injectedTimestamp() && !props.customName ? (
              <>
                <span class="session-injected-time">{injectedTimestamp()}</span>
                <span class="session-count">{props.session.messageCount}</span>
              </>
            ) : (
              <>
                <span class="session-count">
                  {props.session.messageCount} msgs
                </span>
                <span class="session-time">
                  {formatRelativeTime(props.session.modified)}
                </span>
              </>
            )}
          </div>
        </Show>
      </div>
    </div>
  );
};

export default SessionItem;
