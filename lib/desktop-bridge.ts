/*
 * The contract between the Electron preload (`electron/preload.ts`) and the renderer
 * (`lib/client/desktop.ts`): what `window.cmmDesktop` holds and the IPC channels behind it. Shared
 * so both sides agree; nothing here imports Electron.
 */

/** The bridge the desktop app's preload exposes as `window.cmmDesktop`; absent in a browser. */
export interface CmmDesktopBridge {
  isDesktop: true;
  /** `process.platform` of the computer the desktop app runs on: "darwin", "win32", "linux"… */
  platform: string;
  appVersion: string;
  /** Asks for a folder with the system dialog; null when the user cancels. */
  pickFolder: () => Promise<string | null>;
  /** Shows a file or folder in Finder, Explorer or the file manager. False when the path is gone. */
  revealPath: (absolutePath: string) => Promise<boolean>;
  /** Opens a folder itself in Finder, Explorer or the file manager. False when it is gone or not a folder. */
  openFolder: (absolutePath: string) => Promise<boolean>;
  /** Opens an http(s) or mailto link in the default browser, after the user confirms. False when declined. */
  openExternal: (url: string) => Promise<boolean>;
}

/** IPC channel names, `ipcRenderer.invoke` ↔ `ipcMain.handle`. */
export const DESKTOP_CHANNELS = {
  pickFolder: "cmm:pick-folder",
  revealPath: "cmm:reveal-path",
  openFolder: "cmm:open-folder",
  openExternal: "cmm:open-external",
} as const;

/** Longest path the bridge passes on; longer arguments are rejected before they reach the main process. */
export const MAX_BRIDGE_PATH_LENGTH = 32_767;

/** Longest URL the bridge passes on. */
export const MAX_BRIDGE_URL_LENGTH = 8192;

/**
 * True for an absolute path the bridge may pass to the main process: a string, not too long, no
 * NUL, and absolute on POSIX (`/…`) or Windows (`C:\…`, `\\server\share…`).
 *
 * @example
 * isBridgePath("/Users/me/notes.md"); // true
 * isBridgePath("notes.md"); // false
 */
export function isBridgePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BRIDGE_PATH_LENGTH) return false;
  if (value.includes("\0")) return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * True for a link the desktop app may open outside itself: `http:`, `https:` or `mailto:` only.
 *
 * @example
 * isExternalLink("https://example.com/docs"); // true
 * isExternalLink("file:///etc/passwd"); // false
 */
export function isExternalLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BRIDGE_URL_LENGTH) return false;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
