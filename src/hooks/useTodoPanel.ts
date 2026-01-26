import { createSignal, Accessor, Setter, runWithOwner, batch, Owner } from "solid-js";
import type { Todo } from "../lib/types";

export interface UseTodoPanelReturn {
  // Signals
  currentTodos: Accessor<Todo[]>;
  setCurrentTodos: Setter<Todo[]>;
  showTodoPanel: Accessor<boolean>;
  setShowTodoPanel: Setter<boolean>;
  todoPanelHiding: Accessor<boolean>;
  setTodoPanelHiding: Setter<boolean>;

  // Actions
  startHideTimer: () => void;
}

export interface UseTodoPanelOptions {
  /**
   * SolidJS owner for restoring reactive context in setTimeout callbacks.
   */
  owner: Owner | null;

  /**
   * Delay in ms before hiding the panel (default: 2000)
   */
  hideDelay?: number;
}

/**
 * Custom hook for managing the floating todo panel.
 *
 * Handles:
 * - Todo list state from TodoWrite tool
 * - Panel visibility with slide-out animation
 * - Auto-hide timer after streaming completes
 *
 * The actual todo data comes from event handlers calling setCurrentTodos.
 */
export function useTodoPanel(options: UseTodoPanelOptions): UseTodoPanelReturn {
  const [currentTodos, setCurrentTodos] = createSignal<Todo[]>([]);
  const [showTodoPanel, setShowTodoPanel] = createSignal(false);
  const [todoPanelHiding, setTodoPanelHiding] = createSignal(false);

  const hideDelay = options.hideDelay ?? 2000;

  /**
   * Start the auto-hide timer for the todo panel.
   * Called after streaming completes (from finishStreaming callback).
   *
   * Sets todoPanelHiding to true (triggers slide-out animation),
   * then after hideDelay, hides the panel completely.
   */
  const startHideTimer = (): void => {
    if (!showTodoPanel()) return;

    setTodoPanelHiding(true);

    setTimeout(() => {
      // Restore SolidJS context for setTimeout callback
      runWithOwner(options.owner, () => {
        batch(() => {
          setShowTodoPanel(false);
          setTodoPanelHiding(false);
        });
      });
    }, hideDelay);
  };

  return {
    // Signals
    currentTodos,
    setCurrentTodos,
    showTodoPanel,
    setShowTodoPanel,
    todoPanelHiding,
    setTodoPanelHiding,

    // Actions
    startHideTimer,
  };
}
