"use client";

import { useSyncExternalStore } from "react";
import type { StoragePath } from "@/lib/client/fs";

export interface FileClipboard {
  mode: "copy" | "cut";
  items: readonly StoragePath[];
}

let clipboard: FileClipboard | undefined;
const listeners = new Set<() => void>();

/** Puts entries on the explorer's clipboard (Copy or Cut); Paste reads them back. */
export function setFileClipboard(nextClipboard: FileClipboard | undefined): void {
  clipboard = nextClipboard;
  for (const listener of listeners) listener();
}

export function readFileClipboard(): FileClipboard | undefined {
  return clipboard;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The explorer clipboard (client-side only, per tab).
 *
 * @example
 * const clipboard = useFileClipboard();
 * const canPaste = clipboard !== undefined;
 */
export function useFileClipboard(): FileClipboard | undefined {
  return useSyncExternalStore(subscribe, readFileClipboard, () => undefined);
}
