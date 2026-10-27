/*
 * The colour themes, shared by the server (which renders `<html data-theme>`) and the browser.
 * Isomorphic: no server-only imports here.
 */

export const THEME_PREFERENCES = ["dark", "light", "system"] as const;
/** Dark (the default), Light, or System: follow the computer's appearance. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME: ThemePreference = "dark";

/**
 * The cookie that keeps the last signed-in user's theme in this browser, so the pages before
 * sign-in (sign-in, lock, setup) render in it too. Signed in, the user's saved theme decides.
 */
export const THEME_COOKIE_NAME = "cmm_theme";

export const THEME_LABELS: Record<ThemePreference, string> = { dark: "Dark", light: "Light", system: "System" };

/** The page background of each resolved theme, for the desktop window before the page paints. */
export const THEME_CANVAS_COLORS = { dark: "#04101a", light: "#f2f6f9" } as const;

/**
 * Whether a value is one of the themes.
 *
 * @example
 * isThemePreference("light"); // true
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * The theme cookie for a user's preference: a year long, readable by the server only.
 *
 * @example
 * response.cookies.set(buildThemeCookie("light", client.isSecure));
 */
export function buildThemeCookie(theme: ThemePreference, isSecure: boolean) {
  return {
    name: THEME_COOKIE_NAME,
    value: theme,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: isSecure,
    maxAge: 365 * 24 * 60 * 60,
  };
}
