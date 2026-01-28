import { Component, createSignal, onMount, onCleanup } from "solid-js";

type Mode = "auto" | "request" | "plan";

export interface CommandInputHandle {
  focus: () => void;
}

interface CommandInputProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  mode?: Mode;
  onModeChange?: () => void;
  ref?: (handle: CommandInputHandle) => void;
}

const CommandInput: Component<CommandInputProps> = (props) => {
  const [value, setValue] = createSignal("");
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  let textareaRef: HTMLTextAreaElement | undefined;

  const focusInput = () => {
    // Always allow focus - disabled only prevents submission, not typing
    textareaRef?.focus();
  };

  onMount(() => {
    focusInput();
    window.addEventListener("focus", focusInput);
    // Expose focus method to parent via ref callback
    props.ref?.({ focus: focusInput });
  });

  onCleanup(() => {
    window.removeEventListener("focus", focusInput);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // Cycle mode on Shift+Tab
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      props.onModeChange?.();
      return;
    }

    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }

    // Navigate history with Arrow keys (only when on first/last line)
    if (e.key === "ArrowUp" && isAtFirstLine()) {
      e.preventDefault();
      navigateHistory(-1);
      return;
    }

    if (e.key === "ArrowDown" && isAtLastLine()) {
      e.preventDefault();
      navigateHistory(1);
      return;
    }
  };

  const getModeInfo = () => {
    switch (props.mode) {
      case "request":
        return { label: "Request", icon: "?", class: "mode-request" };
      case "plan":
        return { label: "Plan", icon: "◇", class: "mode-plan" };
      case "auto":
      default:
        return { label: "Auto", icon: "»", class: "mode-auto" };
    }
  };

  const isAtFirstLine = () => {
    if (!textareaRef) return true;
    const cursorPos = textareaRef.selectionStart;
    return !value().slice(0, cursorPos).includes("\n");
  };

  const isAtLastLine = () => {
    if (!textareaRef) return true;
    const cursorPos = textareaRef.selectionStart;
    return !value().slice(cursorPos).includes("\n");
  };

  const navigateHistory = (direction: number) => {
    const hist = history();
    if (hist.length === 0) return;

    const newIndex = Math.max(-1, Math.min(hist.length - 1, historyIndex() + direction));
    setHistoryIndex(newIndex);

    if (newIndex === -1) {
      setValue("");
    } else {
      setValue(hist[hist.length - 1 - newIndex]);
    }
  };

  const submit = () => {
    const text = value().trim();
    if (!text || props.disabled) return;

    // Add to history
    setHistory((prev) => [...prev.filter((h) => h !== text), text]);
    setHistoryIndex(-1);

    // Clear and submit
    setValue("");
    props.onSubmit(text);

    // Reset textarea height
    if (textareaRef) {
      textareaRef.style.height = "auto";
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setValue(target.value);

    // Auto-resize textarea
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 200) + "px";
  };

  const modeInfo = () => getModeInfo();

  return (
    <div class="command-input-container">
      <button
        class={`mode-indicator ${modeInfo().class}`}
        onClick={props.onModeChange}
        title="Shift+Tab to change mode"
      >
        <span class="mode-icon">{modeInfo().icon}</span>
        <span class="mode-label">{modeInfo().label}</span>
      </button>
      <textarea
        ref={textareaRef}
        class="command-input"
        value={value()}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder || "Type a message..."}
        rows={1}
      />
    </div>
  );
};

export default CommandInput;
