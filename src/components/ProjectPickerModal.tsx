import {
  Component,
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import type { ProjectInfo } from "../lib/tauri";

interface ProjectPickerModalProps {
  projects: ProjectInfo[];
  currentPath: string | undefined;
  onSelect: (path: string, newWindow: boolean) => void;
  onClose?: () => void; // undefined = can't close (startup mode)
  onContinueInCurrentDir?: () => void; // Fallback for startup mode
  showCloseButton: boolean;
  isLoading?: boolean;
  error?: string;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

const ProjectPickerModal: Component<ProjectPickerModalProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let searchInputRef: HTMLInputElement | undefined;

  // Filter projects by search query
  const filteredProjects = createMemo(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return props.projects;
    return props.projects.filter(
      (p) =>
        p.displayName.toLowerCase().includes(query) ||
        p.decodedPath.toLowerCase().includes(query)
    );
  });

  // Reset selection when filter changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setSelectedIndex(0);
  };

  // Clamp selectedIndex when filtered list changes (QUAL-002 fix)
  createEffect(() => {
    const maxIndex = filteredProjects().length - 1;
    if (selectedIndex() > maxIndex) {
      setSelectedIndex(Math.max(0, maxIndex));
    }
  });

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    const projects = filteredProjects();

    // QUAL-003 fix: Don't handle arrow keys when focus is in unrelated inputs
    // (allows cursor movement in text). The project picker search input is
    // single-line, so up/down arrows should navigate the list, not move a cursor.
    const isInInput = e.target instanceof HTMLInputElement ||
                      e.target instanceof HTMLTextAreaElement;
    const isSearchInput = e.target === searchInputRef;

    switch (e.key) {
      case "ArrowDown":
        if (isInInput && !isSearchInput) return;
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(0, projects.length - 1)));
        break;
      case "ArrowUp":
        if (isInInput && !isSearchInput) return;
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (projects.length > 0) {
          const idx = selectedIndex();
          const selected = projects[idx];
          // Guard against out-of-bounds (QUAL-002 fix)
          if (!selected) return;
          const isNewWindow = e.metaKey || e.ctrlKey;
          // Allow selecting current project only for new window
          if (selected.decodedPath === props.currentPath && !isNewWindow) {
            return;
          }
          props.onSelect(selected.decodedPath, isNewWindow);
        }
        break;
      case "Escape":
        if (props.onClose) {
          props.onClose();
        }
        break;
    }
  };

  // Open directory dialog
  const handleOpenDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project Directory",
      });
      if (selected) {
        props.onSelect(selected as string, false);
      }
    } catch (e) {
      console.error("Failed to open directory dialog:", e);
    }
  };

  onMount(() => {
    searchInputRef?.focus();
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Scroll selected item into view when selection changes
  createEffect(() => {
    selectedIndex(); // track changes
    requestAnimationFrame(() => {
      const el = document.querySelector('.project-item.selected');
      el?.scrollIntoView({ block: "nearest" });
    });
  });

  return (
    <div class="project-picker-overlay" onClick={props.onClose}>
      <div class="project-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div class="project-picker-header">
          <h2>Open Project</h2>
          <Show when={props.showCloseButton && props.onClose}>
            <button class="project-picker-close" onClick={props.onClose}>
              ×
            </button>
          </Show>
        </div>

        <Show when={props.error}>
          <div class="project-picker-error">
            <span>{props.error}</span>
            <Show when={props.onContinueInCurrentDir}>
              <button
                class="project-picker-error-action"
                onClick={props.onContinueInCurrentDir}
              >
                Continue in current directory
              </button>
            </Show>
          </div>
        </Show>

        <Show when={props.isLoading}>
          <div class="project-picker-loading">Loading projects...</div>
        </Show>

        <Show when={!props.isLoading}>
          <input
            ref={searchInputRef}
            type="text"
            class="project-picker-search"
            placeholder="Search projects..."
            value={searchQuery()}
            onInput={(e) => handleSearchChange(e.currentTarget.value)}
          />

          <div class="project-list">
            <For each={filteredProjects()}>
              {(project, index) => {
                const isCurrent = () =>
                  project.decodedPath === props.currentPath;
                const isSelected = () => index() === selectedIndex();

                return (
                  <div
                    class={`project-item ${isSelected() ? "selected" : ""} ${isCurrent() ? "current" : ""}`}
                    onClick={() => {
                      if (!isCurrent()) {
                        props.onSelect(project.decodedPath, false);
                      }
                    }}
                  >
                    <div class="project-item-name">{project.displayName}</div>
                    <div class="project-item-path">{project.decodedPath}</div>
                    <div class="project-item-meta">
                      <Show when={!project.isNew} fallback="new project">
                        {formatRelativeTime(project.lastUsed)} ·{" "}
                        {project.sessionCount} sessions
                      </Show>
                    </div>
                    <Show when={isCurrent()}>
                      <span class="project-item-badge">current</span>
                    </Show>
                    <Show when={project.isNew && !isCurrent()}>
                      <span class="project-item-badge new">new</span>
                    </Show>
                  </div>
                );
              }}
            </For>

            <Show when={filteredProjects().length === 0 && searchQuery()}>
              <div class="project-list-empty">
                No projects match "{searchQuery()}"
              </div>
            </Show>

            <Show
              when={
                filteredProjects().length === 0 && !searchQuery() && !props.error
              }
            >
              <div class="project-list-empty">
                No projects found.
                <br />
                Use "Open Directory..." to get started.
              </div>
            </Show>
          </div>
        </Show>

        <div class="project-picker-footer">
          <div class="project-picker-footer-left">
            <button
              class="project-picker-open-btn"
              onClick={handleOpenDirectory}
            >
              Open Directory...
            </button>
            <Show when={props.onContinueInCurrentDir}>
              <button
                class="project-picker-skip-btn"
                onClick={props.onContinueInCurrentDir}
              >
                Skip
              </button>
            </Show>
          </div>
          <div class="project-picker-hint">
            <span>↵ open</span>
            <span>⌘↵ new window</span>
            <Show when={props.onClose}>
              <span>esc close</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

export { ProjectPickerModal };
