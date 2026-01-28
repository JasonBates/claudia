# Architecture

A Tauri desktop application that wraps the Claude Code CLI, providing a native GUI for interacting with Claude.

## Technology Stack

- **Frontend**: SolidJS + TypeScript + Vite
- **Backend**: Rust (Tauri 2.x)
- **CLI**: Claude Code CLI (`claude` command)
- **IPC**: Node.js bridge process + MCP server for permissions

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri App                                │
│  ┌─────────────────────┐    ┌─────────────────────────────┐    │
│  │   SolidJS Frontend  │◄──►│      Rust Backend           │    │
│  │   (src/)            │    │      (src-tauri/)           │    │
│  │                     │    │                             │    │
│  │  - App.tsx          │    │  - commands.rs              │    │
│  │  - MessageList      │    │  - claude_process.rs        │    │
│  │  - ToolResult       │    │  - events.rs                │    │
│  │  - PermissionDialog │    │                             │    │
│  └─────────────────────┘    └──────────────┬──────────────┘    │
│                                            │                    │
└────────────────────────────────────────────┼────────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────┐
                              │   Node.js Bridge         │
                              │   (sdk-bridge-v2.mjs)    │
                              │                          │
                              │   - Spawns Claude CLI    │
                              │   - Parses JSON stream   │
                              │   - Emits typed events   │
                              └────────────┬─────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
        ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
        │   Claude CLI      │  │  Permission MCP   │  │   Other MCP       │
        │                   │  │  Server           │  │   Servers         │
        │   claude --input  │  │                   │  │   (iching, etc)   │
        │   -format stream  │  │  permission-mcp-  │  │                   │
        │   -json           │  │  server.mjs       │  │                   │
        └───────────────────┘  └───────────────────┘  └───────────────────┘
```

## Developer Notes / Gotchas

### Field Name Casing Convention Mismatch ⚠️

**This codebase has inconsistent naming conventions across layers. Watch out!**

| Layer | Convention | Example |
|-------|------------|---------|
| **Bridge (JS)** | camelCase | `requestId`, `toolName`, `toolInput` |
| **Rust backend** | snake_case | `request_id`, `tool_name`, `tool_input` |
| **TypeScript types** | Mixed | Some use `request_id`, some use `requestId` |

**Common pitfall:** When the bridge sends an event like `permission_request`, it uses camelCase (`requestId`), but TypeScript code may expect snake_case (`event.request_id`). This causes silent failures where values are `undefined`.

**Best practice:** Always check both conventions when accessing event fields:
```typescript
const requestId = event.requestId || event.request_id || "";
const toolName = event.toolName || event.tool_name || "unknown";
```

This inconsistency should eventually be unified, but for now be defensive.

## Data Flow

### 1. User Sends Message

```
User types message
       │
       ▼
CommandInput.tsx (onSubmit)
       │
       ▼
App.tsx handleSubmit()
       │
       ▼
sendMessage() [src/lib/tauri.ts]
       │
       ▼
Tauri invoke("send_message") ──► Rust send_message command
                                        │
                                        ▼
                                 ClaudeProcess.send_message()
                                        │
                                        ▼
                                 Bridge stdin (JSON)
                                        │
                                        ▼
                                 Claude CLI
```

### 2. Claude Responds (Streaming)

```
Claude CLI stdout
       │
       ▼
Bridge parses JSON lines
       │
       ▼
Bridge emits events (text_delta, tool_start, etc.)
       │
       ▼
Rust ClaudeProcess.recv_event()
       │
       ▼
Tauri Channel.send(ClaudeEvent)
       │
       ▼
Frontend onmessage callback
       │
       ▼
App.tsx handleEvent()
       │
       ▼
Update signals (streamingContent, streamingBlocks, etc.)
       │
       ▼
SolidJS reactivity updates UI
```

### 3. Permission Flow

When Claude needs to use a tool that requires permission:

```
Claude CLI calls tool
       │
       ▼
--permission-prompt-tool flag routes to MCP server
       │
       ▼
Permission MCP Server (permission-mcp-server.mjs)
       │
       ▼
Writes request to temp file:
/tmp/claudia-permission-request.json
       │
       ▼
Rust polls file (poll_permission_request command)
       │
       ▼
Frontend receives request, shows PermissionDialog
       │
       ▼
User clicks Allow/Deny
       │
       ▼
Frontend calls respondToPermission()
       │
       ▼
Rust writes response to temp file:
/tmp/claudia-permission-response.json
       │
       ▼
MCP Server reads response, returns to Claude CLI
       │
       ▼
Claude continues (or aborts if denied)
```

## Key Files

### Frontend (src/)

| File | Purpose |
|------|---------|
| `App.tsx` | Main component, composition layer, event handler wiring |
| `lib/tauri.ts` | Tauri command invocations and type definitions |
| `lib/event-handlers.ts` | Event processing logic extracted from App.tsx |
| `components/MessageList.tsx` | Renders conversation messages |
| `components/ToolResult.tsx` | Renders tool invocations (collapsed/expanded) |
| `components/PermissionDialog.tsx` | Allow/Deny dialog for tool permissions |
| `components/CommandInput.tsx` | User input with mode switching |

### Custom Hooks (src/hooks/)

| Hook | Purpose |
|------|---------|
| `useSession` | Session lifecycle (start, stop, directories, session info) |
| `useStreamingMessages` | Message state, streaming content, tool uses, thinking |
| `usePlanningMode` | Plan mode workflow (approve, reject, cancel) |
| `usePermissions` | Permission polling and allow/deny handlers |
| `useTodoPanel` | Todo panel state with auto-hide timer |
| `useQuestionPanel` | AskUserQuestion panel state and answer handling |
| `useLocalCommands` | Local slash commands (/clear, /sync) and keyboard shortcuts (Alt+T) |

### Backend (src-tauri/src/)

| File | Purpose |
|------|---------|
| `main.rs` | Tauri app initialization |
| `commands.rs` | Tauri command handlers (start_session, send_message, run_streaming_command, etc.) |
| `claude_process.rs` | Manages the bridge subprocess, event parsing |
| `events.rs` | ClaudeEvent + CommandEvent enum definitions |
| `config.rs` | App configuration |
| `streaming.rs` | General-purpose streaming command runner with binary finder |
| `sync.rs` | CCMS sync integration (pull/push/status) |

### Bridge Layer

| File | Purpose |
|------|---------|
| `sdk-bridge-v2.mjs` | Node.js process that spawns Claude CLI and translates events |
| `permission-mcp-server.mjs` | MCP server for handling permission requests |

## Event Types

Events flow from Claude CLI through the bridge to the frontend:

| Event | Description |
|-------|-------------|
| `status` | Bridge status messages (including compaction notifications) |
| `ready` | Session initialized with model info |
| `processing` | User message being processed |
| `text_delta` | Streaming text chunk |
| `thinking_start` | Extended thinking block begins |
| `thinking_delta` | Streaming thinking chunk |
| `tool_start` | Tool invocation beginning |
| `tool_input` | Streaming tool input JSON |
| `tool_pending` | Tool about to execute |
| `tool_result` | Tool execution completed |
| `block_end` | Content block finished |
| `context_update` | Real-time token usage (from message_start) |
| `result` | Final response with metadata (cost, tokens, etc.) |
| `done` | Response complete |

## Context Window & Token Tracking

The app tracks context window usage in real-time via a multi-stage pipeline.

### Anthropic API Token Semantics

Understanding how Anthropic reports tokens is critical:

| Field | Meaning |
|-------|---------|
| `input_tokens` | Tokens AFTER the last cache breakpoint (can be very small with caching) |
| `cache_read_input_tokens` | Tokens served FROM cache (already cached content) |
| `cache_creation_input_tokens` | Tokens being written TO cache (first-time caching) |
| `output_tokens` | Generated response tokens (includes thinking tokens) |

### Correct Context Formula

```
context_used = input_tokens + cache_read + cache_creation + output_tokens
```

All tokens count toward the 200k context limit. **Caching saves cost, NOT context space.**

### Token Update Flow

```
User sends message
       │
       ▼
[message_start event fires - START of response]
       │
       ▼
Bridge extracts usage from event.message.usage
       │
       ▼
Bridge calculates: input + cache_read + cache_creation
       │
       ▼
Bridge sends context_update event
       │
       ▼
Rust parses and forwards to frontend
       │
       ▼
Frontend sets totalContext (replaces, doesn't accumulate)
       │
       ▼
Display shows: "26k"
       │
       ▼
[Response streams...]
       │
       ▼
[result event fires - END of response]
       │
       ▼
Frontend ADDS output_tokens to totalContext
       │
       ▼
Display shows: "27k"
       │
       ▼
[Next message's message_start includes previous output]
```

### Why Replace Instead of Accumulate?

Each `message_start` reports the TOTAL tokens for that API call, including:
- System prompt
- All previous conversation turns
- New user message

So we **replace** `totalContext` with the new value (not add to it). Output tokens are added separately because they're not included in `message_start`.

### Context Thresholds

| Threshold | Level | Behavior |
|-----------|-------|----------|
| < 60% | OK | Normal display |
| 60%+ | Warning | Yellow indicator, suggest compaction |
| 75%+ | Critical | Red indicator, auto-compact imminent |

The CLI auto-compacts around 75% to preserve working memory for reasoning.

## State Management

The frontend uses SolidJS signals organized into custom hooks for modularity and testability.

### Hook Architecture

State is distributed across specialized hooks, with `App.tsx` acting as the composition layer:

```typescript
// App.tsx wires hooks together via dependency injection
const session = useSession();
const streaming = useStreamingMessages({ onFinish: () => todoPanel.startHideTimer() });
const planning = usePlanningMode({ submitMessage: handleSubmit });
const permissions = usePermissions({ owner, getCurrentMode: currentMode });
const todoPanel = useTodoPanel({ owner });
const questionPanel = useQuestionPanel({ submitMessage: handleSubmit, focusInput: () => ... });
```

### State by Hook

| Hook | State Signals | Purpose |
|------|---------------|---------|
| `useSession` | `sessionActive`, `launchDir`, `workingDir`, `sessionInfo` | Connection and session lifecycle |
| `useStreamingMessages` | `messages`, `streamingContent`, `streamingBlocks`, `currentToolUses`, `isLoading`, `error`, `streamingThinking`, `showThinking` | Message display and streaming |
| `usePlanningMode` | `isPlanning`, `planFilePath`, `showPlanApproval`, `planContent` | Plan mode workflow |
| `usePermissions` | `pendingPermission` | Permission request handling |
| `useTodoPanel` | `currentTodos`, `showTodoPanel`, `todoPanelHiding` | Todo panel display |
| `useQuestionPanel` | `pendingQuestions`, `showQuestionPanel` | AskUserQuestion responses |

### Dependency Injection Pattern

Hooks receive dependencies via options objects, enabling composition without circular imports:

```typescript
// Hook accepts callbacks instead of importing other hooks directly
export function usePlanningMode(options: {
  submitMessage: (msg: string) => Promise<void>;
}) {
  // Can call submitMessage without importing App.tsx
  const handlePlanApprove = async () => {
    await options.submitMessage("go");
  };
}
```

### Reactive Context Restoration

Async callbacks (Tauri channels, intervals) run outside SolidJS tracking. Use `runWithOwner()`:

```typescript
const owner = getOwner();  // Capture in synchronous context

// Later, in async callback:
runWithOwner(owner, () => batch(() => {
  setMessages(...);  // Now tracked by SolidJS
}));
```

## ContentBlock System

To properly interleave text and tool calls in order:

```typescript
type ContentBlock =
  | { type: "text"; content: string }
  | { type: "tool_use"; tool: ToolUse };
```

As events arrive:
- `text_delta` → Append to last text block or create new one
- `tool_start` → Create new tool_use block
- When streaming finishes → `contentBlocks` saved to message

## Permission System

Uses Claude CLI's `--permission-prompt-tool` flag:

1. CLI spawned with: `--permission-prompt-tool mcp__permission__permission_prompt`
2. MCP config passed via `--mcp-config` pointing to our permission server
3. When permission needed, CLI calls the MCP tool
4. MCP server writes request to file, polls for response
5. Frontend polls for requests, shows dialog, writes response
6. MCP server returns `{behavior: "allow", updatedInput: {...}}` or `{behavior: "deny", message: "..."}`

**Important**: The `updatedInput` field is required for allow responses.

## Benefits of the Hooks Architecture

The refactoring from monolithic App.tsx (650+ lines) to custom hooks provides concrete benefits:

### Adding New Features

New features follow a simple 3-step pattern:

1. **Create a focused hook** in `src/hooks/useNewFeature.ts`
2. **Wire it into App.tsx** (5-10 lines in the composition layer)
3. **Connect to event handler** if it needs to respond to Claude events

Example: Adding a "conversation bookmarks" feature would mean creating `useBookmarks.ts` with bookmark state and handlers, without needing to understand permissions, planning mode, or streaming logic.

### Testing in Isolation

Each hook can be tested independently with minimal mocking:

```typescript
// Test useSession without loading the entire app
test("startSession sets sessionActive on success", async () => {
  vi.mock("../lib/tauri", () => ({
    startSession: vi.fn().mockResolvedValue("/path/to/dir"),
    getLaunchDir: vi.fn().mockResolvedValue("/launch"),
  }));

  let session: ReturnType<typeof useSession>;
  createRoot((dispose) => {
    session = useSession();
    onCleanup(dispose);
  });

  await session.startSession();
  expect(session.sessionActive()).toBe(true);
});
```

| Aspect | Before (Monolithic) | After (Hooks) |
|--------|---------------------|---------------|
| Test scope | Entire app | Single hook |
| Mocking complexity | 20+ dependencies | 2-3 dependencies |
| Test isolation | Impossible | Natural |
| Debugging failures | "Something in App.tsx" | "usePermissions line 47" |

### Dependency Injection

Hooks receive dependencies via options objects, enabling flexibility:

```typescript
// Hooks don't import each other - they receive callbacks
const planning = usePlanningMode({
  submitMessage: async (msg) => handleSubmit(msg),  // Easily mocked
});
```

Benefits:
- Swap implementations for testing
- No circular import issues
- Clear contracts between modules

### Bug Isolation

Symptoms map directly to files:

| Symptom | Where to Look |
|---------|---------------|
| Session won't start | `useSession.ts` |
| Permissions not appearing | `usePermissions.ts` |
| Todo panel won't hide | `useTodoPanel.ts` |
| Streaming content stuck | `useStreamingMessages.ts` |
| Plan approval broken | `usePlanningMode.ts` |

### Screaming Architecture

The folder structure reveals the app's features:

```
src/hooks/
  useSession.ts        → "This app has sessions"
  usePermissions.ts    → "This app handles permissions"
  usePlanningMode.ts   → "This app has a planning mode"
  useTodoPanel.ts      → "This app shows todos"
```

New developers understand the app's capabilities by listing the hooks directory.

## Testing

### Current Test Coverage

| Layer | Tests | Files |
|-------|-------|-------|
| **Rust backend** | 75 tests | events, streaming, sync, timeouts, response_state |
| **Frontend utilities** | 116 tests | context-utils, event-handlers, json-streamer, mode-utils, solid-utils |
| **Frontend hooks** | ⚠️ 0 tests | useSession, useStreamingMessages, usePlanningMode, usePermissions, useTodoPanel, useQuestionPanel, useLocalCommands |
| **Components** | ⚠️ 0 tests | MessageList, ToolResult, PermissionDialog, CommandInput |

### Running Tests

```bash
# Run all tests
npm run test:all

# Frontend only
npm run test:run

# Rust only
npm run test:rust

# Watch mode (during development)
npm run test
```

### Test Architecture

Tests are in `src/__tests__/` with Vitest:

```
src/__tests__/
  setup.ts              # Global mocks (Tauri APIs, matchMedia)
  context-utils.test.ts # Context threshold calculations
  event-handlers.test.ts # Event processing logic (37 tests)
  json-streamer.test.ts  # JSON streaming parser (32 tests)
  mode-utils.test.ts     # Mode cycling logic
  solid-utils.test.ts    # Reactive context helpers
```

### Testing Hooks

Hooks require a SolidJS reactive root. Use this pattern:

```typescript
import { createRoot } from "solid-js";
import { vi, describe, it, expect } from "vitest";

describe("useMyHook", () => {
  it("should do something", async () => {
    // Mock external dependencies
    vi.mock("../lib/tauri", () => ({ ... }));

    let hook: ReturnType<typeof useMyHook>;

    // Create reactive root (required for signals)
    createRoot((dispose) => {
      hook = useMyHook({ ...options });
      // dispose() will be called when test ends
    });

    // Test the hook
    await hook.someAction();
    expect(hook.someSignal()).toBe(expectedValue);
  });
});
```

### Recommended Test Priorities

See [testing-plan.md](testing-plan.md) for detailed test plan with maximum coverage benefit.

## Building

```bash
# Install dependencies
npm install

# Development
npm run tauri dev

# Production build
npm run build
npx tauri build
```

## Keeping This Document Updated

This architecture document should evolve with the codebase. When making changes:

1. **New modules** → Add to "Key Files" tables with purpose description
2. **New event types** → Add to "Event Types" section with description
3. **New data flows** → Update or add flow diagrams
4. **Bug fixes with architectural insight** → Add to [troubleshooting.md](troubleshooting.md)
5. **New integrations** → Create new doc or add section (like [streaming.md](streaming.md))

See main [README.md](../README.md) "Maintaining Documentation" section for full guidelines.
