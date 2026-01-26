# Troubleshooting

Common issues and their solutions, plus debugging techniques.

## Log Files

Debug logs are written to temp files:

| Log File | Contents |
|----------|----------|
| `/tmp/claude-bridge-debug.log` | Bridge I/O, event emission |
| `/tmp/claude-permission-mcp.log` | Permission server activity |
| `/tmp/claude-commands-debug.log` | Rust command execution, timeouts |

### Frontend Console

Open DevTools (Cmd+Option+I in dev mode) to see:
- `[EVENT]` - Event receipt from backend
- `[FINISH]` - Response finalization
- `[PERMISSION]` - Permission flow
- `[SYNC]` - Sync command progress
- `[TAURI CHANNEL]` - Channel message receipt

## Common Issues

### Tool Results Not Showing During Progress

**Symptom**: Tool results (like sync output) appear only after completion, not during execution.

**Cause**: Short-circuit evaluation with empty string. When `result=""` (initial state), the condition `"" && (expanded || isLoading)` short-circuits to `""` (falsy), hiding the loading state.

**Solution**: Prioritize `isLoading` check to show container even when result is empty:

```tsx
// BAD: empty string short-circuits, isLoading never evaluated
<Show when={props.result && (expanded() || props.isLoading)}>

// GOOD: isLoading shows container, allowing streaming to populate it
<Show when={props.isLoading || (expanded() && props.result)}>
```

**File**: `src/components/ToolResult.tsx`

---

### "Failed to spawn" Errors for User-Installed Binaries

**Symptom**: Commands like `ccms`, `claude`, or node tools fail with:
```
Failed to spawn 'ccms': No such file or directory (os error 2)
```

**Cause**: macOS Launch Services doesn't include user PATH when launching apps from Finder or `open` command. Paths like `~/.local/bin`, `~/.nvm/...`, `~/.bun/bin` aren't searched.

**Solution**: The streaming module (`streaming.rs`) manually searches common binary locations. If you need to add support for a new tool location:

```rust
// In src-tauri/src/streaming.rs, find_binary()
let candidates = [
    home.join(".local/bin").join(name),
    home.join(".your-tool-dir").join(name),  // Add new location
    // ...
];
```

**File**: `src-tauri/src/streaming.rs`

---

### Sync/Command Progress Not Updating UI

**Symptom**: State updates happen (visible in console logs) but UI doesn't reflect changes until the end.

**Cause**: Tauri channel callbacks run outside SolidJS's reactive tracking context. Signal updates don't trigger re-renders.

**Solution**: Wrap callbacks with `runWithOwner()` and `batch()`:

```typescript
import { runWithOwner, batch, getOwner } from "solid-js";

const owner = getOwner();

channel.onmessage = (event) => {
  if (owner) {
    runWithOwner(owner, () => batch(() => onEvent(event)));
  } else {
    onEvent(event);
  }
};
```

**File**: `src/lib/tauri.ts`

---

### App Doesn't Connect to Backend When Launched from Finder

**Symptom**: App works fine when launched via `npm run tauri dev` but fails when opening the built `.app`.

**Cause**: Same PATH issue as above. The Node.js bridge or Claude CLI can't be found.

**Solution**: The bridge is bundled with the app and uses absolute paths. For Claude CLI, ensure it's in a standard location or update `sdk-bridge-v2.mjs` to search for it.

---

### Changes to Rust Code Don't Take Effect

**Symptom**: You modified `.rs` files but the app behaves the same as before.

**Cause**: The Tauri app bundles compiled Rust code. Restarting the app runs the OLD compiled code.

**Solution**: Always rebuild after Rust changes:
```bash
npm run tauri build
# Then relaunch the app
```

---

### Tool Results Matched to Wrong Tool

**Symptom**: Tool result appears under the wrong tool block, or updates the wrong tool.

**Cause**: Tool results are matched by `tool_use_id`. If IDs aren't being tracked correctly, results go to the wrong place.

**Solution**: Ensure `tool_use_id` from `tool_result` events matches the `id` from `tool_start`. Check `handleEvent()` in `App.tsx`:

```typescript
case "tool_result":
  // Must match by tool_use_id, not by position
  setCurrentToolUses((prev) =>
    prev.map((t) =>
      t.id === event.tool_use_id
        ? { ...t, result: event.stdout || "", isLoading: false }
        : t
    )
  );
```

**File**: `src/App.tsx`

---

### SolidJS State Updates Don't Trigger Re-render

**Symptom**: You call a setter but the UI doesn't update.

**Cause**: SolidJS uses referential equality. Mutating an existing object won't trigger updates.

**Solution**: Always create new objects:

```typescript
// BAD - mutates existing object, no re-render
tool.result = newResult;
setTools(tools);

// GOOD - creates new objects, triggers re-render
setTools(prev => prev.map(t =>
  t.id === targetId ? { ...t, result: newResult } : t
));
```

---

### Server-Side Tools (WebSearch) Timeout

**Symptom**: WebSearch or WebFetch tools fail or cause the response to hang.

**Cause**: Server-side tools execute on Anthropic's servers and can take 10+ seconds. The default timeout is too short.

**Solution**: The backend tracks `pending_tool_count` to use extended timeouts:

```rust
// In src-tauri/src/commands/messaging.rs
let current_timeout = if pending_tool_count > 0 { 5000 } else { 2000 };
let current_max_idle = if pending_tool_count > 0 { 24 } else { 3 };
```

**File**: `src-tauri/src/commands/messaging.rs`

---

### Parallel Tools Stuck at "Running..." (Only First Tool Completes)

**Symptom**: When Claude runs multiple tools in parallel (e.g., 3 Grep + 3 Glob calls), only one or two show results. The rest remain stuck showing "Running..." forever.

**Cause**: The Rust backend was using a **boolean** `tool_pending` flag instead of a **count**. When the first `tool_result` event arrived, it set `tool_pending = false`, causing the event loop to use the short timeout. Subsequent tool results arrived after "Max idle reached, sending Done".

```
Timeline (broken):
  ToolStart (grep1) → tool_pending = true
  ToolStart (grep2) → tool_pending = true (already true)
  ToolStart (glob1) → tool_pending = true (already true)
  ToolResult (grep1) → tool_pending = false  ← BUG: resets too early!
  [timeout with short interval]
  [Done sent before glob1 results arrive]
```

**Solution**: Track pending tools with a **count**, not a boolean. Increment on `ToolStart`, decrement on `ToolResult` (only for results with a `tool_use_id` to avoid duplicates):

```rust
// In src-tauri/src/commands/messaging.rs
let mut pending_tool_count: usize = 0;

// On ToolStart
if matches!(event, ClaudeEvent::ToolStart { .. }) {
    pending_tool_count += 1;
}

// On ToolResult (only decrement for results with ID)
if let ClaudeEvent::ToolResult { ref tool_use_id, .. } = event {
    if tool_use_id.is_some() && pending_tool_count > 0 {
        pending_tool_count -= 1;
    }
}

// Additionally, text after tools means all tools completed
if matches!(event, ClaudeEvent::TextDelta { .. }) && pending_tool_count > 0 {
    pending_tool_count = 0;
}
```

**File**: `src-tauri/src/commands/messaging.rs`

**Lesson**: When tracking multiple concurrent operations, always use a count rather than a boolean. This applies to any scenario where N events start and N events complete.

---

### Context Window Shows Wrong Value

**Symptom**: Context counter shows unexpectedly low values (like 10 tokens when context should be 30k+).

**Cause**: With prompt caching, `input_tokens` only represents tokens AFTER the last cache breakpoint. Cached tokens are in separate fields.

**Solution**: Use the full formula:
```typescript
context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

See [architecture.md](architecture.md#context-window--token-tracking) for full details.

---

## Debugging Techniques

### 1. Enable Verbose Logging

Add console logs at key points:
```typescript
console.log(`[DEBUG] Event:`, event.type, event);
console.log(`[DEBUG] State:`, currentToolUses());
```

### 2. Check Rust Logs

```bash
# View bridge logs
tail -f /tmp/claude-bridge-debug.log

# View command logs
tail -f /tmp/claude-commands-debug.log
```

### 3. Inspect Tauri DevTools

In dev mode, the app has Chrome DevTools:
- Network tab shows IPC calls
- Console shows frontend logs
- Application tab shows local storage

### 4. Test Components in Isolation

For UI issues, temporarily hardcode props:
```tsx
<ToolResult
  name="Test"
  input={{ test: "data" }}
  result="Test result"
  isLoading={true}
/>
```

### 5. Binary Debugging

Check if a binary is found:
```bash
# What the app sees (minimal PATH)
env -i HOME=$HOME /bin/bash -c 'echo $PATH'

# Manually test binary resolution
ls -la ~/.local/bin/ccms
```

## Known Limitations

### Bash Tool Output Not Streaming in Real-Time

**Symptom**: When Claude runs a Bash command, the output appears all at once after the command finishes, not line-by-line as it runs.

**Cause**: This is a fundamental limitation of Claude Code's `--print` mode with `--output-format stream-json`. The app uses this mode to receive structured JSON events, but:

- **Interactive mode** (native Claude Code terminal): Uses React/Ink with pipe data events → real-time display
- **Print mode** (our bridge): `tool_result` event contains complete output only after command finishes

The streaming in native Claude Code isn't from JSON events—it's from the React/Ink UI layer reading pipes and re-rendering. Our JSON-event-based bridge bypasses that layer entirely.

**Why we don't fix it**: Implementing Bash streaming would require intercepting tool calls, running them ourselves, and feeding results back to Claude—significant complexity for a minor use case. The app is designed for knowledge work; use native Claude Code for dev work requiring streaming Bash output.

**References**:
- GitHub Issue #4346: Live Streaming Text Output (feature request)
- GitHub Issue #2221: Added streaming in v1.0.53 for interactive mode only
- Only Bash benefits; Read, WebFetch, and other tools are buffered in both modes

---

### /clear Command Doesn't Actually Clear Context

**Symptom**: After typing `/clear`, the UI shows "context cleared" divider, but Claude still remembers the previous conversation.

**Cause**: In `--input-format stream-json` mode, the Claude CLI maintains its own internal conversation state. This cannot be cleared by:
- Changing the `session_id` in messages (CLI generates its own, ignores yours)
- Sending `/clear` as message content (treated as literal text, not a command)
- Sending control messages (protocol only supports `user` and `control` types, no reset command)

The only way to truly clear context is to **restart the CLI process**.

**Solution**: The `clearSession` Tauri command kills the bridge process and spawns a new one:

```rust
// In src-tauri/src/commands/session.rs
pub async fn clear_session(...) {
    // Kill existing process
    *process_guard = None;  // Drop triggers shutdown

    // Spawn new process
    let process = ClaudeProcess::spawn(&dir)?;
    *process_guard = Some(process);

    // Send done event immediately (don't wait for Ready)
    channel.send(ClaudeEvent::Done)?;
}
```

**Key insight**: Don't wait for the bridge's Ready event during clear—it takes several seconds for MCP servers to reconnect. The bridge will be ready by the time the user sends their next message.

**Files**:
- `src-tauri/src/commands/session.rs` - `clear_session` command
- `src/hooks/useLocalCommands.ts` - `handleClear` function
- `src/lib/tauri.ts` - `clearSession` TypeScript binding

**Lesson**: When integrating with external CLI tools in streaming mode, understand what state they maintain internally vs. what you control. Process restart is sometimes the only reliable reset mechanism.

---

## Adding New Troubleshooting Entries

When you solve a non-trivial bug:

1. Document the **symptom** (what the user sees)
2. Explain the **cause** (why it happens)
3. Provide the **solution** (how to fix it)
4. Reference the **file** (where to look)

This helps future developers (and AI assistants) avoid rediscovering the same issues.
