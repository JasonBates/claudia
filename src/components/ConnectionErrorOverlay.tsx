import { Component, createSignal } from "solid-js";
import { quitApp } from "../lib/tauri";

interface ConnectionErrorOverlayProps {
  error: string;
  onRetry: () => Promise<void>;
}

const ConnectionErrorOverlay: Component<ConnectionErrorOverlayProps> = (props) => {
  const [retrying, setRetrying] = createSignal(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await props.onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const handleQuit = async () => {
    await quitApp();
  };

  return (
    <div class="connection-error-overlay">
      <div class="connection-error-modal">
        <div class="connection-error-icon">
          <span>⊘</span>
        </div>
        <h2 class="connection-error-title">Connection Failed</h2>
        <p class="connection-error-message">
          Unable to connect to Claude backend
        </p>
        <p class="connection-error-detail">
          {props.error}
        </p>
        <div class="connection-error-actions">
          <button
            class="connection-error-btn primary"
            onClick={handleRetry}
            disabled={retrying()}
          >
            {retrying() ? "Connecting..." : "Retry Connection"}
          </button>
          <button class="connection-error-btn secondary" onClick={handleQuit}>
            Quit
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectionErrorOverlay;
