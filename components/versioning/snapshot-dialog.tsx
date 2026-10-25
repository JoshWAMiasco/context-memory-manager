"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { announce, useExplorer } from "@/components/explorer/explorer-context";
import { useVersioningMutations } from "@/lib/client/versioning";

/**
 * "Create snapshot…": a named point in the folder's history, with whatever changed since
 * the last commit.
 *
 * @example
 * <SnapshotDialog path="persona" onClose={close} />
 */
export function SnapshotDialog({ path: folderPath, onClose }: { path: string; onClose: () => void }) {
  const { storage } = useExplorer();
  const { snapshot } = useVersioningMutations();
  const [message, setMessage] = useState("");
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title="Create snapshot"
      confirmLabel="Create snapshot"
      testId="snapshot-dialog"
      isConfirmDisabled={message.trim() === ""}
      onConfirm={async () => {
        await snapshot.mutateAsync({ storageId: storage.id, path: folderPath, message });
        announce("Snapshot created", message.trim());
      }}
    >
      <FormLabel htmlFor="snapshot-message">Name this point in the history</FormLabel>
      <FormInput
        id="snapshot-message"
        value={message}
        maxLength={200}
        placeholder="Before reorganising the notes"
        autoComplete="off"
        onChange={(changeEvent) => setMessage(changeEvent.target.value)}
      />
    </ConfirmDialog>
  );
}
