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

**Solution**: The backend tracks `tool_pending` state to use extended timeouts:

```rust
// In src-tauri/src/commands.rs
let current_timeout = if tool_pending { 5000 } else { 2000 };
let current_max_idle = if tool_pending { 24 } else { 3 };
```

**File**: `src-tauri/src/commands.rs`

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

## Adding New Troubleshooting Entries

When you solve a non-trivial bug:

1. Document the **symptom** (what the user sees)
2. Explain the **cause** (why it happens)
3. Provide the **solution** (how to fix it)
4. Reference the **file** (where to look)

This helps future developers (and AI assistants) avoid rediscovering the same issues.
