"use client";

import { NameDialog } from "@/components/explorer/dialogs/name-dialog";

/**
 * Renames one file or folder in its folder.
 *
 * @example
 * <RenameDialog currentName="notes.md" onRename={rename} onClose={close} />
 */
export function RenameDialog({
  currentName,
  onRename,
  onClose,
}: {
  currentName: string;
  onRename: (newName: string) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <NameDialog
      title={`Rename "${currentName}"`}
      label="New name"
      initialName={currentName}
      submitLabel="Rename"
      onSubmit={onRename}
      onClose={onClose}
      testId="rename-dialog"
    />
  );
}
