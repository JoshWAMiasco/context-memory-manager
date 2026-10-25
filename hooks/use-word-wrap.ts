"use client";

import { useCallback, useState } from "react";

const WORD_WRAP_STORAGE_KEY = "cmm.wordWrap";

function readStoredWordWrap(): boolean {
  try {
    return window.localStorage.getItem(WORD_WRAP_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The code viewer's word-wrap toggle, remembered in this browser.
 *
 * @example
 * const [isWrapped, toggleWrapped] = useWordWrap();
 */
export function useWordWrap(): [boolean, () => void] {
  const [isWrapped, setIsWrapped] = useState(readStoredWordWrap);
  const toggleWrapped = useCallback(() => {
    setIsWrapped((wasWrapped) => {
      try {
        window.localStorage.setItem(WORD_WRAP_STORAGE_KEY, String(!wasWrapped));
      } catch {
        /* Storage blocked: the choice lasts until the page reloads. */
      }
      return !wasWrapped;
    });
  }, []);
  return [isWrapped, toggleWrapped];
}
