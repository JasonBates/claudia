# Testing Plan: Maximum Coverage Benefit

This document prioritizes tests by impact-to-effort ratio. Each tier builds on the previous.

## Current State

| Category | Coverage | Notes |
|----------|----------|-------|
| Rust backend | ✅ 75 tests | Timeouts, events, streaming, sync |
| Utility modules | ✅ 116 tests | Pure functions, easy to test |
| Custom hooks | ❌ 0 tests | **Highest priority** - business logic |
| Components | ❌ 0 tests | Lower priority - mostly rendering |

## Tier 1: Hook Tests (Highest Impact)

These tests validate the core business logic extracted in Phase 6. Each hook is testable in isolation with minimal mocking.

### 1.1 `useSession.test.ts` (~8 tests)

**Why**: Session lifecycle is critical path. Failures here break the entire app.

```typescript
describe("useSession", () => {
  // Happy path
  it("should initialize with inactive session");
  it("should set sessionActive=true after successful startSession");
  it("should set launchDir and workingDir on success");

  // Error handling
  it("should set sessionError on failure");
  it("should throw error for caller to handle");
  it("should timeout after 15 seconds");

  // State management
  it("should allow external setSessionInfo updates");
  it("should preserve sessionInfo across re-renders");
});
```

**Mocks needed**: `startSession`, `getLaunchDir` from `../lib/tauri`

---

### 1.2 `useStreamingMessages.test.ts` (~15 tests)

**Why**: Most complex hook. Message streaming bugs are visible and frustrating.

```typescript
describe("useStreamingMessages", () => {
  // Initialization
  it("should start with empty messages array");
  it("should start with isLoading=false");

  // Message management
  it("should add messages via setMessages");
  it("should generate unique IDs");

  // Streaming state
  it("should reset streaming state with resetStreamingState");
  it("should accumulate streamingContent");
  it("should track streamingBlocks in order");

  // Tool handling
  it("should add tool to currentToolUses on tool_start");
  it("should update tool result by ID");
  it("should handle parallel tools correctly");

  // Finish callback
  it("should call onFinish callback when finishStreaming called");
  it("should move streaming content to messages on finish");
  it("should preserve contentBlocks order on finish");

  // Thinking
  it("should toggle showThinking state");
  it("should accumulate streamingThinking content");
});
```

**Mocks needed**: None (pure state management)

---

### 1.3 `usePlanningMode.test.ts` (~10 tests)

**Why**: Plan mode is a distinct workflow. Bugs here confuse users about app state.

```typescript
describe("usePlanningMode", () => {
  // Initialization
  it("should start with isPlanning=false");
  it("should start with showPlanApproval=false");

  // Plan approval flow
  it("should call submitMessage('go') on approve");
  it("should hide approval modal after approve");
  it("should exit planning mode after approve");

  // Plan rejection flow
  it("should call submitMessage with changes request on reject");
  it("should hide approval modal after reject");
  it("should stay in planning mode after reject");

  // Plan cancellation
  it("should call submitMessage('reject') on cancel");
  it("should exit planning mode on cancel");

  // State updates
  it("should allow external setPlanFilePath updates");
});
```

**Mocks needed**: `submitMessage` callback (injected)

---

### 1.4 `usePermissions.test.ts` (~12 tests)

**Why**: Permission flow involves polling and auto-accept logic. Subtle bugs cause stuck states.

```typescript
describe("usePermissions", () => {
  // Initialization
  it("should start with null pendingPermission");

  // Polling
  it("should start polling on startPolling()");
  it("should stop polling on stopPolling()");
  it("should call pollPermissionRequest on interval");
  it("should set pendingPermission when request found");

  // Auto-accept mode
  it("should auto-allow when mode is 'auto-accept'");
  it("should NOT auto-allow when mode is 'normal'");
  it("should NOT auto-allow when mode is 'plan'");

  // Allow handler
  it("should call respondToPermission with allow=true on allow");
  it("should clear pendingPermission after allow");

  // Deny handler
  it("should call respondToPermission with allow=false on deny");
  it("should clear pendingPermission after deny");
});
```

**Mocks needed**: `pollPermissionRequest`, `respondToPermission` from `../lib/tauri`

---

### 1.5 `useTodoPanel.test.ts` (~8 tests)

**Why**: Auto-hide timer logic is tricky. Wrong timing = flickering UI.

```typescript
describe("useTodoPanel", () => {
  // Initialization
  it("should start with showTodoPanel=false");
  it("should start with empty todos array");

  // Show/hide
  it("should show panel when todos added");
  it("should start hide timer on startHideTimer()");
  it("should set hiding=true during animation");
  it("should set showTodoPanel=false after delay");

  // Timer management
  it("should cancel previous timer when new one starts");
  it("should not hide if new todos added during timer");
});
```

**Mocks needed**: `setTimeout` (via vi.useFakeTimers)

---

### 1.6 `useQuestionPanel.test.ts` (~8 tests)

**Why**: Question answering flow affects Claude's responses. Wrong answers = wrong behavior.

```typescript
describe("useQuestionPanel", () => {
  // Initialization
  it("should start with empty pendingQuestions");
  it("should start with showQuestionPanel=false");

  // Question handling
  it("should show panel when questions added");
  it("should format answers as JSON string");
  it("should call submitMessage with formatted answers");
  it("should hide panel after answer submitted");
  it("should call focusInput after answer");

  // Multi-question
  it("should handle multiple questions in one panel");
});
```

**Mocks needed**: `submitMessage`, `focusInput` callbacks (injected)

---

## Tier 2: Integration Tests (Medium Impact)

### 2.1 Event Handler Integration (~5 tests)

Test that events flow correctly from handler to hooks:

```typescript
describe("event handler integration", () => {
  it("should update session info on context_update event");
  it("should add tool to streaming on tool_start event");
  it("should update tool result on tool_result event");
  it("should finish streaming on done event");
  it("should handle parallel tool events correctly");
});
```

---

## Tier 3: Component Tests (Lower Priority)

Components are mostly rendering logic. Test if:
- They have complex conditional rendering
- They have user interaction handlers
- They've had bugs before

### Candidates

| Component | Complexity | Bug History | Priority |
|-----------|------------|-------------|----------|
| `ToolResult` | Medium (expand/collapse, loading states) | Yes (short-circuit bug) | Medium |
| `CommandInput` | Low (controlled input, mode badge) | No | Low |
| `PermissionDialog` | Low (buttons, display) | No | Low |
| `MessageList` | High (streaming, blocks) | No | Medium |

---

## Implementation Order

1. **Quick wins first**: `usePlanningMode`, `useQuestionPanel` (simple, ~30 min each)
2. **Critical path**: `useSession` (session startup is critical)
3. **Complex logic**: `usePermissions` (polling, auto-accept)
4. **High complexity**: `useStreamingMessages` (most state, most tests)
5. **Timer logic**: `useTodoPanel` (requires fake timers)

---

## Estimated Effort

| Hook | Tests | Time Estimate |
|------|-------|---------------|
| `usePlanningMode` | 10 | 30 min |
| `useQuestionPanel` | 8 | 30 min |
| `useSession` | 8 | 45 min |
| `usePermissions` | 12 | 1 hour |
| `useStreamingMessages` | 15 | 1.5 hours |
| `useTodoPanel` | 8 | 45 min |
| **Total** | **61** | **~5 hours** |

---

## Test File Template

```typescript
import { createRoot, onCleanup } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMyHook } from "../hooks/useMyHook";

// Mock external dependencies
vi.mock("../lib/tauri", () => ({
  someFunction: vi.fn(),
}));

describe("useMyHook", () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    dispose?.();
  });

  it("should do something", () => {
    let hook: ReturnType<typeof useMyHook>;

    createRoot((d) => {
      dispose = d;
      hook = useMyHook({ ...options });
    });

    expect(hook!.someSignal()).toBe(expectedValue);
  });
});
```

---

## Running Specific Tests

```bash
# Run a specific test file
npm run test -- src/__tests__/useSession.test.ts

# Run tests matching a pattern
npm run test -- --grep "useSession"

# Run with verbose output
npm run test -- --reporter=verbose
```
