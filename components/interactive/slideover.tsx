"use client";

import { CloseButton, Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { ModalHeader } from "@/components/interactive/modal";
import { OVERLAY_BACKDROP_CLASS_NAMES, OverlayTrigger, useOverlayOpenState } from "@/components/interactive/overlay-open-state";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type SlideoverSize = "small" | "medium" | "large" | "extra-large";
export type SlideoverSide = "right" | "left";

const slideoverSizeClassNames: Record<SlideoverSize, string> = {
  small: "sm:w-[300px]",
  medium: "sm:w-[460px]",
  large: "sm:w-[600px]",
  "extra-large": "sm:w-[600px] lg:w-[900px]",
};

export interface SlideoverProps {
  trigger?: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  title?: ReactNode;
  size?: SlideoverSize;
  side?: SlideoverSide;
  hasOutsideCloseButton?: boolean;
  panelClassName?: string;
  children: ReactNode;
}

/**
 * A full-height panel that slides in from the side. Same API as `Modal`; reuse `ModalBody`,
 * `ModalFooter` and `ModalCloseButton` inside it. `hasOutsideCloseButton` adds an
 * large rotating close button floating beside the panel.
 *
 * @example
 * <Slideover trigger={<Button variant="primary">Show filters</Button>} title="Filters" size="large">
 *   <ModalBody>…</ModalBody>
 *   <ModalFooter><ModalCloseButton>Close</ModalCloseButton></ModalFooter>
 * </Slideover>
 */
export function Slideover({ trigger, isOpen, onOpenChange, title, size = "medium", side = "right", hasOutsideCloseButton = false, panelClassName, children }: SlideoverProps) {
  const [isCurrentlyOpen, setIsCurrentlyOpen] = useOverlayOpenState(isOpen, onOpenChange);
  return (
    <>
      {trigger && <OverlayTrigger trigger={trigger} onOpen={() => setIsCurrentlyOpen(true)} />}
      <Dialog open={isCurrentlyOpen} onClose={() => setIsCurrentlyOpen(false)} className="relative z-[60]">
        <DialogBackdrop transition className={OVERLAY_BACKDROP_CLASS_NAMES} />
        <DialogPanel
          transition
          className={mergeClassNames(
            "fixed inset-y-0 flex h-screen w-[90%] flex-col bg-surface shadow-md transition-[margin] duration-[0.6s]",
            side === "right" ? "right-0 data-closed:-mr-[100%]" : "left-0 data-closed:-ml-[100%]",
            slideoverSizeClassNames[size],
            panelClassName,
          )}
        >
          {hasOutsideCloseButton && (
            <CloseButton
              aria-label="Close panel"
              className="absolute inset-y-0 right-auto left-0 my-auto -ml-[60px] flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-on-primary/90 bg-on-primary/5 text-on-primary/90 transition-all hover:scale-105 hover:rotate-180 hover:bg-on-primary/10 focus:outline-hidden sm:-ml-[105px] sm:h-14 sm:w-14"
            >
              <X className="h-8 w-8 stroke-[1]" />
            </CloseButton>
          )}
          {title && <ModalHeader title={title} hasCloseButton={!hasOutsideCloseButton} className="px-6 py-5" />}
          <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
        </DialogPanel>
      </Dialog>
    </>
  );
}
