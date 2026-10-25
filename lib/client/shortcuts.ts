import { useSyncExternalStore } from "react";

// Node 22 has a `navigator` too ("Node.js/22"), so the server always formats for Windows and Linux.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

function formatForPlatform(shortcut: string, isMac: boolean): string {
  return isMac
    ? shortcut.replaceAll("Mod-", "⌘").replaceAll("Shift-", "⇧").replaceAll("Alt-", "⌥")
    : shortcut.replaceAll("Mod-", "Ctrl+").replaceAll("Shift-", "Shift+").replaceAll("Alt-", "Alt+");
}

/**
 * A CodeMirror-style shortcut (`Mod-Shift-K`) as this platform writes it: ⌘⇧K on macOS,
 * Ctrl+Shift+K elsewhere. For text the server renders too, use `useShortcutLabel`.
 *
 * @example
 * formatShortcut("Mod-K"); // "⌘K" on macOS, "Ctrl+K" on Windows and Linux
 */
export function formatShortcut(shortcut: string): string {
  return formatForPlatform(shortcut, IS_MAC);
}

const subscribeToNothing = () => () => undefined;

/**
 * `formatShortcut` for text the server renders too: the server's label ("Ctrl+K") while the page
 * hydrates, so the HTML matches, then this platform's ("⌘K" on macOS).
 *
 * @example
 * const searchShortcut = useShortcutLabel("Mod-K");
 */
export function useShortcutLabel(shortcut: string): string {
  const isMac = useSyncExternalStore(
    subscribeToNothing,
    () => IS_MAC,
    () => false,
  );
  return formatForPlatform(shortcut, isMac);
}

/**
 * Whether `keyEvent` is ⌘/Ctrl plus `key` (case-insensitive), without Alt or Shift, and not
 * already handled by something closer to the focus (an editor's own binding).
 *
 * @example
 * if (isCommandShortcut(keyEvent, "k")) openQuickSearch();
 */
export function isCommandShortcut(keyEvent: KeyboardEvent, key: string): boolean {
  return (
    (keyEvent.metaKey || keyEvent.ctrlKey) &&
    !keyEvent.altKey &&
    !keyEvent.shiftKey &&
    !keyEvent.defaultPrevented &&
    keyEvent.key.toLowerCase() === key.toLowerCase()
  );
}
