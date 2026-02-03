import { Component, createSignal, Show, onMount } from "solid-js";
import { getBotApiKey, setBotApiKey, validateBotApiKey } from "../lib/tauri";

interface BotSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  /** Error message to display (e.g., "API key required for BotGuard") */
  error?: string | null;
  /** Whether to highlight/focus the API key field */
  highlightApiKey?: boolean;
}

const BotSettings: Component<BotSettingsProps> = (props) => {
  console.log("[BOT_SETTINGS] Render - isOpen:", props.isOpen, "error:", props.error, "highlight:", props.highlightApiKey);

  const [apiKey, setApiKey] = createSignal("");
  const [maskedKey, setMaskedKey] = createSignal<string | null>(null);
  const [isValidating, setIsValidating] = createSignal(false);
  const [validationError, setValidationError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);

  let apiKeyInputRef: HTMLInputElement | undefined;

  onMount(async () => {
    // Load existing masked API key
    try {
      const existing = await getBotApiKey();
      if (existing) {
        setMaskedKey(existing);
      }
    } catch (e) {
      console.error("Failed to load API key:", e);
    }
  });

  // Focus API key input when highlighted
  const focusApiKeyInput = () => {
    if (props.highlightApiKey && apiKeyInputRef) {
      apiKeyInputRef.focus();
    }
  };

  const handleSave = async () => {
    const key = apiKey();
    if (!key.trim()) {
      setValidationError("API key is required");
      return;
    }

    setIsValidating(true);
    setValidationError(null);

    try {
      // Save the key first
      await setBotApiKey(key);

      // Validate it works
      const valid = await validateBotApiKey();
      if (!valid) {
        setValidationError("Invalid API key - please check and try again");
        setIsValidating(false);
        return;
      }

      // Update masked display
      const masked = await getBotApiKey();
      setMaskedKey(masked);

      // Clear input and show success
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      setIsValidating(false);
    } catch (e) {
      setValidationError(`Failed to save: ${e}`);
      setIsValidating(false);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="bot-settings-overlay" onClick={() => props.onClose()}>
        <div class="bot-settings-panel" onClick={(e) => e.stopPropagation()}>
          <div class="bot-settings-header">
            <h3>BotGuard Settings</h3>
            <button class="close-btn" onClick={() => props.onClose()}>
              &times;
            </button>
          </div>

          <div class="bot-settings-content">
            {/* Error banner */}
            <Show when={props.error}>
              <div class="bot-settings-error-banner">
                {props.error}
              </div>
            </Show>

            {/* API Key Section */}
            <div class={`bot-settings-field ${props.highlightApiKey ? "highlighted" : ""}`}>
              <label for="api-key">Anthropic API Key</label>
              <Show when={maskedKey()}>
                <div class="masked-key">
                  Current: <code>{maskedKey()}</code>
                </div>
              </Show>
              <div class="api-key-input-row">
                <input
                  ref={(el) => {
                    apiKeyInputRef = el;
                    // Focus when component mounts with highlight
                    setTimeout(focusApiKeyInput, 100);
                  }}
                  id="api-key"
                  type="password"
                  placeholder="sk-ant-api03-..."
                  value={apiKey()}
                  onInput={(e) => setApiKey(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                  autocomplete="off"
                />
                <button
                  class="save-btn"
                  onClick={handleSave}
                  disabled={isValidating() || !apiKey().trim()}
                >
                  {isValidating() ? "Validating..." : saved() ? "Saved!" : "Save"}
                </button>
              </div>
              <Show when={validationError()}>
                <div class="field-error">{validationError()}</div>
              </Show>
              <p class="field-hint">
                Your API key is stored in a local .env file and never sent anywhere except to the Anthropic API.
              </p>
            </div>

            {/* Info Section */}
            <div class="bot-settings-info">
              <h4>About BotGuard</h4>
              <p>
                BotGuard uses Claude Haiku to review tool permissions before auto-approving.
                Safe operations are approved automatically; dangerous operations are flagged for your review.
              </p>
              <ul>
                <li>Read/Write files, builds, tests, git - auto-approved</li>
                <li>rm -rf /, sudo, disk operations - flagged</li>
                <li>Review takes ~500ms using Haiku</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default BotSettings;
