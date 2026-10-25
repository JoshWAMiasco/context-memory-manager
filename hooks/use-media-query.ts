"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tracks whether a CSS media query matches. Returns `false` during server rendering.
 *
 * @example
 * const isExtraLargeScreen = useMediaQuery("(min-width: 1280px)");
 */
export function useMediaQuery(mediaQuery: string): boolean {
  const subscribe = useCallback(
    (handleChange: () => void) => {
      const mediaQueryList = window.matchMedia(mediaQuery);
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    },
    [mediaQuery],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(mediaQuery).matches,
    () => false,
  );
}
