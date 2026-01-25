# CT (Claude Terminal)

A native macOS desktop app that wraps Claude Code CLI, providing a streamlined terminal-like interface for interacting with Claude.

## Features

- **Native macOS app** - Built with Tauri + SolidJS for fast, lightweight performance
- **Real-time streaming** - Text and tool outputs stream as they're generated
- **Tool visualization** - Collapsible tool use blocks with syntax-highlighted results
- **Type-ahead input** - Continue typing while waiting for responses
- **Automatic permissions** - Uses `--dangerously-skip-permissions` for uninterrupted workflow
- **MCP integration** - Loads MCP servers from your global `~/.claude/` config

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CT.app (Tauri)                           │
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
│                     └─ --dangerously-skip-permissions           │
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
| `result` | Final response metadata (tokens, cost, duration) |
| `done` | Response complete |

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
cp -R src-tauri/target/release/bundle/macos/CT.app /Applications/
```

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

## File Structure

```
claude-terminal/
├── src/                      # Frontend (SolidJS)
│   ├── App.tsx              # Main app, event handling
│   ├── App.css              # Styles
│   ├── components/
│   │   ├── MessageList.tsx  # Message rendering
│   │   ├── CommandInput.tsx # Input with type-ahead
│   │   └── ToolBlock.tsx    # Collapsible tool results
│   └── lib/
│       └── tauri.ts         # Tauri IPC bindings
├── src-tauri/               # Backend (Rust)
│   ├── src/
│   │   ├── main.rs          # App entry
│   │   ├── commands.rs      # Tauri commands
│   │   ├── claude_process.rs # CLI process management
│   │   └── events.rs        # Event type definitions
│   └── tauri.conf.json      # Tauri config
└── sdk-bridge-v2.mjs        # Node.js bridge script
```

## License

MIT
