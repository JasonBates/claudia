/**
 * JSON detection and formatting utilities for tool results
 */

const MAX_LINE_WIDTH = 80;

/**
 * Check if a string looks like JSON (starts with { or [ after trimming whitespace)
 */
function looksLikeJson(str: string): boolean {
  const trimmed = str.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

/**
 * Try to parse JSON, returning null if invalid
 */
function tryParseJson(str: string): unknown | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Pretty-print JSON with smart line wrapping.
 * Keeps short arrays/objects compact, breaks long ones.
 */
function prettyPrintJson(value: unknown, indent = 0): string {
  const spaces = "  ".repeat(indent);
  const childSpaces = "  ".repeat(indent + 1);

  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (typeof value === "string") {
    const escaped = JSON.stringify(value);
    // If string is very long, it will just be a long line - that's OK for strings
    return escaped;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    // Try compact format first
    const compact = "[" + value.map(v => prettyPrintJson(v, 0)).join(", ") + "]";
    if (compact.length + indent * 2 <= MAX_LINE_WIDTH && !compact.includes("\n")) {
      return compact;
    }

    // Expanded format
    const items = value.map(v => childSpaces + prettyPrintJson(v, indent + 1));
    return "[\n" + items.join(",\n") + "\n" + spaces + "]";
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";

    // Try compact format first
    const compactParts = entries.map(([k, v]) => `${JSON.stringify(k)}: ${prettyPrintJson(v, 0)}`);
    const compact = "{ " + compactParts.join(", ") + " }";
    if (compact.length + indent * 2 <= MAX_LINE_WIDTH && !compact.includes("\n")) {
      return compact;
    }

    // Expanded format
    const items = entries.map(([k, v]) => {
      const formattedValue = prettyPrintJson(v, indent + 1);
      return childSpaces + JSON.stringify(k) + ": " + formattedValue;
    });
    return "{\n" + items.join(",\n") + "\n" + spaces + "}";
  }

  return String(value);
}

/**
 * Format a string as a JSON markdown code block if it's valid JSON.
 * Returns the original string if it's not JSON or is already in a code block.
 */
export function formatJsonResult(content: string): string {
  // Skip if empty or already contains markdown code blocks
  if (!content || content.includes("```")) {
    return content;
  }

  // Quick check - does it look like JSON?
  if (!looksLikeJson(content)) {
    return content;
  }

  // Try to parse as JSON
  const parsed = tryParseJson(content);
  if (parsed === null) {
    return content;
  }

  // Pretty-print with smart wrapping and wrap in markdown code block
  const formatted = prettyPrintJson(parsed);
  return "```json\n" + formatted + "\n```";
}

/**
 * Check if content appears to be JSON that should be formatted
 */
export function isJsonContent(content: string): boolean {
  if (!content || content.includes("```")) {
    return false;
  }
  if (!looksLikeJson(content)) {
    return false;
  }
  return tryParseJson(content) !== null;
}
