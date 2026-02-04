import { createSignal, onMount, onCleanup, Accessor } from "solid-js";

export interface UseKeyboardCursorReturn {
  cursorHidden: Accessor<boolean>;
}

/**
 * Hook that hides the mouse cursor while typing and shows it when the mouse moves.
 * This is a common UX pattern in text editors to reduce visual distraction.
 */
export function useKeyboardCursor(): UseKeyboardCursorReturn {
  const [cursorHidden, setCursorHidden] = createSignal(false);

  const handleKeyDown = () => {
    if (!cursorHidden()) {
      setCursorHidden(true);
    }
  };

  const handleMouseMove = () => {
    if (cursorHidden()) {
      setCursorHidden(false);
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("mousemove", handleMouseMove, true);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("mousemove", handleMouseMove, true);
  });

  return { cursorHidden };
}
