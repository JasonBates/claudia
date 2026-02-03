import { Component, Show, createMemo } from "solid-js";
import "./UpdateBanner.css";
import type { UpdateStatus } from "../lib/store/types";

interface UpdateBannerProps {
  version: string;
  currentVersion: string;
  releaseNotes: string | null;
  downloadProgress: number | null;
  status: UpdateStatus;
  error: string | null;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

const UpdateBanner: Component<UpdateBannerProps> = (props) => {
  const statusText = createMemo(() => {
    switch (props.status) {
      case "checking":
        return "Checking for updates...";
      case "downloading":
        return `Downloading... ${props.downloadProgress ?? 0}%`;
      case "ready":
        return "Update ready to install";
      case "error":
        return props.error || "Update failed";
      default:
        return `v${props.version} available`;
    }
  });

  const isError = () => props.status === "error";
  const isDownloading = () => props.status === "downloading";
  const isReady = () => props.status === "ready";
  const isIdle = () => props.status === "idle";

  return (
    <div class="update-banner" classList={{ error: isError() }}>
      <span class="update-icon">
        <Show when={!isError()} fallback="!">
          ↑
        </Show>
      </span>

      <span class="update-text">{statusText()}</span>

      <Show when={isDownloading()}>
        <div class="update-progress">
          <div
            class="update-progress-bar"
            style={{ width: `${props.downloadProgress ?? 0}%` }}
          />
        </div>
      </Show>

      <Show when={isIdle()}>
        <button class="update-btn" onClick={props.onDownload}>
          Download
        </button>
      </Show>

      <Show when={isReady()}>
        <button class="update-btn primary" onClick={props.onInstall}>
          Restart Now
        </button>
      </Show>

      <button
        class="update-dismiss"
        onClick={props.onDismiss}
        title="Dismiss"
        aria-label="Dismiss update notification"
      >
        ×
      </button>
    </div>
  );
};

export default UpdateBanner;
