"use client";

import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { readBaseName } from "@/lib/client/query-keys";

/**
 * "Move N items to Trash?". Nothing is deleted for good: the items can be restored from
 * Trash.
 *
 * @example
 * <DeleteConfirmDialog paths={["notes/a.md"]} onClose={close} onConfirm={deletePaths} />
 */
export function DeleteConfirmDialog({
  paths,
  onClose,
  onConfirm,
}: {
  paths: readonly string[];
  onClose: () => void;
  onConfirm: (paths: readonly string[]) => Promise<void>;
}) {
  const subject = paths.length === 1 ? `"${readBaseName(paths[0] ?? "")}"` : `${paths.length} items`;
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={`Move ${subject} to Trash?`}
      confirmLabel="Move to Trash"
      confirmVariant="danger"
      testId="delete-dialog"
      onConfirm={() => onConfirm(paths)}
    >
      You can restore {paths.length === 1 ? "it" : "them"} from Trash.
    </ConfirmDialog>
  );
}
