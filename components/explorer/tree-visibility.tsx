"use client";

import { createContext, useContext, useEffect } from "react";
import { isCommandShortcut } from "@/lib/client/shortcuts";

/** ⌘\ (Ctrl+\ elsewhere) hides or shows the file tree. */
export const TREE_TOGGLE_SHORTCUT = "Mod-\\";
const TREE_TOGGLE_KEY = "\\";

interface TreeVisibility {
  isTreeHidden: boolean;
  toggleTree: () => void;
}

/** Provided by the explorer's split and stacked views; the default does nothing. */
export const TreeVisibilityContext = createContext<TreeVisibility>({
  isTreeHidden: false,
  toggleTree: () => undefined,
});

/**
 * Whether the file tree is hidden and how to hide or show it: the tree toolbar's "Hide file tree"
 * button uses it (on narrow screens it closes the Files drawer).
 *
 * @example
 * const { toggleTree } = useTreeVisibility();
 */
export function useTreeVisibility(): TreeVisibility {
  return useContext(TreeVisibilityContext);
}

/**
 * Toggles the tree on ⌘\ / Ctrl+\ while the explorer is open.
 *
 * @example
 * useTreeToggleShortcut(toggleTree);
 */
export function useTreeToggleShortcut(toggleTree: () => void): void {
  useEffect(() => {
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (!isCommandShortcut(keyEvent, TREE_TOGGLE_KEY)) return;
      keyEvent.preventDefault();
      toggleTree();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTree]);
}
