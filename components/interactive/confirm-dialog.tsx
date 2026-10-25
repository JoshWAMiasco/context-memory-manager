"use client";

import { useState, type ReactNode } from "react";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Button, type ButtonVariant } from "@/components/primitives/button";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { ApiError } from "@/lib/client/api";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  /** Runs on confirm; the dialog shows its error and stays open if it throws. */
  onConfirm: () => Promise<unknown> | void;
  isConfirmDisabled?: boolean;
  testId?: string;
}

/**
 * A yes/no dialog for actions with consequences (move to trash, eject, delete permanently). It
 * shows a busy state while `onConfirm` runs, closes when it succeeds and shows the error when it
 * fails.
 *
 * @example
 * <ConfirmDialog isOpen={isOpen} onOpenChange={setIsOpen} title="Eject USB?" confirmLabel="Eject" onConfirm={eject}>
 *   Wait for the drive to disappear before unplugging it.
 * </ConfirmDialog>
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  children,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  isConfirmDisabled = false,
  testId,
}: ConfirmDialogProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const changeOpen = (nextIsOpen: boolean) => {
    if (isBusy) return;
    setErrorMessage(undefined);
    onOpenChange(nextIsOpen);
  };

  const confirm = async () => {
    setIsBusy(true);
    setErrorMessage(undefined);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (confirmError) {
      if (confirmError instanceof ApiError && confirmError.code === "STEP_UP_REQUIRED") {
        setErrorMessage("The action was not confirmed.");
      } else {
        setErrorMessage(confirmError instanceof Error ? confirmError.message : "Something went wrong.");
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={changeOpen} title={title} size="medium">
      <div data-testid={testId}>
        <ModalBody>
          <FormErrorAlert message={errorMessage} className="mb-4" />
          <div className="leading-relaxed text-foreground-muted">{children}</div>
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Cancel</ModalCloseButton>
          <Button variant={confirmVariant} disabled={isBusy || isConfirmDisabled} onClick={() => void confirm()}>
            {isBusy ? "Working…" : confirmLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
