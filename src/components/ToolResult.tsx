import { Component, createSignal, createMemo, Show, For } from "solid-js";
import MessageContent from "./MessageContent";

interface ToolResultProps {
  name: string;
  input?: unknown;
  result?: string;
  isLoading?: boolean;
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
  const [expanded, setExpanded] = createSignal(false);

  const toggleExpanded = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(!expanded());
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

  // Get result lines for preview
  const resultLines = createMemo(() => {
    if (!props.result) return [];
    return props.result.split('\n');
  });

  // Preview shows first 2 lines
  const previewContent = createMemo(() => {
    const lines = resultLines();
    if (lines.length <= 2) return props.result || "";
    return lines.slice(0, 2).join('\n');
  });

  const hasMoreLines = () => resultLines().length > 2;
  const extraLineCount = () => resultLines().length - 2;

  return (
    <div class="tool-result" classList={{ expanded: expanded(), loading: props.isLoading }}>
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
            title={expanded() ? "Collapse" : "Expand"}
          >
            {expanded() ? "−" : "+"}
          </button>
        </Show>
      </div>

      {/* Special rendering for TodoWrite - always show todo list */}
      <Show when={isTodoWrite()}>
        <TodoList todos={getTodos()} />
      </Show>

      {/* Result content - only visible when expanded */}
      <Show when={props.result && !isTodoWrite() && expanded()}>
        <div class="tool-result-preview">
          <div class="tool-result-content">
            <MessageContent content={props.result!} />
          </div>
        </div>
      </Show>

      {/* Expanded input details */}
      <Show when={expanded() && hasInput() && !isTodoWrite()}>
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
