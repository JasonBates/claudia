import { Component, For, Show } from "solid-js";
import type { Todo } from "../lib/types";

interface TodoPanelProps {
  todos: Todo[];
  hiding?: boolean;
}

const TodoPanel: Component<TodoPanelProps> = (props) => {
  const completedCount = () => props.todos.filter(t => t.status === "completed").length;
  const totalCount = () => props.todos.length;
  const currentTask = () => props.todos.find(t => t.status === "in_progress");

  return (
    <div class="todo-panel" classList={{ hiding: props.hiding }}>
      <div class="todo-panel-header">
        <span class="todo-panel-title">Tasks</span>
        <span class="todo-panel-count">{completedCount()}/{totalCount()}</span>
      </div>

      <div class="todo-panel-list">
        <For each={props.todos}>
          {(todo) => (
            <div class={`todo-panel-item todo-${todo.status}`}>
              <span class="todo-panel-icon">
                {todo.status === "completed" && "✓"}
                {todo.status === "in_progress" && "◐"}
                {todo.status === "pending" && "○"}
              </span>
              <span class="todo-panel-text">
                {todo.status === "in_progress" ? (todo.activeForm || todo.content) : todo.content}
              </span>
            </div>
          )}
        </For>
      </div>

      <Show when={currentTask()}>
        <div class="todo-panel-current">
          {currentTask()?.activeForm || currentTask()?.content}
        </div>
      </Show>
    </div>
  );
};

export default TodoPanel;
