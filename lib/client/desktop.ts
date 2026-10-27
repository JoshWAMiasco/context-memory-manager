"use client";

import { useSyncExternalStore } from "react";
import { requestJson } from "@/lib/client/api";
import { copyTextToClipboard } from "@/lib/client/copy-text";
import { isBridgePath, type CmmDesktopBridge } from "@/lib/desktop-bridge";

declare global {
  interface Window {
    /** Set by the desktop app's preload; undefined in a browser. */
    cmmDesktop?: CmmDesktopBridge;
  }
}

/**
 * The desktop app's bridge when CMM runs inside it, else undefined (a browser, or server-side
 * rendering).
 *
 * @example
 * const bridge = readDesktopBridge();
 * if (bridge) await bridge.pickFolder();
 */
export function readDesktopBridge(): CmmDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = window.cmmDesktop;
  return bridge?.isDesktop === true ? bridge : undefined;
}

/**
 * True inside the CMM desktop app.
 *
 * @example
 * {isDesktopApp() && <Button onClick={browse}>Browse…</Button>}
 */
export function isDesktopApp(): boolean {
  return readDesktopBridge() !== undefined;
}

const subscribeToNothing = () => () => undefined;

/**
 * `isDesktopApp()` for rendering: false on the server and during hydration, then the real value,
 * so server and client markup match.
 *
 * @example
 * const isDesktop = useIsDesktopApp();
 */
export function useIsDesktopApp(): boolean {
  return useSyncExternalStore(subscribeToNothing, isDesktopApp, () => false);
}

/**
 * The OS file manager's name for "Reveal in …": from the desktop app's platform, else guessed from
 * the browser's user agent.
 *
 * @example
 * `Reveal in ${readFileManagerName()}`; // "Reveal in Finder" on macOS
 */
export function readFileManagerName(): "Finder" | "Explorer" | "Files" {
  const platform =
    readDesktopBridge()?.platform ??
    (typeof navigator === "undefined"
      ? ""
      : /Win/i.test(navigator.userAgent)
        ? "win32"
        : /Mac/i.test(navigator.userAgent)
          ? "darwin"
          : "linux");
  if (platform === "darwin") return "Finder";
  if (platform === "win32") return "Explorer";
  return "Files";
}

/**
 * Asks for a folder with the system dialog (Settings › Storages). Undefined outside the desktop
 * app, null when the user cancels.
 *
 * @example
 * const folderPath = await pickFolder();
 * if (folderPath) setNewRootPath(folderPath);
 */
export async function pickFolder(): Promise<string | null | undefined> {
  const bridge = readDesktopBridge();
  return bridge ? bridge.pickFolder() : undefined;
}

/**
 * Shows a storage entry in Finder, Explorer or the file manager: the server resolves its absolute
 * path (desktop mode only, through the path jail), then the desktop app reveals it. False outside
 * the desktop app or when the entry is gone.
 *
 * @example
 * await revealInFileManager(storageId, "notes/today.md");
 */
export async function revealInFileManager(storageId: string, entryPath: string): Promise<boolean> {
  const bridge = readDesktopBridge();
  if (!bridge) return false;
  return bridge.revealPath(await readEntryAbsolutePath(storageId, entryPath));
}

/**
 * Opens a storage folder itself in Finder, Explorer or the file manager, showing its contents
 * (where `revealInFileManager` shows the folder selected inside its parent). False outside the
 * desktop app or when the folder is gone.
 *
 * @example
 * await openInFileManager(storageId, "notes");
 */
export async function openInFileManager(storageId: string, folderPath: string): Promise<boolean> {
  const bridge = readDesktopBridge();
  if (!bridge) return false;
  return bridge.openFolder(await readEntryAbsolutePath(storageId, folderPath));
}

/**
 * The absolute path of a storage entry, from the server (desktop mode only, through the path
 * jail). Refuses anything that isn't an absolute path.
 *
 * @example
 * const absolutePath = await readEntryAbsolutePath(storageId, "notes/today.md");
 */
export async function readEntryAbsolutePath(storageId: string, entryPath: string): Promise<string> {
  const query = new URLSearchParams({ storageId, path: entryPath });
  const { absolutePath } = await requestJson<{ absolutePath: string }>(`/api/fs/abs-path?${query}`);
  if (!isBridgePath(absolutePath)) throw new Error("The server did not return an absolute path.");
  return absolutePath;
}

/**
 * Copies a storage entry's absolute path to the clipboard ("Copy full path"), resolved by the
 * server in desktop mode. Resolves to the path copied.
 *
 * @example
 * announce("Copied", await copyEntryPath(storageId, "notes/today.md"));
 */
export async function copyEntryPath(storageId: string, entryPath: string): Promise<string> {
  const absolutePath = await readEntryAbsolutePath(storageId, entryPath);
  await copyTextToClipboard(absolutePath);
  return absolutePath;
}

/**
 * Opens an external link: in the desktop app through the main process, which asks first; in a
 * browser in a new tab.
 *
 * @example
 * <a href={href} onClick={(clickEvent) => { clickEvent.preventDefault(); void openExternalLink(href); }} />
 */
export async function openExternalLink(url: string): Promise<boolean> {
  const bridge = readDesktopBridge();
  if (bridge) return bridge.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
