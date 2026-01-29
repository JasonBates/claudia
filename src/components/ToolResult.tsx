import { Component, createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import MessageContent from "./MessageContent";
import type { Todo, SubagentInfo } from "../lib/types";

interface ToolResultProps {
  name: string;
  input?: unknown;
  result?: string;
  isLoading?: boolean;
  autoExpanded?: boolean;  // Forces expanded state (survives component recreation)
  subagent?: SubagentInfo; // Subagent state (only for Task tools)
  grouped?: boolean;       // When true, renders without header (for grouped Task tools)
}

// Special renderer for TodoWrite
const TodoList: Component<{ todos: Todo[] }> = (props) => {
  return (
    <div class="todo-list">
      <For each={props.todos}>
        {(todo) => (
          <div class={`todo-item todo-${todo.status}`}>
            <span class="todo-icon">
              {todo.status === "completed" && "✓"}
              {todo.status === "in_progress" && "◐"}
              {todo.status === "pending" && "○"}
            </span>
            <span class="todo-text">
              {todo.status === "in_progress" ? todo.activeForm : todo.content}
            </span>
          </div>
        )}
      </For>
    </div>
  );
};

// Format duration as human-readable
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
};

// Format MCP tool names: mcp__server__tool_name → "Server: tool name"
const formatToolName = (name: string): string => {
  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__");
    if (parts.length >= 2) {
      const server = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      const tool = parts.slice(1).join(" ").replace(/_/g, " ");
      return `${server}: ${tool}`;
    }
    return name.slice(5).replace(/_/g, " ");
  }
  return name;
};

// Special renderer for Task (subagent) tools
const SubagentTree: Component<{ subagent: SubagentInfo }> = (props) => {
  const isRunning = () => props.subagent.status !== "complete";

  // Elapsed time counter for running subagents
  const [elapsed, setElapsed] = createSignal(0);

  createEffect(() => {
    if (isRunning() && props.subagent.startTime) {
      // Update elapsed time every second
      const updateElapsed = () => {
        setElapsed(Date.now() - props.subagent.startTime);
      };
      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);
      onCleanup(() => clearInterval(interval));
    }
  });

  // Nested tools streamed in real-time (may be empty if subagent tools aren't streamed)
  const streamedTools = () => props.subagent.nestedTools || [];
  // Show only the last 4 tools for a scrolling effect
  const recentTools = () => streamedTools().slice(-4);

  // Use toolCount from result if we have it, otherwise count streamed tools
  // Note: Subagent nested tools often aren't streamed back - we just get the count at the end
  const displayCount = () => {
    const streamed = streamedTools().length;
    const reported = props.subagent.toolCount || 0;
    return Math.max(streamed, reported);
  };

  const statusText = () => {
    const count = displayCount();
    if (props.subagent.status === "complete") {
      const duration = props.subagent.duration || 0;
      const durationStr = duration > 0 ? formatDuration(duration) : "Done";
      return count > 0 ? `${durationStr} · ${count} tools` : durationStr;
    }
    // Show elapsed time while running
    const elapsedStr = elapsed() > 1000 ? formatDuration(elapsed()) : "";
    if (count > 0) {
      return elapsedStr ? `${elapsedStr} · ${count} tools` : `${count} tools`;
    }
    return elapsedStr || "Starting";
  };

  return (
    <div class="subagent-tree" classList={{ complete: props.subagent.status === "complete" }}>
      <div class="subagent-header">
        <Show when={isRunning()} fallback={
          <span class="subagent-check">✓</span>
        }>
          <span class="subagent-spinner">◐</span>
        </Show>
        <span class="subagent-status">{statusText()}</span>
        <span class="subagent-type">{props.subagent.agentType}</span>
      </div>
      <div class="subagent-branch">
        <span class="tree-char">└─</span>
        <span class="subagent-desc">{props.subagent.description}</span>
      </div>
      <Show when={recentTools().length > 0}>
        <div class="subagent-activity-box">
          <For each={recentTools()}>
            {(tool) => (
              <div class="subagent-activity-line">
                <span class="activity-tool-name">{formatToolName(tool.name)}</span>
                <Show when={tool.input}>
                  <span class="activity-tool-detail">{tool.input}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const ToolResult: Component<ToolResultProps> = (props) => {
  // Track user's explicit override (null = no override, use autoExpanded)
  const [userOverride, setUserOverride] = createSignal<boolean | null>(null);

  // Effective expanded state: user override takes priority, then autoExpanded, then default false
  const isExpanded = () => {
    const override = userOverride();
    if (override !== null) return override;
    return props.autoExpanded || false;
  };

  const toggleExpanded = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // User explicitly toggles - set override to opposite of current state
    setUserOverride(!isExpanded());
  };

  const inputPreview = () => {
    if (!props.input) return "";
    const input = props.input as Record<string, unknown>;

    // MCP tools - extract meaningful info based on common patterns
    if (props.name.startsWith("mcp__")) {
      // Perplexity tools - show query or first message content
      if (props.name.includes("perplexity")) {
        if (input.query) return `"${String(input.query).slice(0, 50)}"`;
        if (input.messages && Array.isArray(input.messages)) {
          const lastMsg = input.messages[input.messages.length - 1] as Record<string, unknown>;
          if (lastMsg?.content) return `"${String(lastMsg.content).slice(0, 50)}"`;
        }
      }
      // Obsidian tools - show filename or query
      if (props.name.includes("obsidian")) {
        if (input.filename) return String(input.filename);
        if (input.query) return `"${String(input.query).slice(0, 40)}"`;
        if (input.filenames && Array.isArray(input.filenames)) {
          return `${input.filenames.length} files`;
        }
      }
      // Context7 tools - show query or library
      if (props.name.includes("context7")) {
        if (input.query) return `"${String(input.query).slice(0, 40)}"`;
        if (input.libraryName) return String(input.libraryName);
        if (input.libraryId) return String(input.libraryId);
      }
      // Generic MCP - try common field names
      if (input.query) return `"${String(input.query).slice(0, 50)}"`;
      if (input.url) return String(input.url).slice(0, 50);
      if (input.filename) return String(input.filename);
      if (input.path) return String(input.path);
    }

    // Tool-specific human-readable previews
    switch (props.name) {
      case "Bash": {
        // Prefer description, fall back to truncated command
        if (input.description) return String(input.description);
        if (input.command) {
          const cmd = String(input.command);
          return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
        }
        break;
      }
      case "Read":
      case "Write":
      case "Edit": {
        if (input.file_path) {
          const path = String(input.file_path);
          // Show just filename for short display
          const filename = path.split("/").pop() || path;
          return filename;
        }
        break;
      }
      case "Glob": {
        if (input.pattern) return String(input.pattern);
        break;
      }
      case "Grep": {
        if (input.pattern) return `"${String(input.pattern)}"`;
        break;
      }
      case "WebFetch": {
        if (input.url) {
          try {
            return new URL(String(input.url)).hostname;
          } catch {
            return String(input.url).slice(0, 40);
          }
        }
        break;
      }
      case "WebSearch": {
        if (input.query) return `"${String(input.query).slice(0, 40)}"`;
        break;
      }
    }

    // Fallback: show truncated JSON
    const str = JSON.stringify(props.input);
    if (str === "{}" || str === '{"raw":""}') return "";
    return str.length > 60 ? str.slice(0, 60) + "..." : str;
  };

  // Format tool name for display - especially MCP tools
  const displayName = () => {
    const name = props.name;

    // MCP tools: mcp__server__tool_name → "server: tool_name" or just cleaner format
    if (name.startsWith("mcp__")) {
      const parts = name.slice(5).split("__"); // Remove "mcp__" prefix
      if (parts.length >= 2) {
        const server = parts[0];
        const tool = parts.slice(1).join("_").replace(/_/g, " ");
        // Capitalize first letter of each word
        const formatWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        return `${formatWord(server)}: ${tool}`;
      }
      return name.slice(5).replace(/_/g, " ");
    }

    return name;
  };

  const hasInput = () => {
    if (!props.input) return false;
    const str = JSON.stringify(props.input);
    return str !== "{}" && str !== '{"raw":""}';
  };

  // Check if this is TodoWrite with todos
  const isTodoWrite = () => {
    if (props.name !== "TodoWrite") return false;
    const input = props.input as { todos?: Todo[] } | undefined;
    return input?.todos && Array.isArray(input.todos);
  };

  const getTodos = (): Todo[] => {
    const input = props.input as { todos?: Todo[] } | undefined;
    return input?.todos || [];
  };

  // Check if this is a Task (by name, subagent data may arrive later)
  const isTaskByName = () => props.name === "Task";
  const isTask = () => props.name === "Task" && props.subagent;

  // When grouped, Task tools render just the SubagentTree without wrapper/header
  if (props.grouped && isTaskByName()) {
    // Has subagent data → show SubagentTree
    if (props.subagent) {
      return <SubagentTree subagent={props.subagent} />;
    }
    // No subagent but has result → Task errored or completed without spawning subagent
    // Fall through to normal ToolResult rendering (don't return early)
    if (props.result && !props.isLoading) {
      // Let it render as normal tool result below
    } else {
      // Still loading, no subagent yet - show minimal loading state
      return (
        <div class="subagent-tree">
          <div class="subagent-header">
            <span class="subagent-spinner">◐</span>
            <span class="subagent-status">Starting</span>
          </div>
        </div>
      );
    }
  }

  return (
    <div class="tool-result" classList={{ expanded: isExpanded(), loading: props.isLoading }}>
      <div class="tool-header">
        <span class="tool-icon" classList={{ complete: !props.isLoading }}>{props.isLoading ? "◐" : "✓"}</span>
        <span class="tool-name">{displayName()}</span>
        <Show when={hasInput()}>
          <span class="tool-input-preview">{inputPreview()}</span>
        </Show>
        <Show when={!props.isLoading && (hasInput() || props.result)}>
          <button
            class="tool-toggle-btn refocus-after"
            onClick={toggleExpanded}
            title={isExpanded() ? "Collapse" : "Expand"}
          >
            {isExpanded() ? "−" : "+"}
          </button>
        </Show>
      </div>

      {/* Special rendering for TodoWrite - always show todo list */}
      <Show when={isTodoWrite()}>
        <TodoList todos={getTodos()} />
      </Show>

      {/* Special rendering for Task (subagent) - show tree view */}
      <Show when={isTask()}>
        <SubagentTree subagent={props.subagent!} />
      </Show>

      {/* Result content - visible when: loading or expanded (via autoExpanded or user toggle) */}
      <Show when={!isTodoWrite() && !isTask() && (props.isLoading || isExpanded())}>
        <div class="tool-result-preview">
          <div class="tool-result-content">
            <Show when={props.result} fallback={<span class="loading-text">Running...</span>}>
              <MessageContent content={props.result!} />
            </Show>
          </div>
        </div>
      </Show>

      {/* Expanded input details */}
      <Show when={isExpanded() && hasInput() && !isTodoWrite()}>
        <div class="tool-input-details">
          <div class="tool-section-label">Input:</div>
          <pre class="tool-json">
            {JSON.stringify(props.input, null, 2)}
          </pre>
        </div>
      </Show>
    </div>
  );
};

export default ToolResult;
