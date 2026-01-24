import { Component, createSignal, Show, For } from "solid-js";
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

  const toggleExpanded = () => setExpanded(!expanded());

  const inputPreview = () => {
    if (!props.input) return "";
    const str = JSON.stringify(props.input);
    // Don't show empty objects or raw empty strings
    if (str === "{}" || str === '{"raw":""}') return "";
    return str.length > 50 ? str.slice(0, 50) + "..." : str;
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
    <div class="tool-result">
      <div class="tool-header" onClick={toggleExpanded}>
        <span class="tool-icon">{props.isLoading ? "◐" : "›"}</span>
        <span class="tool-name">{props.name}</span>
        <Show when={hasInput() && !expanded() && !isTodoWrite()}>
          <span class="tool-input-preview">{inputPreview()}</span>
        </Show>
        <span class="tool-expand">{expanded() ? "−" : "+"}</span>
      </div>

      {/* Special rendering for TodoWrite - always show todo list */}
      <Show when={isTodoWrite()}>
        <TodoList todos={getTodos()} />
      </Show>

      <Show when={expanded() && !isTodoWrite()}>
        <div class="tool-details">
          <Show when={hasInput()}>
            <div class="tool-section">
              <div class="tool-section-label">Input:</div>
              <pre class="tool-json">
                {JSON.stringify(props.input, null, 2)}
              </pre>
            </div>
          </Show>

          <Show when={props.result}>
            <div class="tool-section">
              <div class="tool-section-label">Result:</div>
              <div class="tool-result-content">
                <MessageContent content={props.result!} />
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ToolResult;
