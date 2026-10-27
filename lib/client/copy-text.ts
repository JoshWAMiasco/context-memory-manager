"use client";

/**
 * Puts `text` on the system clipboard: the async Clipboard API where the page is a secure
 * context (the desktop app, localhost, HTTPS), else a hidden text area and the `copy` command.
 * Throws when neither works, so the caller can say so.
 *
 * @example
 * await copyTextToClipboard("/Users/me/notes/today.md");
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Denied or unavailable (an insecure context): fall through to the command.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  let isCopied = false;
  try {
    isCopied = document.execCommand("copy");
  } finally {
    textArea.remove();
  }
  if (!isCopied) throw new Error("The clipboard is not available here.");
}
