# Testing Plan: Claudia Test Suite

This document describes the test coverage for the Claudia project.

## Current State

| Category | Tests | Status |
|----------|-------|--------|
| Rust backend | ~75 | ✅ Complete |
| Utility modules | ~80 | ✅ Complete |
| Custom hooks | ~175 | ✅ Complete |
| UI Components | ~61 | ✅ Complete |
| **Total** | **407** | ✅ All passing |

## Test Infrastructure

### Frameworks

- **TypeScript**: Vitest with jsdom environment
- **Rust**: Native cargo test framework
- **Component Testing**: @solidjs/testing-library + @testing-library/jest-dom

### Configuration

- `vitest.config.ts` - Vitest configuration with SolidJS plugin
- `src/__tests__/setup.ts` - Global mocks for Tauri APIs and jest-dom matchers

### Running Tests

```bash
# Run all TypeScript tests
npm run test:run

# Run in watch mode
npm test

# Run Rust tests
npm run test:rust

# Run all tests (TS + Rust)
npm run test:all

# Run specific test file
npm run test -- src/__tests__/useSession.test.ts
```

---

## Test Files

### Utility Modules (`src/__tests__/`)

| File | Tests | Coverage |
|------|-------|----------|
| `context-utils.test.ts` | 14 | Token tracking, context thresholds |
| `mode-utils.test.ts` | 14 | Mode cycling (auto/plan), validation |
| `json-streamer.test.ts` | 32 | JSON accumulation, parsing, validation |
| `solid-utils.test.ts` | 16 | SolidJS utility functions |
| `event-handlers.test.ts` | 50 | Event processing, race conditions |
| `highlight.test.ts` | 7 | Syntax highlighting, HTML escaping |

### Custom Hooks (`src/__tests__/`)

| File | Tests | Coverage |
|------|-------|----------|
| `useSession.test.ts` | 22 | Session lifecycle, startup, errors |
| `useStreamingMessages.test.ts` | 44 | Message streaming, tool handling |
| `usePlanningMode.test.ts` | 24 | Plan approval workflow |
| `usePermissions.test.ts` | 23 | Permission polling, auto-accept |
| `useTodoPanel.test.ts` | 16 | Todo panel state, auto-hide timer |
| `useQuestionPanel.test.ts` | 14 | Question panel, answer submission |
| `useLocalCommands.test.ts` | 39 | Slash commands, keyboard shortcuts |
| `useSidebar.test.ts` | 27 | Sidebar toggle, session management |

### UI Components (`src/__tests__/components/`)

| File | Tests | Coverage |
|------|-------|----------|
| `CommandInput.test.tsx` | 21 | Mode display, submit, Shift+Tab, history |
| `PermissionDialog.test.tsx` | 20 | Buttons, icons, tool input formatting |
| `TodoPanel.test.tsx` | 20 | Todo list, status icons, counts, hiding |

---

## Key Test Patterns

### Testing SolidJS Hooks

```typescript
import { createRoot } from "solid-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("useMyHook", () => {
  let dispose: () => void;

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

### Testing Components

```tsx
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("MyComponent", () => {
  afterEach(() => {
    cleanup();
  });

  it("should handle click", () => {
    const onClick = vi.fn();
    render(() => <MyComponent onClick={onClick} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalled();
  });
});
```

### Mocking Tauri APIs

```typescript
vi.mock("../lib/tauri", () => ({
  someFunction: vi.fn(),
  anotherFunction: vi.fn(),
}));

import { someFunction } from "../lib/tauri";

beforeEach(() => {
  vi.mocked(someFunction).mockResolvedValue(mockResult);
});
```

### Testing with Fake Timers

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("should auto-hide after delay", async () => {
  // ... setup
  await vi.advanceTimersByTimeAsync(3000);
  expect(hook.isHiding()).toBe(true);
});
```

---

## Coverage by Feature

### Session Management
- Session startup and initialization
- Launch directory detection
- Session info updates
- Error handling and timeouts

### Message Streaming
- Streaming content accumulation
- Tool use tracking (start, input, result)
- Parallel tool execution
- Race condition handling (result before start)
- Thinking content

### Planning Mode
- Plan file detection
- Approval/rejection/cancel workflows
- Plan content loading

### Permissions
- Permission polling
- Auto-accept mode
- Allow/deny handlers
- Dialog display

### Local Commands
- Slash command dispatch (/clear, /sync, /thinking, /sidebar, /resume, /exit)
- Keyboard shortcuts (Alt+T, Alt+Q, Cmd+Shift+[, Escape)
- Error handling

### Sidebar
- Toggle/open states
- Session listing
- Session deletion
- localStorage persistence

### UI Components
- Input handling and submission
- Mode switching
- Status indicators
- Button actions

---

## Remaining Coverage Opportunities

### Medium Priority
- Additional component tests (Sidebar, PlanApprovalModal, MessageList)
- Rust tests for session parsing functions

### Lower Priority
- Integration tests for full workflows
- E2E tests with Tauri test framework
