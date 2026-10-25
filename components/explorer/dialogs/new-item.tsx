"use client";

import { NameDialog } from "@/components/explorer/dialogs/name-dialog";

/**
 * Asks for the name of a new file or folder (used where the tree's inline field isn't shown, such
 * as the file pane on small screens).
 *
 * @example
 * <NewItemDialog type="directory" onCreate={createFolder} onClose={close} />
 */
export function NewItemDialog({
  type,
  onCreate,
  onClose,
}: {
  type: "file" | "directory";
  onCreate: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  return (
    <NameDialog
      title={type === "file" ? "New file" : "New folder"}
      label={type === "file" ? "File name" : "Folder name"}
      submitLabel="Create"
      onSubmit={onCreate}
      onClose={onClose}
      testId="new-item-dialog"
    />
  );
}
