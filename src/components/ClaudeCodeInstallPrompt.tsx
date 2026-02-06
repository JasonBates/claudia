import { Component } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

interface ClaudeCodeInstallPromptProps {
  onCheckAgain: () => void;
  isChecking: boolean;
}

const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/getting-started";

const ClaudeCodeInstallPrompt: Component<ClaudeCodeInstallPromptProps> = (props) => {
  const handleOpenInstallGuide = async () => {
    try {
      await openUrl(INSTALL_URL);
    } catch (e) {
      console.error("Failed to open install URL:", e);
      // Fallback: copy to clipboard or show the URL
      window.navigator.clipboard?.writeText(INSTALL_URL);
    }
  };

  return (
    <div class="install-prompt-overlay">
      <div class="install-prompt-modal">
        <div class="install-prompt-icon">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </div>

        <h2 class="install-prompt-title">Claude Code Required</h2>

        <p class="install-prompt-message">
          Claudia requires Claude Code CLI to be installed. Claude Code is
          Anthropic's official command-line tool that powers this interface.
        </p>

        <div class="install-prompt-steps">
          <p class="install-prompt-step-header">To get started:</p>
          <ol>
            <li>
              Install Claude Code via npm:
              <code>npm install -g @anthropic-ai/claude-code</code>
            </li>
            <li>Run <code>claude</code> in your terminal to authenticate</li>
            <li>Come back here and click "Check Again"</li>
          </ol>
        </div>

        <div class="install-prompt-actions">
          <button
            class="install-prompt-btn primary"
            onClick={handleOpenInstallGuide}
          >
            View Installation Guide
          </button>
          <button
            class="install-prompt-btn secondary"
            onClick={props.onCheckAgain}
            disabled={props.isChecking}
          >
            {props.isChecking ? "Checking..." : "Check Again"}
          </button>
        </div>

        <p class="install-prompt-hint">
          Already installed? Make sure <code>claude</code> is in your PATH or
          installed in a standard location like <code>~/.local/bin</code>
        </p>
      </div>
    </div>
  );
};

export default ClaudeCodeInstallPrompt;
