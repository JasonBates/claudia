import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

// Track current syntax highlight theme (Shiki theme name)
let currentHighlightTheme = "solarized-dark";

// Map color scheme names to Shiki themes
// Using github themes for most since they have consistent contrast
const SCHEME_TO_SHIKI_THEME: Record<string, string> = {
  "Solarized Dark": "github-dark",
  "Solarized Light": "github-light",
  "Dracula": "github-dark",
  "Nord": "github-dark",
  "One Dark": "github-dark",
  "Gruvbox Dark": "github-dark",
};

// Default themes for light/dark when scheme not in map
const DEFAULT_DARK_THEME = "github-dark";
const DEFAULT_LIGHT_THEME = "github-light";

export function setHighlightTheme(colorSchemeName: string, isLight: boolean) {
  const mappedTheme = SCHEME_TO_SHIKI_THEME[colorSchemeName];
  if (mappedTheme) {
    currentHighlightTheme = mappedTheme;
  } else {
    // Fallback to github themes for unknown schemes
    currentHighlightTheme = isLight ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
  }
}

export function getHighlightTheme(): string {
  return currentHighlightTheme;
}

// Keep these for backwards compatibility
export function setHighlightThemeMode(mode: "dark" | "light") {
  currentHighlightTheme = mode === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
}

export function getHighlightThemeMode(): "dark" | "light" {
  // Infer from current theme
  const lightThemes = ["solarized-light", "github-light"];
  return lightThemes.includes(currentHighlightTheme) ? "light" : "dark";
}

export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [
        "solarized-dark",
        "solarized-light",
        "dracula",
        "nord",
        "one-dark-pro",
        "vitesse-dark",
        "github-dark",
        "github-light",
      ],
      langs: [
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
      ],
    });
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  lang: string
): Promise<string> {
  try {
    const highlighter = await getHighlighter();
    const validLang = highlighter.getLoadedLanguages().includes(lang as any)
      ? lang
      : "text";
    return highlighter.codeToHtml(code, {
      lang: validLang,
      theme: currentHighlightTheme,
    });
  } catch {
    // Fallback to plain text
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
