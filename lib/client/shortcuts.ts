const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * A CodeMirror-style shortcut (`Mod-Shift-K`) as this platform writes it: ⌘⇧K on macOS,
 * Ctrl+Shift+K elsewhere.
 *
 * @example
 * formatShortcut("Mod-K"); // "⌘K" on macOS, "Ctrl+K" on Windows and Linux
 */
export function formatShortcut(shortcut: string): string {
  return IS_MAC
    ? shortcut.replaceAll("Mod-", "⌘").replaceAll("Shift-", "⇧").replaceAll("Alt-", "⌥")
    : shortcut.replaceAll("Mod-", "Ctrl+").replaceAll("Shift-", "Shift+").replaceAll("Alt-", "Alt+");
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
