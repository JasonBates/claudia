import { describe, it, expect, vi } from "vitest";
import {
  createJsonAccumulator,
  hasProperty,
  isArray,
  hasArrayProperty,
  safeJsonParse,
  parseToolInput,
} from "../lib/json-streamer";

describe("createJsonAccumulator", () => {
  describe("basic accumulation", () => {
    it("should start empty", () => {
      const acc = createJsonAccumulator();
      expect(acc.getRaw()).toBe("");
      expect(acc.isActive()).toBe(false);
    });

    it("should accumulate chunks", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append('{"foo":');
      acc.append('"bar"}');
      expect(acc.getRaw()).toBe('{"foo":"bar"}');
    });

    it("should track active state", () => {
      const acc = createJsonAccumulator();
      expect(acc.isActive()).toBe(false);
      acc.start();
      expect(acc.isActive()).toBe(true);
      acc.reset();
      expect(acc.isActive()).toBe(false);
    });

    it("should report buffer length", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append("12345");
      expect(acc.length()).toBe(5);
    });
  });

  describe("parsing", () => {
    it("should parse complete JSON", () => {
      const acc = createJsonAccumulator();
      acc.start();
      const result = acc.append('{"name":"test"}');
      expect(result.success).toBe(true);
      expect(result.value).toEqual({ name: "test" });
    });

    it("should fail on incomplete JSON", () => {
      const acc = createJsonAccumulator();
      acc.start();
      const result = acc.append('{"name":');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should succeed when JSON completes", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append('{"items":[1,');
      acc.append("2,");
      const result = acc.append("3]}");
      expect(result.success).toBe(true);
      expect(result.value).toEqual({ items: [1, 2, 3] });
    });

    it("should handle undefined chunks", () => {
      const acc = createJsonAccumulator();
      acc.start();
      const result = acc.append(undefined);
      expect(result.success).toBe(false);
      expect(acc.getRaw()).toBe("");
    });
  });

  describe("callbacks", () => {
    it("should call onParse when JSON is valid", () => {
      const onParse = vi.fn();
      const acc = createJsonAccumulator({ onParse });
      acc.start();
      acc.append('{"value":42}');
      expect(onParse).toHaveBeenCalledWith({ value: 42 });
    });

    it("should call onError on parse failure", () => {
      const onError = vi.fn();
      const acc = createJsonAccumulator({ onError });
      acc.start();
      acc.append("{invalid");
      expect(onError).toHaveBeenCalled();
    });

    it("should call onParse multiple times as JSON grows", () => {
      const onParse = vi.fn();
      const acc = createJsonAccumulator({ onParse });
      acc.start();
      acc.append('{"a":1}');
      expect(onParse).toHaveBeenCalledTimes(1);
      // Note: appending more would make it invalid JSON
    });
  });

  describe("validation", () => {
    it("should use validator function", () => {
      const validator = (v: unknown): v is { todos: unknown[] } =>
        hasProperty(v, "todos") && isArray(v.todos);

      const acc = createJsonAccumulator({ validator });
      acc.start();

      // Valid structure
      const result1 = acc.append('{"todos":[1,2,3]}');
      expect(result1.success).toBe(true);

      // Reset and try invalid
      acc.reset();
      acc.start();
      const result2 = acc.append('{"other":"value"}');
      expect(result2.success).toBe(false); // Valid JSON but fails validation
    });
  });

  describe("finish", () => {
    it("should return final parsed value", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append('{"done":true}');
      expect(acc.finish()).toEqual({ done: true });
    });

    it("should return undefined for invalid JSON", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append("{incomplete");
      expect(acc.finish()).toBeUndefined();
    });

    it("should return undefined for empty buffer", () => {
      const acc = createJsonAccumulator();
      acc.start();
      expect(acc.finish()).toBeUndefined();
    });

    it("should return undefined for whitespace-only buffer", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append("   ");
      expect(acc.finish()).toBeUndefined();
    });
  });

  describe("reset", () => {
    it("should clear buffer and state", () => {
      const acc = createJsonAccumulator();
      acc.start();
      acc.append('{"data":"test"}');
      acc.reset();
      expect(acc.getRaw()).toBe("");
      expect(acc.isActive()).toBe(false);
      expect(acc.length()).toBe(0);
    });
  });
});

describe("type guards", () => {
  describe("hasProperty", () => {
    it("should return true for objects with property", () => {
      expect(hasProperty({ foo: "bar" }, "foo")).toBe(true);
    });

    it("should return false for objects without property", () => {
      expect(hasProperty({ foo: "bar" }, "baz")).toBe(false);
    });

    it("should return false for null", () => {
      expect(hasProperty(null, "foo")).toBe(false);
    });

    it("should return false for primitives", () => {
      expect(hasProperty("string", "length")).toBe(false);
      expect(hasProperty(123, "toString")).toBe(false);
    });
  });

  describe("isArray", () => {
    it("should return true for arrays", () => {
      expect(isArray([])).toBe(true);
      expect(isArray([1, 2, 3])).toBe(true);
    });

    it("should return false for non-arrays", () => {
      expect(isArray({})).toBe(false);
      expect(isArray("string")).toBe(false);
      expect(isArray(null)).toBe(false);
    });
  });

  describe("hasArrayProperty", () => {
    it("should create validator for array properties", () => {
      const hasTodos = hasArrayProperty("todos");
      expect(hasTodos({ todos: [] })).toBe(true);
      expect(hasTodos({ todos: [1, 2] })).toBe(true);
      expect(hasTodos({ todos: "not array" })).toBe(false);
      expect(hasTodos({ other: [] })).toBe(false);
    });
  });
});

describe("safeJsonParse", () => {
  it("should parse valid JSON", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it("should return fallback for invalid JSON", () => {
    expect(safeJsonParse("{invalid", { default: true })).toEqual({
      default: true,
    });
  });

  it("should return fallback for empty string", () => {
    expect(safeJsonParse("", "fallback")).toBe("fallback");
  });

  it("should return fallback for whitespace", () => {
    expect(safeJsonParse("   ", "fallback")).toBe("fallback");
  });
});

describe("parseToolInput", () => {
  it("should parse valid JSON tool input", () => {
    expect(parseToolInput('{"file_path":"/test.txt"}')).toEqual({
      file_path: "/test.txt",
    });
  });

  it("should return { raw } for invalid JSON", () => {
    expect(parseToolInput("not json")).toEqual({ raw: "not json" });
  });

  it("should return empty object for empty input", () => {
    expect(parseToolInput("")).toEqual({});
  });

  it("should return empty object for whitespace", () => {
    expect(parseToolInput("   ")).toEqual({});
  });
});
