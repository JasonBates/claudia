import { describe, it, expect, vi, afterEach } from "vitest";

// Note: Tests use vi.resetModules() and vi.doMock() for each test
// to properly test the singleton behavior of the highlighter module.

describe("highlight", () => {
  // Mock highlighter instance used across tests
  const mockHighlighter = {
    getLoadedLanguages: vi.fn(),
    codeToHtml: vi.fn(),
  };

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ============================================================================
  // getHighlighter
  // ============================================================================

  describe("getHighlighter", () => {
    it("should create highlighter with correct themes and languages", async () => {
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockResolvedValue(mockHighlighter),
      }));

      const { getHighlighter: freshGetHighlighter } = await import("../lib/highlight");
      await freshGetHighlighter();

      // Check that createHighlighter was called with expected themes and languages
      const { createHighlighter: mockCreate } = await import("shiki");
      expect(mockCreate).toHaveBeenCalledWith({
        themes: expect.arrayContaining([
          "solarized-dark",
          "solarized-light",
          "github-dark",
          "github-light",
        ]),
        langs: expect.arrayContaining([
          "typescript",
          "javascript",
          "rust",
          "python",
          "bash",
          "json",
          "html",
          "css",
          "markdown",
          "yaml",
          "toml",
          "sql",
          "go",
          "swift",
        ]),
      });
    });

    it("should return same instance on multiple calls (singleton)", async () => {
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockResolvedValue(mockHighlighter),
      }));

      const { getHighlighter: freshGetHighlighter } = await import("../lib/highlight");

      const first = await freshGetHighlighter();
      const second = await freshGetHighlighter();
      const third = await freshGetHighlighter();

      // All should be the same instance
      expect(first).toBe(second);
      expect(second).toBe(third);

      // createHighlighter should only be called once
      const { createHighlighter: mockCreate } = await import("shiki");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // highlightCode
  // ============================================================================

  describe("highlightCode", () => {
    it("should highlight code with valid language", async () => {
      const freshMockHighlighter = {
        getLoadedLanguages: vi.fn().mockReturnValue(["typescript", "javascript"]),
        codeToHtml: vi.fn().mockReturnValue('<pre class="shiki"><code>const x = 1;</code></pre>'),
      };
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockResolvedValue(freshMockHighlighter),
      }));

      const { highlightCode: freshHighlightCode } = await import("../lib/highlight");

      const result = await freshHighlightCode("const x = 1;", "typescript");

      expect(result).toContain("<pre");
      expect(freshMockHighlighter.codeToHtml).toHaveBeenCalledWith("const x = 1;", {
        lang: "typescript",
        theme: "solarized-dark",
      });
    });

    it("should fallback to 'text' for unknown languages", async () => {
      const freshMockHighlighter = {
        getLoadedLanguages: vi.fn().mockReturnValue(["typescript", "javascript"]),
        codeToHtml: vi.fn().mockReturnValue('<pre><code>plain text</code></pre>'),
      };
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockResolvedValue(freshMockHighlighter),
      }));

      const { highlightCode: freshHighlightCode } = await import("../lib/highlight");

      await freshHighlightCode("plain text", "unknown-lang");

      expect(freshMockHighlighter.codeToHtml).toHaveBeenCalledWith("plain text", {
        lang: "text",
        theme: "solarized-dark",
      });
    });

    it("should return escaped HTML on error", async () => {
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockRejectedValue(new Error("Shiki failed")),
      }));

      const { highlightCode: freshHighlightCode } = await import("../lib/highlight");

      const result = await freshHighlightCode('<script>alert("xss")</script>', "html");

      // Should return escaped HTML
      expect(result).toContain("&lt;script&gt;");
      expect(result).toContain("&lt;/script&gt;");
      expect(result).not.toContain("<script>");
    });

    it("should escape special HTML characters in fallback", async () => {
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockRejectedValue(new Error("Failed")),
      }));

      const { highlightCode: freshHighlightCode } = await import("../lib/highlight");

      const result = await freshHighlightCode('Test & "quotes" & <tags> & \'apostrophe\'', "text");

      expect(result).toContain("&amp;");
      expect(result).toContain("&quot;");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      expect(result).toContain("&#039;");
    });

    it("should wrap fallback in pre/code tags", async () => {
      vi.doMock("shiki", () => ({
        createHighlighter: vi.fn().mockRejectedValue(new Error("Failed")),
      }));

      const { highlightCode: freshHighlightCode } = await import("../lib/highlight");

      const result = await freshHighlightCode("some code", "text");

      expect(result).toMatch(/^<pre><code>.*<\/code><\/pre>$/);
    });
  });
});
