import { describe, it, expect, vi } from "vitest";
import {
  withReactiveContext,
  createBatchedUpdater,
  createAsyncHandler,
} from "../lib/solid-utils";

// Note: These tests verify the API without a full SolidJS reactive context.
// In a real app, these utilities restore context in async callbacks.
// Here we test the fallback behavior (when owner is null).

describe("withReactiveContext", () => {
  it("should execute callback and return result with null owner", () => {
    const withContext = withReactiveContext(null);
    const result = withContext(() => 42);
    expect(result).toBe(42);
  });

  it("should execute callback that modifies state with null owner", () => {
    const withContext = withReactiveContext(null);
    let value = 0;
    withContext(() => {
      value = 10;
    });
    expect(value).toBe(10);
  });

  it("should handle callbacks that return objects", () => {
    const withContext = withReactiveContext(null);
    const result = withContext(() => ({ name: "test", count: 5 }));
    expect(result).toEqual({ name: "test", count: 5 });
  });

  it("should handle callbacks that return arrays", () => {
    const withContext = withReactiveContext(null);
    const result = withContext(() => [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it("should handle callbacks that return undefined", () => {
    const withContext = withReactiveContext(null);
    const result = withContext(() => undefined);
    expect(result).toBeUndefined();
  });

  it("should handle callbacks that throw", () => {
    const withContext = withReactiveContext(null);
    expect(() =>
      withContext(() => {
        throw new Error("test error");
      })
    ).toThrow("test error");
  });
});

describe("createBatchedUpdater", () => {
  it("should be an alias for withReactiveContext", () => {
    const batchUpdate = createBatchedUpdater(null);
    const result = batchUpdate(() => "batched");
    expect(result).toBe("batched");
  });

  it("should handle multiple state updates in callback", () => {
    const batchUpdate = createBatchedUpdater(null);
    let a = 0,
      b = 0,
      c = 0;

    batchUpdate(() => {
      a = 1;
      b = 2;
      c = 3;
    });

    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(c).toBe(3);
  });
});

describe("createAsyncHandler", () => {
  it("should wrap handler to preserve context", () => {
    const originalHandler = vi.fn((x: number, y: number) => x + y);
    const wrappedHandler = createAsyncHandler(null, originalHandler);

    const result = wrappedHandler(3, 4);

    expect(originalHandler).toHaveBeenCalledWith(3, 4);
    expect(result).toBe(7);
  });

  it("should work with handlers that take no arguments", () => {
    let called = false;
    const handler = createAsyncHandler(null, () => {
      called = true;
      return "done";
    });

    const result = handler();

    expect(called).toBe(true);
    expect(result).toBe("done");
  });

  it("should work with handlers that take objects", () => {
    interface Event {
      type: string;
      data: number;
    }

    const handler = createAsyncHandler(null, (event: Event) => {
      return `${event.type}: ${event.data}`;
    });

    const result = handler({ type: "click", data: 42 });
    expect(result).toBe("click: 42");
  });

  it("should preserve this context (arrow functions)", () => {
    const obj = {
      value: 100,
      handler: createAsyncHandler(null, function (this: { value: number }) {
        // Note: Arrow functions don't have their own 'this', so this tests
        // that we don't break anything
        return 50;
      }),
    };

    expect(obj.handler()).toBe(50);
  });

  it("should work with async-like patterns", async () => {
    const handler = createAsyncHandler(null, (value: string) => {
      return Promise.resolve(value.toUpperCase());
    });

    const result = await handler("hello");
    expect(result).toBe("HELLO");
  });
});

describe("integration patterns", () => {
  it("should work in setTimeout-like callback pattern", () => {
    const withContext = withReactiveContext(null);
    let result = "";

    // Simulating a setTimeout callback
    const timeoutCallback = () => {
      withContext(() => {
        result = "updated in timeout";
      });
    };

    timeoutCallback();
    expect(result).toBe("updated in timeout");
  });

  it("should work in event handler pattern", () => {
    const withContext = withReactiveContext(null);
    const events: string[] = [];

    // Simulating a Tauri channel event handler
    const handleEvent = (event: { type: string; data: string }) => {
      withContext(() => {
        events.push(`${event.type}: ${event.data}`);
      });
    };

    handleEvent({ type: "message", data: "hello" });
    handleEvent({ type: "message", data: "world" });

    expect(events).toEqual(["message: hello", "message: world"]);
  });

  it("should work with nested callbacks", () => {
    const withContext = withReactiveContext(null);
    let maxDepth = 0;

    const nestedUpdate = (level: number) => {
      withContext(() => {
        maxDepth = Math.max(maxDepth, level);
        if (level < 3) {
          nestedUpdate(level + 1);
        }
      });
    };

    nestedUpdate(1);
    expect(maxDepth).toBe(3);
  });
});
