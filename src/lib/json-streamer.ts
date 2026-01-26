/**
 * JSON streaming accumulator for handling chunked JSON from Claude.
 *
 * When Claude streams tool input, it arrives in chunks that need to be
 * accumulated and parsed. This utility encapsulates that pattern:
 *
 * 1. Accumulate chunks as they arrive
 * 2. Attempt to parse the accumulated JSON
 * 3. Call a callback when parsing succeeds
 * 4. Reset when the tool completes
 *
 * This replaces the scattered `let json = ""; json += chunk; JSON.parse(json)`
 * pattern throughout App.tsx.
 */

/**
 * Result of attempting to parse accumulated JSON
 */
export interface ParseResult<T> {
  /** Whether parsing succeeded */
  success: boolean;
  /** The parsed value (if success is true) */
  value?: T;
  /** The parse error (if success is false) */
  error?: Error;
  /** The raw accumulated string */
  raw: string;
}

/**
 * Options for creating a JSON accumulator
 */
export interface JsonAccumulatorOptions<T> {
  /** Called when JSON successfully parses */
  onParse?: (value: T) => void;
  /** Called on parse error (optional - errors are expected during streaming) */
  onError?: (error: Error, raw: string) => void;
  /** Validator function to check if parsed value is valid */
  validator?: (value: unknown) => value is T;
}

/**
 * Creates a JSON accumulator for streaming JSON chunks.
 *
 * @example
 * ```tsx
 * const todoAccumulator = createJsonAccumulator<{ todos: Todo[] }>({
 *   onParse: (value) => {
 *     if (value.todos) setCurrentTodos(value.todos);
 *   },
 *   validator: (v): v is { todos: Todo[] } =>
 *     typeof v === 'object' && v !== null && 'todos' in v
 * });
 *
 * // In event handler:
 * case "tool_input":
 *   todoAccumulator.append(event.json);
 *   break;
 *
 * case "tool_result":
 *   const finalValue = todoAccumulator.finish();
 *   todoAccumulator.reset();
 *   break;
 * ```
 */
export function createJsonAccumulator<T = unknown>(
  options: JsonAccumulatorOptions<T> = {}
) {
  let buffer = "";
  let isCollecting = false;

  return {
    /**
     * Start collecting JSON chunks
     */
    start(): void {
      buffer = "";
      isCollecting = true;
    },

    /**
     * Append a JSON chunk and attempt to parse
     * @returns ParseResult with success status and parsed value
     */
    append(chunk: string | undefined): ParseResult<T> {
      if (!chunk) {
        return { success: false, raw: buffer };
      }

      buffer += chunk;

      try {
        const parsed = JSON.parse(buffer);

        // Validate if validator provided
        if (options.validator && !options.validator(parsed)) {
          return { success: false, raw: buffer };
        }

        options.onParse?.(parsed as T);
        return { success: true, value: parsed as T, raw: buffer };
      } catch (e) {
        // Parse errors are expected during streaming - JSON is incomplete
        const error = e instanceof Error ? e : new Error(String(e));
        options.onError?.(error, buffer);
        return { success: false, error, raw: buffer };
      }
    },

    /**
     * Finish collecting and return final parsed value
     * @returns The final parsed value or undefined if parsing fails
     */
    finish(): T | undefined {
      if (!buffer.trim()) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(buffer);
        if (options.validator && !options.validator(parsed)) {
          return undefined;
        }
        return parsed as T;
      } catch {
        return undefined;
      }
    },

    /**
     * Get the current raw buffer contents
     */
    getRaw(): string {
      return buffer;
    },

    /**
     * Reset the accumulator for reuse
     */
    reset(): void {
      buffer = "";
      isCollecting = false;
    },

    /**
     * Check if currently collecting
     */
    isActive(): boolean {
      return isCollecting;
    },

    /**
     * Get current buffer length (useful for debugging)
     */
    length(): number {
      return buffer.length;
    },
  };
}

/**
 * Type guard for objects with a specific property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && key in obj;
}

/**
 * Type guard for arrays
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Creates a validator for objects with an array property
 *
 * @example
 * ```tsx
 * const todoAccumulator = createJsonAccumulator({
 *   validator: hasArrayProperty('todos')
 * });
 * ```
 */
export function hasArrayProperty<K extends string>(
  key: K
): (value: unknown) => value is Record<K, unknown[]> {
  return (value): value is Record<K, unknown[]> => {
    return hasProperty(value, key) && isArray(value[key]);
  };
}

/**
 * Safely parse JSON with a fallback for invalid input
 *
 * @param json - The JSON string to parse
 * @param fallback - Value to return if parsing fails
 * @returns Parsed value or fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  if (!json.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse tool input JSON, falling back to { raw: input } for invalid JSON
 *
 * This matches the existing pattern in App.tsx for handling tool input
 * that might not be valid JSON.
 */
export function parseToolInput(input: string): unknown {
  if (!input.trim()) {
    return {};
  }
  try {
    return JSON.parse(input);
  } catch {
    return { raw: input };
  }
}
