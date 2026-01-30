/**
 * Shared theme application utilities
 * Used by both the main window and plan viewer window
 */

import { getSchemeColors } from "./tauri";
import { setHighlightTheme } from "./highlight";

export interface ThemeSettings {
  colorScheme: string;
  fontFamily: string;
  fontSize: number;
  contentMargin: number;
}

/**
 * Apply margin to CSS custom property
 */
export function applyMargin(margin: number) {
  document.documentElement.style.setProperty(
    "--content-margin",
    `${margin}px`
  );
}

/**
 * Apply font to CSS custom property
 */
export function applyFont(font: string) {
  document.documentElement.style.setProperty("--body-font", font);
}

/**
 * Apply font size to CSS custom property
 */
export function applyFontSize(size: number) {
  document.documentElement.style.setProperty("--font-size", `${size}px`);
}

/**
 * Determine if a hex color is light (high luminance) or dark
 */
export function isLightColor(hex: string): boolean {
  const color = hex.replace("#", "");
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

/**
 * Apply color scheme by fetching colors and setting CSS variables
 */
export async function applyColorScheme(schemeName: string) {
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
    root.style.setProperty("--quote", colors.quote);

    // Also update derived colors
    root.style.setProperty("--success", colors.green);
    root.style.setProperty("--warning", colors.yellow);
    root.style.setProperty("--error", colors.red);
    root.style.setProperty("--accent-secondary", colors.violet);

    // Set syntax highlighting theme to match the color scheme
    const isLight = isLightColor(colors.bg);
    setHighlightTheme(schemeName, isLight);
  } catch (e) {
    console.error("Failed to apply color scheme:", e);
  }
}

/**
 * Apply all theme settings at once
 */
export async function applyTheme(settings: ThemeSettings) {
  applyMargin(settings.contentMargin);
  applyFont(settings.fontFamily);
  applyFontSize(settings.fontSize);
  if (settings.colorScheme) {
    await applyColorScheme(settings.colorScheme);
  }
}
