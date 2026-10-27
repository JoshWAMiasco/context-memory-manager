"use client";

import { useSyncExternalStore } from "react";
import { requestJson } from "@/lib/client/api";
import { readDesktopBridge } from "@/lib/client/desktop";
import { DEFAULT_THEME, isThemePreference, type ThemePreference } from "@/lib/theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function subscribeToTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia(LIGHT_QUERY);
  media.addEventListener("change", listener);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", listener);
  };
}

function readThemePreference(): ThemePreference {
  const theme = document.documentElement.dataset.theme;
  return isThemePreference(theme) ? theme : DEFAULT_THEME;
}

function readResolvedTheme(): "dark" | "light" {
  const theme = readThemePreference();
  if (theme === "system") return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
  return theme;
}

/**
 * The theme the user chose (Dark, Light or System), as `<html data-theme>` says.
 *
 * @example
 * const theme = useThemePreference();
 */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeToTheme, readThemePreference, () => DEFAULT_THEME);
}

/**
 * The theme on screen: System resolved to Dark or Light by the computer's appearance. Updates when
 * either changes.
 *
 * @example
 * const isLight = useResolvedTheme() === "light";
 */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeToTheme, readResolvedTheme, () => "dark");
}

/** `readResolvedTheme` and its change events, for code outside React (the terminal). */
export const resolvedTheme = { read: readResolvedTheme, subscribe: subscribeToTheme };

/**
 * Switches the theme at once, then saves it for the user (all their browsers) and, in the desktop
 * app, for its window and splash screen.
 *
 * @example
 * await setThemePreference("light");
 */
export async function setThemePreference(theme: ThemePreference): Promise<void> {
  document.documentElement.dataset.theme = theme;
  readDesktopBridge()?.setTheme(theme);
  await requestJson("/api/users/me/theme", { method: "PUT", body: { theme } });
}
