import { createSignal, onMount, createEffect, Accessor } from "solid-js";
import {
  getConfig,
  saveConfig,
  listColorSchemes,
  getSchemeColors,
  ColorSchemeInfo,
} from "../lib/tauri";
import { setHighlightTheme } from "../lib/highlight";

export interface FontOption {
  label: string;
  value: string;
}

export interface UseSettingsReturn {
  // State
  isOpen: Accessor<boolean>;
  contentMargin: Accessor<number>;
  fontFamily: Accessor<string>;
  fontSize: Accessor<number>;
  colorScheme: Accessor<string | null>;
  availableSchemes: Accessor<ColorSchemeInfo[]>;
  availableFonts: FontOption[];

  // Actions
  openSettings: () => void;
  closeSettings: () => void;
  setContentMargin: (margin: number) => void;
  setFontFamily: (font: string) => void;
  setFontSize: (size: number) => void;
  setColorScheme: (scheme: string | null) => void;
  resetToDefaults: () => void;
}

const CURATED_FONTS: FontOption[] = [
  // Monospace
  { label: "SF Mono", value: "'SF Mono', Menlo, Monaco, monospace" },
  // Modern sans-serif
  { label: "SF Pro", value: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" },
  { label: "Avenir Next", value: "'Avenir Next', Avenir, 'Helvetica Neue', sans-serif" },
  // Modern serif
  { label: "New York", value: "'New York', 'Iowan Old Style', Georgia, serif" },
  { label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
];

const DEFAULT_MARGIN = 16;
const DEFAULT_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_SCHEME = "Solarized Dark";

/**
 * Hook for managing appearance settings with live preview and persistence.
 */
export function useSettings(): UseSettingsReturn {
  const [isOpen, setIsOpen] = createSignal(false);
  const [contentMargin, setContentMarginSignal] = createSignal(DEFAULT_MARGIN);
  const [fontFamily, setFontFamilySignal] = createSignal(DEFAULT_FONT);
  const [fontSize, setFontSizeSignal] = createSignal(DEFAULT_FONT_SIZE);
  const [colorScheme, setColorSchemeSignal] = createSignal<string | null>(
    DEFAULT_SCHEME
  );
  const [availableSchemes, setAvailableSchemes] = createSignal<
    ColorSchemeInfo[]
  >([]);

  // Load settings on mount
  onMount(async () => {
    try {
      // Load config
      const config = await getConfig();
      setContentMarginSignal(config.content_margin ?? DEFAULT_MARGIN);
      setFontFamilySignal(config.font_family ?? DEFAULT_FONT);
      setFontSizeSignal(config.font_size ?? DEFAULT_FONT_SIZE);
      setColorSchemeSignal(config.color_scheme ?? DEFAULT_SCHEME);

      // Apply settings to CSS
      applyMargin(config.content_margin ?? DEFAULT_MARGIN);
      applyFont(config.font_family ?? DEFAULT_FONT);
      applyFontSize(config.font_size ?? DEFAULT_FONT_SIZE);
      if (config.color_scheme) {
        await applyColorScheme(config.color_scheme);
      }

      // Load available color schemes
      const schemes = await listColorSchemes();
      setAvailableSchemes(schemes);
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  });

  // Live preview: apply margin changes immediately
  createEffect(() => {
    applyMargin(contentMargin());
  });

  // Live preview: apply font changes immediately
  createEffect(() => {
    applyFont(fontFamily());
  });

  // Live preview: apply font size changes immediately
  createEffect(() => {
    applyFontSize(fontSize());
  });

  // Persist changes to config
  const persistSettings = async () => {
    try {
      const config = await getConfig();
      await saveConfig({
        ...config,
        content_margin: contentMargin(),
        font_family: fontFamily(),
        font_size: fontSize(),
        color_scheme: colorScheme() ?? undefined,
      });
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const setContentMargin = (margin: number) => {
    setContentMarginSignal(margin);
    persistSettings();
  };

  const setFontFamily = (font: string) => {
    setFontFamilySignal(font);
    persistSettings();
  };

  const setFontSize = (size: number) => {
    setFontSizeSignal(size);
    persistSettings();
  };

  const setColorScheme = async (scheme: string | null) => {
    setColorSchemeSignal(scheme);
    if (scheme) {
      await applyColorScheme(scheme);
    }
    persistSettings();
  };

  const resetToDefaults = async () => {
    setContentMarginSignal(DEFAULT_MARGIN);
    setFontFamilySignal(DEFAULT_FONT);
    setFontSizeSignal(DEFAULT_FONT_SIZE);
    setColorSchemeSignal(DEFAULT_SCHEME);
    await applyColorScheme(DEFAULT_SCHEME);
    persistSettings();
  };

  return {
    isOpen,
    contentMargin,
    fontFamily,
    fontSize,
    colorScheme,
    availableSchemes,
    availableFonts: CURATED_FONTS,
    openSettings: () => setIsOpen(true),
    closeSettings: () => setIsOpen(false),
    setContentMargin,
    setFontFamily,
    setFontSize,
    setColorScheme,
    resetToDefaults,
  };
}

/**
 * Apply margin to CSS custom property
 */
function applyMargin(margin: number) {
  document.documentElement.style.setProperty(
    "--content-margin",
    `${margin}px`
  );
}

/**
 * Apply font to CSS custom property
 */
function applyFont(font: string) {
  document.documentElement.style.setProperty("--body-font", font);
}

/**
 * Apply font size to CSS custom property
 */
function applyFontSize(size: number) {
  document.documentElement.style.setProperty("--font-size", `${size}px`);
}

/**
 * Apply color scheme by fetching colors and setting CSS variables
 */
async function applyColorScheme(schemeName: string) {
  try {
    const colors = await getSchemeColors(schemeName);
    const root = document.documentElement;

    // Apply core colors to CSS variables
    root.style.setProperty("--bg", colors.bg);
    root.style.setProperty("--bg-secondary", colors.bg_secondary);
    root.style.setProperty("--bg-tertiary", colors.bg_tertiary);
    root.style.setProperty("--fg", colors.fg);
    root.style.setProperty("--fg-muted", colors.fg_muted);
    root.style.setProperty("--accent", colors.accent);
    root.style.setProperty("--red", colors.red);
    root.style.setProperty("--green", colors.green);
    root.style.setProperty("--yellow", colors.yellow);
    root.style.setProperty("--blue", colors.blue);
    root.style.setProperty("--cyan", colors.cyan);
    root.style.setProperty("--magenta", colors.magenta);
    root.style.setProperty("--violet", colors.violet);

    // Apply UI-specific colors
    root.style.setProperty("--border", colors.border);
    root.style.setProperty("--user-bg", colors.user_bg);
    root.style.setProperty("--code-bg", colors.code_bg);

    // Also update derived colors
    root.style.setProperty("--success", colors.green);
    root.style.setProperty("--warning", colors.yellow);
    root.style.setProperty("--error", colors.red);
    root.style.setProperty("--accent-secondary", colors.violet);

    // Set syntax highlighting theme to match the color scheme
    // Uses scheme-specific Shiki themes when available, falls back to github themes
    const isLightTheme = isLightColor(colors.bg);
    setHighlightTheme(schemeName, isLightTheme);
  } catch (e) {
    console.error("Failed to apply color scheme:", e);
  }
}

/**
 * Determine if a hex color is light (high luminance) or dark
 */
function isLightColor(hex: string): boolean {
  const color = hex.replace("#", "");
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}
