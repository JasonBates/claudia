import { createSignal, onMount, createEffect, Accessor } from "solid-js";
import {
  getConfig,
  saveConfig,
  hasLocalConfig,
  listColorSchemes,
  ColorSchemeInfo,
} from "../lib/tauri";
import {
  applyMargin,
  applyFont,
  applyFontSize,
  applyColorScheme,
} from "../lib/theme-utils";

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
  saveLocally: Accessor<boolean>;

  // Actions
  openSettings: () => void;
  closeSettings: () => void;
  setContentMargin: (margin: number) => void;
  setFontFamily: (font: string) => void;
  setFontSize: (size: number) => void;
  setColorScheme: (scheme: string | null) => void;
  setSaveLocally: (locally: boolean) => void;
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
  const [saveLocally, setSaveLocallySignal] = createSignal(false);

  // Load settings on mount
  onMount(async () => {
    try {
      // Load config
      const config = await getConfig();
      setContentMarginSignal(config.content_margin ?? DEFAULT_MARGIN);
      setFontFamilySignal(config.font_family ?? DEFAULT_FONT);
      setFontSizeSignal(config.font_size ?? DEFAULT_FONT_SIZE);
      setColorSchemeSignal(config.color_scheme ?? DEFAULT_SCHEME);

      // Check if we're using a local config
      const isLocal = await hasLocalConfig();
      setSaveLocallySignal(isLocal);

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
      await saveConfig(
        {
          ...config,
          content_margin: contentMargin(),
          font_family: fontFamily(),
          font_size: fontSize(),
          color_scheme: colorScheme() ?? undefined,
        },
        saveLocally()
      );
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

  const setSaveLocally = (locally: boolean) => {
    setSaveLocallySignal(locally);
    // Re-persist with new locality setting
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
    saveLocally,
    openSettings: () => setIsOpen(true),
    closeSettings: () => setIsOpen(false),
    setContentMargin,
    setFontFamily,
    setFontSize,
    setColorScheme,
    setSaveLocally,
    resetToDefaults,
  };
}
