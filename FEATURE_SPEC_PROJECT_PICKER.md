# Claudia Project Picker Feature Spec

## Problem Statement

Claudia is a Tauri 2 + SolidJS desktop app that wraps Claude Code CLI. Currently, when launched:

1. **With CLI arg**: Opens in specified directory (`claudia /path/to/dir`) ✓ Works
2. **Without arg**: Opens in home directory or `default_working_dir` from config

The user wants a **project picker** that appears on launch (when no directory is specified) showing available projects to choose from, rather than defaulting to home directory.

**Key requirement**: Projects should be **auto-discovered** by scanning the filesystem, not maintained as a hardcoded list.

---

## Current Architecture

### Tech Stack
- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Rust + Tauri 2 + Tokio
- **IPC**: Tauri invoke/commands

### How Directory is Currently Determined

**Priority order (highest to lowest):**
1. CLI argument (`claudia /some/path`)
2. Config file `default_working_dir` field
3. Home directory fallback

**Relevant code paths:**

```
Backend (Rust):
├── src-tauri/src/lib.rs           # CLI arg parsing in setup()
├── src-tauri/src/commands/mod.rs  # AppState stores launch_dir
├── src-tauri/src/commands/session.rs  # start_session(working_dir?)
└── src-tauri/src/config.rs        # Config::working_dir() method

Frontend (TypeScript):
├── src/App.tsx                    # Main app, calls session.startSession()
├── src/hooks/useSession.ts        # Session lifecycle management
└── src/lib/tauri.ts               # getLaunchDir(), startSession() Tauri calls
```

### Existing Assets
- `tauri_plugin_dialog` is already in Cargo.toml (native file picker ready)
- Config system exists at `~/.config/claudia/config.json`
- Multi-window support via `open_new_window(directory)` command

---

## Proposed Solution

### User Flow

```
App Launch
    │
    ├─── Has CLI directory arg? ──Yes──► Start session in that directory
    │
    No
    │
    ▼
Show Project Picker Modal
    │
    ├── List of auto-discovered projects (grouped by type)
    ├── Recent projects section (from config)
    ├── "Browse..." button (opens native file picker)
    │
    ▼
User selects project
    │
    ▼
Start session in selected directory
(Save to recent projects in config)
```

### Project Auto-Discovery

**Scan these configurable root directories:**
- `~/Code/repos/` (git repositories)
- `~/Obsidian/VAULTS/` (Obsidian vaults)
- Additional paths from config `scan_paths` array

**Detection heuristics (check for presence of):**

| Project Type | Detection | Icon |
|--------------|-----------|------|
| Git repo | `.git/` directory | 󰊢 |
| Obsidian vault | `.obsidian/` directory | 󰎞 |
| Claudia project | `.claudia/` directory or `CLAUDE.md` file | 󰚩 |
| Node.js | `package.json` file | 󰎙 |
| Python | `pyproject.toml` or `requirements.txt` | 󰌠 |
| Rust | `Cargo.toml` file | 󱘗 |

**Scan depth**: 2 levels max (to keep it fast)

---

## Implementation Plan

### Phase 1: Backend - Project Scanner

**New file: `src-tauri/src/commands/projects.rs`**

```rust
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub name: String,
    pub path: String,
    pub project_type: ProjectType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProjectType {
    Git,
    Obsidian,
    Claudia,
    NodeJs,
    Python,
    Rust,
    Generic,
}

#[command]
pub async fn scan_projects(scan_paths: Vec<String>) -> Result<Vec<Project>, String> {
    // Scan each path up to 2 levels deep
    // Detect project type based on marker files
    // Return sorted list of projects
}

#[command]
pub async fn get_recent_projects() -> Result<Vec<Project>, String> {
    // Read from config file
}

#[command]
pub async fn add_recent_project(path: String) -> Result<(), String> {
    // Add to config, keep max 10 recents
}
```

**Register in `src-tauri/src/lib.rs`:**
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    projects::scan_projects,
    projects::get_recent_projects,
    projects::add_recent_project,
])
```

### Phase 2: Config Schema Update

**Update `src-tauri/src/config.rs`:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    // ... existing fields

    /// Directories to scan for projects
    #[serde(default = "default_scan_paths")]
    pub scan_paths: Vec<String>,

    /// Recently opened projects (most recent first)
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

fn default_scan_paths() -> Vec<String> {
    vec![
        dirs::home_dir().unwrap().join("Code/repos").to_string_lossy().to_string(),
        dirs::home_dir().unwrap().join("Obsidian/VAULTS").to_string_lossy().to_string(),
    ]
}
```

### Phase 3: Frontend - Project Picker Component

**New file: `src/components/ProjectPicker.tsx`**

```tsx
import { createSignal, createResource, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface Project {
  name: string;
  path: string;
  project_type: string;
}

interface ProjectPickerProps {
  onSelect: (path: string) => void;
}

export function ProjectPicker(props: ProjectPickerProps) {
  const [recentProjects] = createResource(() =>
    invoke<Project[]>("get_recent_projects")
  );

  const [scannedProjects] = createResource(() =>
    invoke<Project[]>("scan_projects", { scanPaths: [] }) // uses config defaults
  );

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Project Directory",
    });
    if (selected) {
      props.onSelect(selected as string);
    }
  };

  return (
    <div class="project-picker-modal">
      <h2>Open Project</h2>

      <Show when={recentProjects()?.length}>
        <section>
          <h3>Recent</h3>
          <For each={recentProjects()}>
            {(project) => (
              <button onClick={() => props.onSelect(project.path)}>
                {project.name}
              </button>
            )}
          </For>
        </section>
      </Show>

      <section>
        <h3>Projects</h3>
        <For each={scannedProjects()}>
          {(project) => (
            <button onClick={() => props.onSelect(project.path)}>
              <span class={`icon-${project.project_type}`} />
              {project.name}
              <span class="path">{project.path}</span>
            </button>
          )}
        </For>
      </section>

      <button onClick={handleBrowse}>Browse...</button>
    </div>
  );
}
```

### Phase 4: Integration in App.tsx

**Modify `src/App.tsx`:**

```tsx
// Add new state
const [showProjectPicker, setShowProjectPicker] = createSignal(false);

// In startup logic (around line 888), before starting session:
onMount(async () => {
  const launchDir = await getLaunchDir();

  if (!launchDir) {
    // No CLI arg provided, show picker
    setShowProjectPicker(true);
  } else {
    // CLI arg provided, start directly
    session.startSession(launchDir);
  }
});

// Handle project selection
const handleProjectSelect = async (path: string) => {
  await invoke("add_recent_project", { path });
  setShowProjectPicker(false);
  session.startSession(path);
};

// In JSX, conditionally render picker
<Show when={showProjectPicker()} fallback={/* existing app UI */}>
  <ProjectPicker onSelect={handleProjectSelect} />
</Show>
```

---

## File Changes Summary

| File | Action | ~Lines |
|------|--------|--------|
| `src-tauri/src/commands/projects.rs` | Create | 80-100 |
| `src-tauri/src/commands/mod.rs` | Add module export | 2 |
| `src-tauri/src/lib.rs` | Register commands | 5 |
| `src-tauri/src/config.rs` | Add scan_paths, recent_projects | 20 |
| `src/components/ProjectPicker.tsx` | Create | 100-150 |
| `src/App.tsx` | Add picker logic | 30 |
| `src/styles/` | Picker styling | 50 |

---

## Configuration Example

**~/.config/claudia/config.json:**
```json
{
  "scan_paths": [
    "/Users/jasonbates/Code/repos",
    "/Users/jasonbates/Obsidian/VAULTS"
  ],
  "recent_projects": [
    "/Users/jasonbates/Obsidian/VAULTS/Trinity",
    "/Users/jasonbates/Code/repos/claudia"
  ]
}
```

---

## Edge Cases to Handle

1. **Empty scan results**: Show helpful message + Browse button
2. **Scan takes too long**: Show loading spinner, consider caching
3. **Permission denied on scan**: Skip those directories silently
4. **Project deleted but in recents**: Remove from recents when selected
5. **Keyboard navigation**: Arrow keys + Enter to select

---

## Future Enhancements (Out of Scope)

- Project search/filter box
- Pin favorite projects
- Project groups/tags
- Scan in background on app launch (cache results)
- Remember window position per project
