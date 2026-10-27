/*
 * The desktop app's side of the colour theme: native dialogs, menus and the page's
 * `prefers-color-scheme` follow it (`nativeTheme.themeSource`), and windows open in its background
 * colour. The user's choice is kept in `userData/theme.json`, so the next launch's splash screen
 * already has it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { nativeTheme } from "electron";
import { DEFAULT_THEME, isThemePreference, THEME_CANVAS_COLORS, type ThemePreference } from "@/lib/theme";

/** The theme saved by the last `saveThemePreference`, or Dark. */
export function loadThemePreference(filePath: string): ThemePreference {
  try {
    const { theme } = JSON.parse(readFileSync(filePath, "utf8")) as { theme?: unknown };
    return isThemePreference(theme) ? theme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Remembers the theme for the next launch; a failure only costs the splash its colours. */
export function saveThemePreference(filePath: string, theme: ThemePreference): void {
  try {
    writeFileSync(filePath, JSON.stringify({ theme }), { mode: 0o600 });
  } catch {
    // Not saved: the next launch starts dark until the page sets the theme again.
  }
}

/** Makes Electron's native UI and the pages' `prefers-color-scheme` follow `theme`. */
export function applyTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme;
}

/** The background a new window opens with, so it doesn't flash the other theme before the page paints. */
export function readCanvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? THEME_CANVAS_COLORS.dark : THEME_CANVAS_COLORS.light;
}
