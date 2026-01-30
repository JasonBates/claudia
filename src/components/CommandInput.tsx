import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ImageAttachment } from "../lib/types";
import { SUPPORTED_IMAGE_TYPES, MAX_IMAGE_SIZE_BYTES } from "../lib/types";

type Mode = "auto" | "request" | "plan";

export interface CommandInputHandle {
  focus: () => void;
  addImageFile: (file: File) => Promise<void>;
}

interface CommandInputProps {
  onSubmit: (message: string, images?: ImageAttachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  mode?: Mode;
  onModeChange?: () => void;
  ref?: (handle: CommandInputHandle) => void;
  isPlanning?: boolean;
}

const CommandInput: Component<CommandInputProps> = (props) => {
  const [value, setValue] = createSignal("");
  const [history, setHistory] = createSignal<string[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  const [images, setImages] = createSignal<ImageAttachment[]>([]);
  const [imageError, setImageError] = createSignal<string | null>(null);
  let textareaRef: HTMLTextAreaElement | undefined;

  const focusInput = () => {
    // Always allow focus - disabled only prevents submission, not typing
    textareaRef?.focus();
  };

  let unlistenFocus: (() => void) | undefined;

  onMount(() => {
    focusInput();
    // Expose methods to parent via ref callback (synchronous)
    props.ref?.({ focus: focusInput, addImageFile: addImageFromFile });
    // Use Tauri's native window focus event instead of browser's window focus
    // The browser's window.focus event doesn't fire when the native window is activated
    const appWindow = getCurrentWindow();
    appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        focusInput();
      }
    }).then((unlisten) => {
      unlistenFocus = unlisten;
    });
  });

  onCleanup(() => {
    unlistenFocus?.();
  });

  // ============================================================================
  // Image Handling
  // ============================================================================

  const validateImage = (file: File): { valid: boolean; error?: string } => {
    if (!SUPPORTED_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_TYPES[number])) {
      return { valid: false, error: `Unsupported format: ${file.type}. Use JPEG, PNG, WebP, or GIF.` };
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return { valid: false, error: `Image too large (${sizeMB}MB). Max size is 3.75MB.` };
    }
    return { valid: true };
  };

  const addImageFromFile = async (file: File) => {
    // Validate
    const validation = validateImage(file);
    if (!validation.valid) {
      setImageError(validation.error || "Invalid image");
      setTimeout(() => setImageError(null), 3000);
      return;
    }

    // Read as data URL
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

    // Extract base64 data and media type from data URL
    // Format: "data:image/png;base64,iVBORw0KGgo..."
    const [prefix, data] = dataUrl.split(",");
    const mediaType = prefix.match(/data:(.*);/)?.[1] || "image/png";

    const attachment: ImageAttachment = {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      data,
      mediaType,
      thumbnail: dataUrl,
      fileName: file.name,
      size: file.size,
    };

    setImages((prev) => [...prev, attachment]);
    setImageError(null);
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handlePaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Check for images in clipboard
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await addImageFromFile(file);
        }
      }
    }
  };

  // ============================================================================
  // Keyboard & Input Handling
  // ============================================================================

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
    // Show "Planning" when Claude is in planning mode (via EnterPlanMode tool)
    if (props.isPlanning) {
      return { label: "Planning", icon: "📋", class: "mode-planning" };
    }
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
    const currentImages = images();

    // Need either text or images
    if (!text && currentImages.length === 0) return;
    if (props.disabled) return;

    // Add to history (text only)
    if (text) {
      setHistory((prev) => [...prev.filter((h) => h !== text), text]);
    }
    setHistoryIndex(-1);

    // Clear state
    setValue("");
    setImages([]);

    // Submit with images
    props.onSubmit(text, currentImages.length > 0 ? currentImages : undefined);

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
      {/* Image thumbnails */}
      <Show when={images().length > 0}>
        <div class="image-attachments">
          <For each={images()}>
            {(img) => (
              <div class="image-thumbnail">
                <img src={img.thumbnail} alt={img.fileName || "Attached image"} />
                <button
                  class="remove-btn"
                  onClick={() => removeImage(img.id)}
                  title="Remove image"
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Error message */}
      <Show when={imageError()}>
        <div class="image-error">{imageError()}</div>
      </Show>

      {/* Input row */}
      <div class="input-row">
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
          onPaste={handlePaste}
          placeholder={props.placeholder || "Type a message..."}
          rows={1}
        />
      </div>
    </div>
  );
};

export default CommandInput;
