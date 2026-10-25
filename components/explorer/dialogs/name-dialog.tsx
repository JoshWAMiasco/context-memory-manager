"use client";

import { useState, type FormEvent } from "react";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { FormErrorMessage, FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { findNameProblem } from "@/lib/fs/validate-name";

/**
 * A modal that asks for one file or folder name, checked with the path-jail rules as you type.
 * The new-item and rename dialogs are built on it.
 *
 * @example
 * <NameDialog title="New folder" label="Folder name" submitLabel="Create" onSubmit={create} onClose={close} />
 */
export function NameDialog({
  title,
  label,
  initialName = "",
  submitLabel,
  onSubmit,
  onClose,
  testId,
}: {
  title: string;
  label: string;
  initialName?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<boolean>;
  onClose: () => void;
  testId?: string;
}) {
  const [name, setName] = useState(initialName);
  const [isTouched, setIsTouched] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const nameProblem = findNameProblem(name.trim());

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setIsTouched(true);
    if (nameProblem) return;
    setIsBusy(true);
    const isDone = await onSubmit(name.trim());
    setIsBusy(false);
    if (isDone) onClose();
  };

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={title}>
      <form onSubmit={(submitEvent) => void submit(submitEvent)} noValidate data-testid={testId}>
        <ModalBody>
          <FormLabel htmlFor="entry-name">{label}</FormLabel>
          <FormInput
            id="entry-name"
            value={name}
            autoFocus
            spellCheck={false}
            onChange={(changeEvent) => {
              setName(changeEvent.target.value);
              setIsTouched(true);
            }}
            hasError={isTouched && nameProblem !== undefined}
          />
          <FormErrorMessage message={isTouched ? nameProblem : undefined} />
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Cancel</ModalCloseButton>
          <Button type="submit" variant="primary" disabled={isBusy}>
            {isBusy ? "Working…" : submitLabel}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
