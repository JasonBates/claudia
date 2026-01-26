import { Component, createSignal, Show, For } from "solid-js";
import MessageContent from "./MessageContent";

interface ToolResultProps {
  name: string;
  input?: unknown;
  result?: string;
  isLoading?: boolean;
  autoExpanded?: boolean;  // Forces expanded state (survives component recreation)
}

interface Todo {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
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
    const str = JSON.stringify(props.input);
    // Don't show empty objects or raw empty strings
    if (str === "{}" || str === '{"raw":""}') return "";
    return str.length > 60 ? str.slice(0, 60) + "..." : str;
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

  return (
    <div class="tool-result" classList={{ expanded: isExpanded(), loading: props.isLoading }}>
      <div class="tool-header">
        <span class="tool-icon">{props.isLoading ? "◐" : "⚡"}</span>
        <span class="tool-name">{props.name}</span>
        <Show when={hasInput()}>
          <span class="tool-input-preview">{inputPreview()}</span>
        </Show>
        <Show when={!props.isLoading && (hasInput() || props.result)}>
          <button
            class="tool-toggle-btn"
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

      {/* Result content - visible when: loading or expanded (via autoExpanded or user toggle) */}
      <Show when={!isTodoWrite() && (props.isLoading || isExpanded())}>
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
