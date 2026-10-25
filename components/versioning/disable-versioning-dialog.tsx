"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { FormRadio } from "@/components/primitives/form-check";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { announce, useExplorer } from "@/components/explorer/explorer-context";
import { useVersioningMutations } from "@/lib/client/versioning";

const DELETE_CONFIRM_TEXT = "DELETE HISTORY";

/**
 * Turning versioning off: "Keep history (archive)" moves `.git` into
 * `.ccm/git-archive/`, where turning it on again offers it back; "Delete history permanently"
 * needs `DELETE HISTORY` typed. The files themselves are never touched.
 *
 * @example
 * <DisableVersioningDialog path="persona" folderName="Persona" onClose={close} />
 */
export function DisableVersioningDialog({
  path: folderPath,
  folderName,
  onClose,
}: {
  path: string;
  folderName: string;
  onClose: () => void;
}) {
  const { storage } = useExplorer();
  const { disable } = useVersioningMutations();
  const [mode, setMode] = useState<"archive" | "delete">("archive");
  const [confirmText, setConfirmText] = useState("");
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={`Turn off versioning for "${folderName}"?`}
      confirmLabel={mode === "archive" ? "Turn off and keep history" : "Turn off and delete history"}
      confirmVariant={mode === "archive" ? "primary" : "danger"}
      testId="disable-versioning-dialog"
      isConfirmDisabled={mode === "delete" && confirmText !== DELETE_CONFIRM_TEXT}
      onConfirm={async () => {
        await disable.mutateAsync({ storageId: storage.id, path: folderPath, mode, confirmText });
        announce(
          "Versioning is off",
          mode === "archive" ? "The history was kept in .ccm/git-archive/." : "The history was deleted.",
        );
      }}
    >
      <div className="grid gap-3">
        <p>Changes stop being recorded. Your files stay exactly as they are.</p>
        <FormRadio
          id="disable-archive"
          name="disable-mode"
          label="Keep history (archive)"
          description="Moved into .ccm/git-archive/ inside the folder. Turning versioning on again offers it back."
          checked={mode === "archive"}
          onChange={() => setMode("archive")}
        />
        <FormRadio
          id="disable-delete"
          name="disable-mode"
          label="Delete history permanently"
          description="Every earlier version is gone for good."
          checked={mode === "delete"}
          onChange={() => setMode("delete")}
        />
        {mode === "delete" && (
          <div>
            <FormLabel htmlFor="disable-confirm-text">
              Type <strong>{DELETE_CONFIRM_TEXT}</strong> to confirm
            </FormLabel>
            <FormInput
              id="disable-confirm-text"
              value={confirmText}
              autoComplete="off"
              onChange={(changeEvent) => setConfirmText(changeEvent.target.value)}
            />
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
