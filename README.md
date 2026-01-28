# Claudia (Claude Terminal)

A native macOS desktop app that wraps Claude Code CLI, providing a streamlined terminal-like interface for interacting with Claude.

## Features

- **Native macOS app** - Built with Tauri + SolidJS for fast, lightweight performance
- **CLI launcher** - Launch from terminal with `claudia` to use project-specific `.claude` configs
- **Multi-instance support** - Run multiple Claudia windows, each in different project directories
- **Real-time streaming** - Text and tool outputs stream as they're generated
- **Tool visualization** - Collapsible tool use blocks with syntax-highlighted results
- **Type-ahead input** - Continue typing while waiting for responses
- **Smart permissions** - Auto-approves in "auto" mode, shows dialog in "plan" mode
- **MCP integration** - Loads MCP servers from project or global `~/.claude/` config

## Documentation

| Document | Description |
|----------|-------------|
| **README.md** (this file) | Overview, quick start, lessons learned |
| **[docs/architecture.md](docs/architecture.md)** | Data flow, event types, state management, key files |
| **[docs/streaming.md](docs/streaming.md)** | Streaming command runner pattern (reusable) |
| **[docs/troubleshooting.md](docs/troubleshooting.md)** | Common issues, debugging techniques |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claudia.app (Tauri)                        │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (SolidJS)          │  Backend (Rust)                  │
│  ├─ App.tsx                  │  ├─ commands.rs                  │
│  ├─ MessageList.tsx          │  │   └─ Event loop with          │
│  ├─ CommandInput.tsx         │  │      timeout handling         │
│  └─ lib/tauri.ts             │  ├─ claude_process.rs            │
│      └─ Tauri IPC channel    │  │   └─ JSON event parser        │
│                              │  └─ events.rs                    │
│                              │      └─ Event type definitions   │
├─────────────────────────────────────────────────────────────────┤
│                     sdk-bridge-v2.mjs (Node.js)                 │
│                     └─ Spawns Claude CLI                        │
│                     └─ Translates CLI JSON to app events        │
├─────────────────────────────────────────────────────────────────┤
│                     Claude Code CLI                             │
│                     └─ --input-format stream-json               │
│                     └─ --output-format stream-json              │
│                     └─ Uses control_request for permissions      │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User input** → Frontend sends message via Tauri IPC
2. **Rust backend** → Writes to bridge's stdin, starts event loop
3. **Node.js bridge** → Sends JSON to Claude CLI, parses response events
4. **Bridge events** → Rust reads stdout, parses JSON, forwards via Tauri channel
5. **Frontend** → Receives events, updates reactive state, renders UI

### Key Event Types

| Event | Description |
|-------|-------------|
| `tool_start` | Tool invocation begins (includes tool ID and name) |
| `tool_input` | Streaming JSON chunks of tool parameters |
| `tool_pending` | Tool is about to execute |
| `tool_result` | Tool execution completed (includes `tool_use_id` for matching) |
| `text_delta` | Streaming text chunk from Claude |
| `thinking_delta` | Extended thinking chunk (when enabled) |
| `context_update` | Real-time token usage at response start |
| `result` | Final response metadata (tokens, cost, duration) |
| `done` | Response complete |

### Streaming Command Events

For external commands (sync, future test runners, etc.), a separate event type streams output:

| Event | Description |
|-------|-------------|
| `started` | Command began execution |
| `stdout` | Line of stdout output |
| `stderr` | Line of stderr output |
| `completed` | Command finished (includes exit code) |
| `error` | Command failed to start |

### Context Window Tracking

The app displays real-time context usage in the status bar. Token tracking uses this formula:

```
context = input_tokens + cache_read + cache_creation + output_tokens
```

Key insight: With Anthropic's prompt caching, `input_tokens` only represents tokens AFTER the last cache breakpoint—it can be as small as 10 tokens even when the actual context is 30k+. The `cache_read` and `cache_creation` fields contain the rest.

## Local Tools vs Server-Side Tools

This is a critical architectural distinction:

### Local Tools (Read, Edit, Bash, Glob, Grep, etc.)
- Executed by Claude Code CLI on your machine
- Results stream back immediately via standard `tool_result` events
- Fast response times

### Server-Side Tools (WebSearch, WebFetch)
- Executed on Anthropic's servers
- Results return embedded in a `type: "user"` message with `tool_result` content
- Can take 10+ seconds to execute
- The bridge extracts these and emits them as `tool_result` events
- **Requires extended timeout handling** in the Rust event loop

```javascript
// Bridge handling for server-side tool results
case "user":
  if (msg.message?.content && Array.isArray(msg.message.content)) {
    for (const item of msg.message.content) {
      if (item.type === "tool_result") {
        sendEvent("tool_result", {
          tool_use_id: item.tool_use_id,  // Critical for matching!
          stdout: item.content,
          isError: item.is_error || false
        });
      }
    }
  }
  break;
```

## Development

### Prerequisites
- Node.js 18+
- Rust toolchain
- Claude Code CLI (`claude` command available)

### Setup
```bash
npm install
npm run tauri dev
```

### Build
```bash
npm run tauri build
cp -R src-tauri/target/release/bundle/macos/Claudia.app /Applications/
```

### CLI Launcher

Install the `claudia` CLI launcher to open the app from any directory:

```bash
./install.sh
```

Or manually:

```bash
cp claudia ~/.local/bin/
chmod +x ~/.local/bin/claudia
```

Then from any project directory:

```bash
cd ~/Code/repos/my-project
claudia
```

This opens Claudia with that directory as the working directory, allowing Claude to pick up:
- Project-specific `.claude/settings.json`
- Project-specific MCP servers
- Project-specific skills and plugins

Multiple instances can run simultaneously (`-n` flag), each in their own project.

### Startup Branding (Optional)

A retro-style branding component is available but currently disabled. To enable:

1. Uncomment the import in `src/App.tsx`:
   ```tsx
   import StartupSplash from "./components/StartupSplash";
   ```

2. Add the `header` prop to MessageList:
   ```tsx
   <MessageList
     ...
     header={<StartupSplash workingDir={session.launchDir() || session.workingDir()} />}
   />
   ```

Features:
- Pixel art Claudia logo
- ASCII block-style "CLAUDIA" text in cyan
- Scrolls with message content (not fixed)

### Testing

The project has comprehensive tests for both Rust backend and TypeScript frontend:

```bash
# Run all tests (Rust + TypeScript)
npm run test:all

# Run TypeScript tests only
npm run test:run

# Run Rust tests only
npm run test:rust

# Run TypeScript tests in watch mode (development)
npm test
```

**Test Coverage:**

| Component | Tests | Focus |
|-----------|-------|-------|
| `claude_process.rs` | 25 | Bridge message parsing for all 15 event types |
| `events.rs` | 7 | serde serialization with `#[serde(tag)]` |
| `config.rs` | 6 | Tilde expansion, serde defaults, paths |
| `streaming.rs` | 4 | Binary resolution, program paths |
| `context-utils.ts` | 14 | Token thresholds, formatting |
| `mode-utils.ts` | 17 | Mode cycling, validation |

Tests run automatically on push/PR via GitHub Actions (`.github/workflows/test.yml`).

## Lessons Learned

### 1. Always Rebuild After Code Changes
The Tauri app bundles compiled Rust code. Changes to `*.rs` files require a full rebuild:
```bash
npm run tauri build
```
Simply restarting the app will run OLD code. This caused hours of debugging where fixes appeared not to work.

### 2. Event Order Matters
Events must be processed in order. The `tool_result` event must update the correct tool block (matched by `tool_use_id`), not just "the last tool". Multiple tools can be pending simultaneously.

### 3. SolidJS Reactivity Requires New Objects
SolidJS uses referential equality for reactivity. Mutating an existing object won't trigger re-renders:
```javascript
// BAD - won't trigger update
tool.result = newResult;

// GOOD - creates new object, triggers update
setTools(prev => prev.map(t =>
  t.id === targetId ? { ...t, result: newResult } : t
));
```

### 4. Timeout Handling for Server-Side Tools
Server-side tools (WebSearch, WebFetch) can take 10+ seconds. The Rust event loop tracks a `tool_pending` state to use extended timeouts:
```rust
let current_timeout = if tool_pending { 5000 } else if got_first_content { 2000 } else { 500 };
let current_max_idle = if tool_pending { 24 } else if got_first_content { 3 } else { 60 };
```

### 5. Debug Logging is Essential
Three log files help diagnose issues:
- `/tmp/claude-bridge-debug.log` - Bridge event flow
- `/tmp/claude-rust-debug.log` - Rust reader parsing
- `/tmp/claude-commands-debug.log` - Command handling and timeouts

### 6. Event Draining Prevents Message Corruption
Stale events from previous responses can corrupt the next response. The Rust backend drains any pending events before sending a new message:
```rust
loop {
    match timeout(Duration::from_millis(10), process.recv_event()).await {
        Ok(Some(event)) => { /* drain */ }
        _ => break,
    }
}
```

### 7. Token Counting is Tricky with Prompt Caching
Anthropic's caching changes how tokens are reported. A common mistake:

```javascript
// WRONG - input_tokens alone can be tiny (~10) when caching is active
const context = usage.input_tokens;

// CORRECT - must include all cache components
const context = usage.input_tokens +
                usage.cache_read_input_tokens +
                usage.cache_creation_input_tokens;
```

The `cache_creation_input_tokens` represents tokens being cached for the FIRST time—they're in the context but not yet cached. On subsequent requests, they move to `cache_read`.

### 8. Multiple Events Can Update the Same State
Different events (`context_update` vs `result`) can try to update the same state with different values. Use a **single source of truth**:
- `context_update` (from `message_start`) → Sets input context
- `result` → Only ADDS output tokens

Don't let `result`'s `input_tokens` overwrite context—it has different semantics (CLI aggregates differently than raw API).

### 9. SolidJS Show Components Need Stable Conditions
Using `<Show when={value}>` with values that can be 0 or undefined causes flickering:

```jsx
// BAD - flickers when totalContext is 0
<Show when={sessionInfo().totalContext}>

// GOOD - stable condition
<Show when={sessionActive()}>
  {sessionInfo().totalContext ? `${Math.round(sessionInfo().totalContext / 1000)}k` : '—'}
</Show>
```

### 10. macOS Launch Services Doesn't Include User PATH
When the app is launched from Finder or `open` command (vs running from terminal), macOS Launch Services spawns it with a minimal PATH that doesn't include:
- `~/.local/bin` (pipx, uv tools)
- `~/.nvm/versions/node/*/bin` (nvm-managed Node)
- `~/.bun/bin` (Bun)
- Homebrew paths (sometimes)

**Solution**: The streaming module (`streaming.rs`) manually searches common binary locations:
```rust
fn find_binary(name: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".local/bin").join(name),
        home.join(format!(".{}-repo/{}", name, name)), // e.g., ~/.ccms-repo/ccms
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
        PathBuf::from("/usr/bin").join(name),
    ];
    // Also searches nvm directories for node-based tools
}
```

### 11. Tool Results Must Be Visible During Loading
Tool results that show progress (like sync output) need special handling. Watch out for **short-circuit evaluation** with empty strings:

```jsx
// BAD - empty string "" is falsy, so isLoading check never runs!
<Show when={props.result && (expanded() || props.isLoading)}>

// GOOD - check isLoading first to show container even when result is empty
<Show when={props.isLoading || (expanded() && props.result)}>
```

When `result` starts as `""` (empty string), the condition `"" && anything` short-circuits to `""` (falsy), hiding the loading state. The fix prioritizes `isLoading` so the result container shows immediately, allowing streaming output to appear as it arrives.

## File Structure

```
claudia/
├── src/                      # Frontend (SolidJS)
│   ├── App.tsx              # Main app, event handling
│   ├── App.css              # Styles
│   ├── __tests__/           # TypeScript tests
│   │   ├── setup.ts         # Tauri API mocks
│   │   ├── context-utils.test.ts
│   │   └── mode-utils.test.ts
│   ├── assets/
│   │   └── claudia-logo.jpg # Pixel art branding image
│   ├── components/
│   │   ├── MessageList.tsx  # Message rendering (supports header prop)
│   │   ├── CommandInput.tsx # Input with type-ahead
│   │   ├── StartupSplash.tsx # Retro ASCII branding (disabled)
│   │   └── ToolResult.tsx   # Collapsible tool results
│   └── lib/
│       ├── tauri.ts         # Tauri IPC bindings + streaming command API
│       ├── context-utils.ts # Token tracking utilities (pure functions)
│       └── mode-utils.ts    # Mode cycling utilities (pure functions)
├── src-tauri/               # Backend (Rust)
│   ├── src/
│   │   ├── main.rs          # App entry
│   │   ├── commands.rs      # Tauri commands
│   │   ├── claude_process.rs # CLI process management (+ tests)
│   │   ├── events.rs        # Event type definitions (+ tests)
│   │   ├── config.rs        # Config management (+ tests)
│   │   ├── streaming.rs     # Streaming command runner (+ tests)
│   │   └── sync.rs          # CCMS sync integration
│   └── tauri.conf.json      # Tauri config
├── .github/workflows/       # CI/CD
│   └── test.yml             # Runs Rust + TS tests on push/PR
├── vitest.config.ts         # Vitest configuration
└── sdk-bridge-v2.mjs        # Node.js bridge script
```

## Maintaining Documentation

This documentation is a living artifact. **Update it as you work:**

### When to Update

1. **After fixing a bug** — Add the root cause and solution to "Lessons Learned" (README) or "Common Issues" (ARCHITECTURE)
2. **After adding a feature** — Update the architecture diagrams, file structure, and event types
3. **After discovering a gotcha** — Platform quirks, framework behavior, API semantics
4. **After refactoring** — Update file descriptions and data flow diagrams

### What to Document

- **Root causes**, not just symptoms — Future you needs to understand *why*
- **Code patterns** with good/bad examples — Makes the lesson actionable
- **Platform-specific issues** — macOS, Tauri, SolidJS quirks won't be obvious later
- **Decisions and trade-offs** — Why this approach vs alternatives

### Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | Quick start, architecture overview, lessons learned |
| [`docs/architecture.md`](docs/architecture.md) | Deep dive: data flow, event types, state management |
| [`docs/streaming.md`](docs/streaming.md) | Streaming command runner (reusable pattern) |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common issues & solutions, debugging |

### For AI Assistants

When working on this codebase:
1. Read `README.md` and relevant `docs/` files before making significant changes
2. After solving a non-trivial bug, add it to "Lessons Learned" here or [`docs/troubleshooting.md`](docs/troubleshooting.md)
3. After adding new modules/features, update the file structure and [`docs/architecture.md`](docs/architecture.md)
4. Correct any documentation that becomes outdated due to your changes

## License

MIT
