"use client";

import { useSyncExternalStore } from "react";

/** Text fields: a text area, an editable element, or an input that isn't a box, button or slider. */
function isTextField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
  return (
    element instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(element.type)
  );
}

function subscribe(handleChange: () => void): () => void {
  document.addEventListener("focusin", handleChange);
  document.addEventListener("focusout", handleChange);
  return () => {
    document.removeEventListener("focusin", handleChange);
    document.removeEventListener("focusout", handleChange);
  };
}

/**
 * True while a text field has the focus, which on a phone means the on-screen keyboard is up
 * (the terminal's hidden text area counts). Returns `false` during server rendering.
 *
 * @example
 * const isTyping = useIsTyping();
 */
export function useIsTyping(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isTextField(document.activeElement),
    () => false,
  );
}
