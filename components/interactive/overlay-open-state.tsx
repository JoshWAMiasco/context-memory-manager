"use client";

import { useState, type ReactNode } from "react";

/**
 * The dimmed, slightly blurred backdrop behind modals and slideovers.
 */
export const OVERLAY_BACKDROP_CLASS_NAMES =
  "fixed inset-0 bg-canvas/80 backdrop-blur-[2px] transition-opacity duration-400 data-closed:opacity-0 data-closed:duration-200";

/**
 * Open state for overlays that can be controlled (`isOpen` + `onOpenChange`) or uncontrolled
 * (opened by a `trigger`). Used by `Modal` and `Slideover`.
 *
 * @example
 * const [isCurrentlyOpen, setIsCurrentlyOpen] = useOverlayOpenState(isOpen, onOpenChange);
 */
export function useOverlayOpenState(isOpen: boolean | undefined, onOpenChange: ((isOpen: boolean) => void) | undefined) {
  const [isUncontrolledOpen, setIsUncontrolledOpen] = useState(false);
  const isControlled = isOpen !== undefined;
  const isCurrentlyOpen = isControlled ? isOpen : isUncontrolledOpen;
  const setIsCurrentlyOpen = (nextIsOpen: boolean) => {
    if (!isControlled) setIsUncontrolledOpen(nextIsOpen);
    onOpenChange?.(nextIsOpen);
  };
  return [isCurrentlyOpen, setIsCurrentlyOpen] as const;
}

/**
 * Wraps the element that opens an overlay; a click anywhere inside `trigger` calls `onOpen`.
 * Uses `display: contents`, so the wrapper never affects layout.
 *
 * @example
 * <OverlayTrigger trigger={<Button>Open</Button>} onOpen={() => setIsCurrentlyOpen(true)} />
 */
export function OverlayTrigger({ trigger, onOpen }: { trigger: ReactNode; onOpen: () => void }) {
  return (
    <span className="contents" onClick={onOpen}>
      {trigger}
    </span>
  );
}
