"use client";

import { CloseButton, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { OVERLAY_BACKDROP_CLASS_NAMES, OverlayTrigger, useOverlayOpenState } from "@/components/interactive/overlay-open-state";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type ModalSize = "small" | "medium" | "large" | "extra-large";

const modalSizeClassNames: Record<ModalSize, string> = {
  small: "sm:w-[300px]",
  medium: "sm:w-[460px]",
  large: "sm:w-[600px]",
  "extra-large": "sm:w-[600px] lg:w-[900px]",
};

export interface ModalProps {
  trigger?: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  title?: ReactNode;
  size?: ModalSize;
  isStatic?: boolean;
  panelClassName?: string;
  children: ReactNode;
}

/**
 * A centered dialog over a dimmed backdrop.
 *
 * Use it uncontrolled from a server page by giving it a `trigger`, or controlled from client code
 * with `isOpen` and `onOpenChange`. `isStatic` stops outside clicks and Escape from closing it.
 *
 * @example
 * <Modal trigger={<Button variant="danger">Delete user</Button>} title="Delete this user?">
 *   <ModalBody>This action cannot be undone.</ModalBody>
 *   <ModalFooter>
 *     <ModalCloseButton>Cancel</ModalCloseButton>
 *     <Button variant="danger" type="submit" form="delete-user-form">Delete</Button>
 *   </ModalFooter>
 * </Modal>
 *
 * @example
 * const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
 * <Modal isOpen={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} size="small">…</Modal>
 */
export function Modal({ trigger, isOpen, onOpenChange, title, size = "medium", isStatic = false, panelClassName, children }: ModalProps) {
  const [isCurrentlyOpen, setIsCurrentlyOpen] = useOverlayOpenState(isOpen, onOpenChange);
  const [isShakingStaticPanel, setIsShakingStaticPanel] = useState(false);

  const handleCloseRequest = () => {
    if (!isStatic) {
      setIsCurrentlyOpen(false);
      return;
    }
    setIsShakingStaticPanel(true);
    window.setTimeout(() => setIsShakingStaticPanel(false), 200);
  };

  return (
    <>
      {trigger && <OverlayTrigger trigger={trigger} onOpen={() => setIsCurrentlyOpen(true)} />}
      <Dialog open={isCurrentlyOpen} onClose={handleCloseRequest} className="relative z-[60]">
        <DialogBackdrop transition className={OVERLAY_BACKDROP_CLASS_NAMES} />
        <div className="fixed inset-0 overflow-y-auto">
          <DialogPanel
            transition
            className={mergeClassNames(
              "relative mx-auto mt-16 w-[90%] rounded-md bg-surface shadow-md transition-[margin-top,transform] duration-[0.4s,0.3s] data-closed:-mt-16",
              modalSizeClassNames[size],
              isShakingStaticPanel && "scale-[1.05]",
              panelClassName,
            )}
          >
            {title && <ModalHeader title={title} />}
            {children}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}

/**
 * The modal's title bar with a close button on the right.
 *
 * @example
 * <ModalHeader title="Broadcast Message" actions={<DropdownMenu trigger="…">…</DropdownMenu>} />
 */
export function ModalHeader({ title, actions, hasCloseButton = true, className }: { title: ReactNode; actions?: ReactNode; hasCloseButton?: boolean; className?: string }) {
  return (
    <div className={mergeClassNames("flex items-center border-b border-line/60 px-5 py-3", className)}>
      <DialogTitle as="h2" className="mr-auto text-base font-medium font-display">
        {title}
      </DialogTitle>
      {actions}
      {hasCloseButton && (
        <CloseButton aria-label="Close" className="ml-3 cursor-pointer text-foreground-subtle hover:text-foreground">
          <X className="h-5 w-5 stroke-[1.5]" />
        </CloseButton>
      )}
    </div>
  );
}

/**
 * The modal's main content area.
 *
 * @example
 * <ModalBody className="grid grid-cols-12 gap-4">…</ModalBody>
 */
export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={mergeClassNames("p-5", className)}>{children}</div>;
}

/**
 * The modal's bottom row of actions.
 *
 * @example
 * <ModalFooter><ModalCloseButton>Cancel</ModalCloseButton><Button variant="primary">Send</Button></ModalFooter>
 */
export function ModalFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={mergeClassNames("flex justify-end gap-2 border-t border-line/60 px-5 py-3 text-right", className)}>{children}</div>;
}

/**
 * A secondary-outline button that closes the surrounding `Modal` or `Slideover`.
 *
 * @example
 * <ModalCloseButton>Cancel</ModalCloseButton>
 */
export function ModalCloseButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <CloseButton
      className={mergeClassNames(
        "inline-flex w-20 cursor-pointer items-center justify-center rounded-md border border-secondary px-3 py-2 font-medium text-foreground-muted shadow-xs transition duration-200 focus:ring-4 focus:ring-primary/20 focus-visible:outline-hidden [&:hover:not(:disabled)]:bg-secondary/20",
        className,
      )}
    >
      {children}
    </CloseButton>
  );
}

