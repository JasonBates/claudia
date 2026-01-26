# Streaming Command Runner

A general-purpose system for running external commands with real-time output streaming. This is a reusable pattern for any long-running CLI tool.

## Overview

The streaming command runner allows the app to execute external processes (sync tools, test runners, build systems, etc.) while displaying output in real-time rather than waiting for completion.

## Architecture

```
Frontend                     Rust Backend
─────────                    ────────────
runStreamingCommand()   ──►  run_streaming_command
       ↑                           │
       │ Channel<CommandEvent>     │ spawn process with piped stdout/stderr
       │                           │ thread per stream reads lines
       └───────────────────────────┘ emits events via channel
```

## Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/streaming.rs` | Rust module: process spawning, binary resolution, event emission |
| `src-tauri/src/events.rs` | `CommandEvent` enum definition |
| `src/lib/tauri.ts` | TypeScript `runStreamingCommand()` function |

## Binary Resolution (macOS PATH Issue)

macOS Launch Services spawns apps with a minimal PATH that excludes user-installed binaries like:
- `~/.local/bin` (pipx, uv tools)
- `~/.nvm/versions/node/*/bin` (nvm-managed Node)
- `~/.bun/bin` (Bun)
- Homebrew paths (sometimes)

The streaming module solves this by manually searching common locations:

```rust
fn find_binary(name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    // Check common locations for user-installed binaries
    let candidates = [
        home.join(".local/bin").join(name),          // pipx, uv
        home.join(format!(".{}-repo/{}", name, name)), // e.g., ~/.ccms-repo/ccms
        PathBuf::from("/opt/homebrew/bin").join(name), // Homebrew (Apple Silicon)
        PathBuf::from("/usr/local/bin").join(name),    // Homebrew (Intel)
        PathBuf::from("/usr/bin").join(name),          // System
    ];

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    // Also searches nvm directories for node-based tools
    let nvm_dir = home.join(".nvm/versions/node");
    if nvm_dir.exists() {
        // Find latest version and check its bin directory
        // ...
    }

    None
}
```

## Event Types

```rust
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommandEvent {
    /// Command started executing
    Started { command_id: String, command: String },

    /// Line of stdout output
    Stdout { command_id: String, line: String },

    /// Line of stderr output
    Stderr { command_id: String, line: String },

    /// Command finished
    Completed { command_id: String, exit_code: i32, success: bool },

    /// Command failed to start
    Error { command_id: String, message: String },
}
```

## Usage

### TypeScript (Frontend)

```typescript
import { runStreamingCommand, CommandEvent } from "./lib/tauri";
import { getOwner } from "solid-js";

const owner = getOwner(); // For SolidJS reactivity

let output = "";
await runStreamingCommand(
  "ccms",                              // program
  ["--force", "--verbose", "pull"],    // args
  (event: CommandEvent) => {           // callback
    if (event.type === "stdout" || event.type === "stderr") {
      output += event.line + "\n";
      updateUI(output);
    } else if (event.type === "completed") {
      console.log(event.success ? "Done!" : "Failed");
    } else if (event.type === "error") {
      console.error("Failed to start:", event.message);
    }
  },
  undefined,  // workingDir (optional)
  owner       // SolidJS owner (optional, for reactivity)
);
```

### Rust (Backend)

```rust
use crate::streaming::{StreamingCommand, run_streaming};
use crate::events::CommandEvent;
use tauri::ipc::Channel;

#[tauri::command]
pub async fn run_streaming_command(
    program: String,
    args: Vec<String>,
    working_dir: Option<String>,
    channel: Channel<CommandEvent>,
) -> Result<String, String> {
    let command_id = uuid::Uuid::new_v4().to_string();

    let cmd = StreamingCommand {
        program,
        args,
        working_dir,
    };

    let id = command_id.clone();
    tokio::task::spawn_blocking(move || {
        run_streaming(cmd, id, channel)
    }).await.map_err(|e| e.to_string())??;

    Ok(command_id)
}
```

## SolidJS Reactivity Integration

Tauri channel callbacks run outside SolidJS's reactive tracking context. To ensure UI updates work correctly, wrap callbacks with `runWithOwner()` and `batch()`:

```typescript
import { runWithOwner, batch, Owner } from "solid-js";
import { Channel } from "@tauri-apps/api/core";

export async function runStreamingCommand(
  program: string,
  args: string[],
  onEvent: (event: CommandEvent) => void,
  workingDir?: string,
  owner?: Owner | null
): Promise<string> {
  const channel = new Channel<CommandEvent>();

  // Restore SolidJS reactive context for channel callbacks
  channel.onmessage = (event) => {
    if (owner) {
      runWithOwner(owner, () => {
        batch(() => {
          onEvent(event);
        });
      });
    } else {
      onEvent(event);
    }
  };

  return await invoke<string>("run_streaming_command", {
    program,
    args,
    workingDir,
    channel,
  });
}
```

## Current Uses

### `/sync` Command

The sync command uses streaming to show CCMS pull/push progress:

```typescript
// In App.tsx handleSyncCommand()
await runStreamingCommand(
  "ccms",
  ["--force", "--verbose", "pull"],
  (event: CommandEvent) => {
    if (event.type === "stdout" || event.type === "stderr") {
      output += (event.line || "") + "\n";
      updateSyncResult(output);
    } else if (event.type === "completed") {
      output += event.success ? "✓ Pull complete\n" : "✗ Pull failed\n";
      updateSyncResult(output);
    }
  },
  undefined,
  owner
);
```

## Future Uses

The streaming system is designed to be reused for:

- **`/test`** - Stream test runner output (jest, vitest, cargo test)
- **`/build`** - Stream build process (npm, cargo, make)
- **`/lint`** - Stream linter output (eslint, clippy)
- **`/deploy`** - Stream deployment logs
- Any long-running CLI tool that produces incremental output

## Adding a New Streaming Command

Follow these steps to add a new slash command that streams output:

### Step 1: Create the Handler Function

Add a handler function in `App.tsx` (near `handleSyncCommand`):

```typescript
const handleTestCommand = async () => {
  const msgId = `test-${Date.now()}`;
  const toolId = `test-tool-${Date.now()}`;

  // Helper to update the tool result
  const updateResult = (text: string, loading: boolean = true) => {
    setMessages(prev => prev.map(m =>
      m.id === msgId
        ? {
            ...m,
            toolUses: m.toolUses?.map(t =>
              t.id === toolId
                ? {
                    ...t,
                    isLoading: loading,
                    result: text,
                    // IMPORTANT: Set autoExpanded when done so result stays visible
                    autoExpanded: !loading ? true : t.autoExpanded
                  }
                : t
            )
          }
        : m
    ));
  };

  // Block input while running
  setIsLoading(true);

  // Add message with tool-style display
  setMessages(prev => [...prev, {
    id: msgId,
    role: "assistant",
    content: "",
    toolUses: [{
      id: toolId,
      name: "Test",  // Display name in UI
      input: { command: "npm test" },  // Shown in collapsed view
      isLoading: true,
      result: ""
    }]
  }]);

  let output = "";

  try {
    output = "▶ Running tests...\n";
    updateResult(output);

    await runStreamingCommand(
      "npm",
      ["test"],
      (event: CommandEvent) => {
        if (event.type === "stdout" || event.type === "stderr") {
          output += (event.line || "") + "\n";
          updateResult(output);
        } else if (event.type === "completed") {
          output += event.success ? "✓ Tests passed\n" : "✗ Tests failed\n";
          updateResult(output, false);  // Done loading
        } else if (event.type === "error") {
          output += `✗ Error: ${event.message}\n`;
          updateResult(output, false);
        }
      },
      undefined,  // workingDir - or pass a specific directory
      owner
    );
  } catch (e) {
    output += `\n✗ Error: ${e}`;
    updateResult(output, false);
  } finally {
    setIsLoading(false);
  }
};
```

### Step 2: Add Command Trigger

In `handleSubmit()`, add the command check **before** the `isLoading()` check:

```typescript
const handleSubmit = async (text: string) => {
  // Handle /sync command locally
  if (text.trim().toLowerCase() === "/sync") {
    await handleSyncCommand();
    return;
  }

  // ADD YOUR NEW COMMAND HERE
  if (text.trim().toLowerCase() === "/test") {
    await handleTestCommand();
    return;
  }

  if (isLoading()) return;
  // ... rest of handleSubmit
};
```

### Step 3: Import CommandEvent (if not already)

At the top of `App.tsx`:

```typescript
import { ..., runStreamingCommand, CommandEvent } from "./lib/tauri";
```

### Key Points

| Aspect | Requirement |
|--------|-------------|
| **autoExpanded** | Set to `true` when `loading: false` - ensures result stays visible after completion |
| **owner** | Pass `getOwner()` result for SolidJS reactivity in callbacks |
| **Error handling** | Always set `loading: false` in error cases and finally block |
| **Binary paths** | User-installed binaries are auto-resolved (see Binary Resolution section) |

### Potential Commands to Implement

| Command | Program | Args | Notes |
|---------|---------|------|-------|
| `/test` | `npm` | `["test"]` | Or `cargo test`, `pytest`, etc. |
| `/build` | `npm` | `["run", "build"]` | Or `cargo build`, `make` |
| `/lint` | `npm` | `["run", "lint"]` | Or `eslint .`, `cargo clippy` |
| `/typecheck` | `npm` | `["run", "typecheck"]` | Or `tsc --noEmit` |
| `/git-status` | `git` | `["status"]` | Quick git info |
| `/git-pull` | `git` | `["pull"]` | Sync from remote |

## Troubleshooting

See [troubleshooting.md](troubleshooting.md) for common issues:
- "Failed to spawn" errors (binary not found)
- Progress not showing during execution
- UI not updating in real-time
