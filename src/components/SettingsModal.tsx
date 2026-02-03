import { Component, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import type { ColorSchemeInfo } from "../lib/tauri";
import type { FontOption } from "../hooks/useSettings";
import type { UpdateStatus } from "../lib/store/types";

interface SettingsModalProps {
  contentMargin: number;
  fontFamily: string;
  fontSize: number;
  colorScheme: string | null;
  availableSchemes: ColorSchemeInfo[];
  availableFonts: FontOption[];
  saveLocally: boolean;
  onMarginChange: (margin: number) => void;
  onFontChange: (font: string) => void;
  onFontSizeChange: (size: number) => void;
  onColorSchemeChange: (scheme: string | null) => void;
  onSaveLocallyChange: (locally: boolean) => void;
  onResetDefaults: () => void;
  onClose: () => void;
  // Update props
  currentVersion: string;
  updateAvailable: { version: string } | null;
  updateStatus: UpdateStatus;
  onCheckForUpdates: () => Promise<void>;
}

const SettingsModal: Component<SettingsModalProps> = (props) => {
  let modalRef: HTMLDivElement | undefined;
  const [checkStatus, setCheckStatus] = createSignal<"idle" | "checking" | "done" | "error">("idle");

  const handleCheckForUpdates = async () => {
    setCheckStatus("checking");
    try {
      await props.onCheckForUpdates();
      setCheckStatus("done");
    } catch {
      setCheckStatus("error");
    }
  };

  // Handle Escape key to close
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Group schemes: bundled first, then user schemes
  const bundledSchemes = () =>
    props.availableSchemes.filter((s) => s.is_bundled);
  const userSchemes = () =>
    props.availableSchemes.filter((s) => !s.is_bundled);

  return (
    <div class="settings-modal-overlay" onClick={props.onClose}>
      <div
        ref={modalRef}
        class="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="settings-modal-header">
          <h2>Settings</h2>
          <button
            class="settings-close-btn"
            onClick={props.onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div class="settings-modal-content">
          {/* Version & Update Section */}
          <div class="settings-section settings-version-section">
            <div class="settings-about-row">
              <span class="settings-version">Claudia v{props.currentVersion}</span>
              <button
                class="settings-update-btn"
                onClick={handleCheckForUpdates}
                disabled={checkStatus() === "checking" || props.updateStatus === "downloading"}
              >
                <Show when={checkStatus() === "checking"} fallback="Check for Updates">
                  Checking...
                </Show>
              </button>
            </div>
            <Show when={checkStatus() === "done"}>
              <p class="settings-hint settings-update-result">
                <Show
                  when={props.updateAvailable}
                  fallback={<span class="update-current">You're up to date</span>}
                >
                  <span class="update-available">
                    v{props.updateAvailable?.version} available — see banner above
                  </span>
                </Show>
              </p>
            </Show>
            <Show when={checkStatus() === "error"}>
              <p class="settings-hint settings-update-result">
                <span class="update-error">Check failed — try again later</span>
              </p>
            </Show>
          </div>

          {/* Content Margins Section */}
          <div class="settings-section">
            <label class="settings-label">Content Margins</label>
            <p class="settings-hint">
              Adjust horizontal padding for better readability on wide displays
            </p>
            <div class="settings-slider-row">
              <input
                type="range"
                class="settings-slider"
                min={16}
                max={300}
                step={4}
                value={props.contentMargin}
                onInput={(e) =>
                  props.onMarginChange(parseInt(e.currentTarget.value))
                }
              />
              <span class="settings-value">{props.contentMargin}px</span>
            </div>
          </div>

          {/* Font Family Section */}
          <div class="settings-section">
            <label class="settings-label">Font Family</label>
            <select
              class="settings-select"
              value={props.fontFamily}
              onChange={(e) => props.onFontChange(e.currentTarget.value)}
            >
              <For each={props.availableFonts}>
                {(font) => <option value={font.value}>{font.label}</option>}
              </For>
            </select>
          </div>

          {/* Font Size Section */}
          <div class="settings-section">
            <label class="settings-label">Font Size</label>
            <div class="settings-slider-row">
              <input
                type="range"
                class="settings-slider"
                min={12}
                max={24}
                step={1}
                value={props.fontSize}
                onInput={(e) =>
                  props.onFontSizeChange(parseInt(e.currentTarget.value))
                }
              />
              <span class="settings-value">{props.fontSize}px</span>
            </div>
          </div>

          {/* Color Scheme Section */}
          <div class="settings-section">
            <label class="settings-label">Color Scheme</label>

            {/* Bundled Schemes */}
            <div class="color-scheme-grid">
              <For each={bundledSchemes()}>
                {(scheme) => (
                  <button
                    class="color-scheme-option"
                    classList={{ selected: props.colorScheme === scheme.name }}
                    onClick={() => props.onColorSchemeChange(scheme.name)}
                  >
                    <ColorSchemePreview name={scheme.name} />
                    <span class="color-scheme-name">{scheme.name}</span>
                  </button>
                )}
              </For>
            </div>

            {/* User Schemes (if any) */}
            {userSchemes().length > 0 && (
              <>
                <p class="settings-hint" style={{ "margin-top": "16px" }}>
                  From iTerm2
                </p>
                <div class="color-scheme-grid">
                  <For each={userSchemes()}>
                    {(scheme) => (
                      <button
                        class="color-scheme-option"
                        classList={{
                          selected: props.colorScheme === scheme.name,
                        }}
                        onClick={() => props.onColorSchemeChange(scheme.name)}
                      >
                        <div class="color-scheme-preview">
                          <div
                            class="color-swatch"
                            style={{ background: "var(--fg-muted)" }}
                          />
                        </div>
                        <span class="color-scheme-name">{scheme.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              </>
            )}
          </div>

        </div>

        <div class="settings-modal-footer">
          <label class="settings-checkbox">
            <input
              type="checkbox"
              checked={props.saveLocally}
              onChange={(e) => props.onSaveLocallyChange(e.currentTarget.checked)}
            />
            Save settings for this directory only
          </label>
          <button class="settings-reset-btn" onClick={props.onResetDefaults}>
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Preview swatches for bundled color schemes
 */
const ColorSchemePreview: Component<{ name: string }> = (props) => {
  // Define preview colors for each bundled scheme
  const schemeColors: Record<string, { bg: string; fg: string; accent: string }> = {
    "Solarized Dark": { bg: "#002b36", fg: "#93a1a1", accent: "#268bd2" },
    "Solarized Light": { bg: "#fdf6e3", fg: "#657b83", accent: "#268bd2" },
    Dracula: { bg: "#282a36", fg: "#f8f8f2", accent: "#bd93f9" },
    Nord: { bg: "#2e3440", fg: "#eceff4", accent: "#88c0d0" },
    "One Dark": { bg: "#282c34", fg: "#abb2bf", accent: "#61afef" },
    "Gruvbox Dark": { bg: "#282828", fg: "#ebdbb2", accent: "#83a598" },
  };

  const colors = () => schemeColors[props.name] || { bg: "#333", fg: "#fff", accent: "#0af" };

  return (
    <div class="color-scheme-preview">
      <div class="color-swatch" style={{ background: colors().bg }} />
      <div class="color-swatch" style={{ background: colors().fg }} />
      <div class="color-swatch" style={{ background: colors().accent }} />
    </div>
  );
};

export default SettingsModal;
