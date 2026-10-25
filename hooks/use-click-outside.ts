"use client";

import { useEffect, type RefObject } from "react";

/**
 * Calls `handleClickOutside` when a pointer press happens outside the referenced element.
 *
 * @example
 * const panelReference = useRef<HTMLDivElement>(null);
 * useClickOutside(panelReference, () => setIsOpen(false));
 */
export function useClickOutside(elementReference: RefObject<HTMLElement | null>, handleClickOutside: () => void): void {
  useEffect(() => {
    const handlePointerDown = (pointerEvent: PointerEvent) => {
      if (elementReference.current && !elementReference.current.contains(pointerEvent.target as Node)) {
        handleClickOutside();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [elementReference, handleClickOutside]);
}
