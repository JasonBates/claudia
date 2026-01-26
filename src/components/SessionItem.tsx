import { Component } from "solid-js";
import type { SessionEntry } from "../lib/types";

interface SessionItemProps {
  session: SessionEntry;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
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

const SessionItem: Component<SessionItemProps> = (props) => {
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // Simple confirmation for delete
    if (confirm("Delete this session?")) {
      props.onDelete();
    }
  };

  return (
    <div
      class="session-item"
      classList={{ active: props.isActive }}
      onClick={props.onClick}
      onContextMenu={handleContextMenu}
      title={props.session.first_prompt}
    >
      <div class="session-preview">
        {truncate(props.session.first_prompt || "Empty session", 60)}
      </div>
      <div class="session-meta">
        <span class="session-count">
          <span class="session-count-icon">💬</span>
          {props.session.message_count}
        </span>
        <span class="session-time">
          {formatRelativeTime(props.session.modified)}
        </span>
      </div>
    </div>
  );
};

export default SessionItem;
