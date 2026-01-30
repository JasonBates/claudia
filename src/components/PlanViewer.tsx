import { Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { readTextFile, watch } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import MessageContent from "./MessageContent";
import "../App.css";

const PlanViewer: Component = () => {
  const [content, setContent] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [filePath, setFilePath] = createSignal<string | null>(null);

  // Get plan file path from URL params
  const getFilePath = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("file");
  };

  // Load plan content from file
  const loadContent = async (path: string) => {
    try {
      const text = await readTextFile(path);
      setContent(text);
      setError(null);
    } catch (e) {
      console.error("[PLAN_VIEWER] Failed to read file:", e);
      setError(`Failed to load plan: ${e}`);
    }
  };

  onMount(async () => {
    const path = getFilePath();
    setFilePath(path);
    console.log("[PLAN_VIEWER] Mounted with file path:", path);

    let unwatchFile: (() => void) | undefined;

    if (path) {
      await loadContent(path);

      // Watch the file for changes
      try {
        unwatchFile = await watch(path, async (event) => {
          console.log("[PLAN_VIEWER] File changed:", event);
          // Reload content on any change
          await loadContent(path);
        });
        console.log("[PLAN_VIEWER] File watcher set up for:", path);
      } catch (e) {
        console.error("[PLAN_VIEWER] Failed to watch file:", e);
      }
    }

    // Listen for content updates from main window (backup mechanism)
    const unlisten = await listen<string>("plan-content-updated", (event) => {
      console.log("[PLAN_VIEWER] Received content update event");
      setContent(event.payload);
    });

    // Listen for close signal when planning ends
    const unlistenClose = await listen("plan-window-close", () => {
      console.log("[PLAN_VIEWER] Received close signal");
      window.close();
    });

    onCleanup(() => {
      unlisten();
      unlistenClose();
      unwatchFile?.();
    });
  });

  return (
    <div class="plan-viewer">
      <div class="plan-viewer-header">
        <div class="drag-region" data-tauri-drag-region="true"></div>
        <span class="plan-viewer-title">Plan</span>
        <Show when={filePath()}>
          <span class="plan-viewer-path">{filePath()?.split("/").pop()}</span>
        </Show>
      </div>

      <Show when={error()}>
        <div class="plan-viewer-error">{error()}</div>
      </Show>

      <div class="plan-viewer-content">
        <Show when={content()} fallback={<div class="plan-viewer-loading">Loading plan...</div>}>
          <MessageContent content={content()} />
        </Show>
      </div>
    </div>
  );
};

export default PlanViewer;
