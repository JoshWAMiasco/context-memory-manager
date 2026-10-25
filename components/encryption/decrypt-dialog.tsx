"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { PasswordInput } from "@/components/primitives/password-input";
import { KeyFileDropzone } from "@/components/encryption/key-file-dropzone";
import type { JobSummary } from "@/lib/api-types";
import { useEncryptionMutations } from "@/lib/client/encryption";

/**
 * "Decrypt permanently": the key file (even when the folder is unlocked), the password
 * and the folder's name typed, then a job writes every file back as plaintext.
 *
 * @example
 * <DecryptDialog storageId={storageId} path="persona" folderName="persona" onStarted={setJob} onClose={close} />
 */
export function DecryptDialog({
  storageId,
  path: folderPath,
  folderName,
  onStarted,
  onClose,
}: {
  storageId: string;
  path: string;
  folderName: string;
  onStarted: (job: JobSummary) => void;
  onClose: () => void;
}) {
  const { decrypt } = useEncryptionMutations();
  const [keyFile, setKeyFile] = useState<File>();
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={`Decrypt "${folderName}" permanently?`}
      confirmLabel="Decrypt permanently"
      confirmVariant="danger"
      testId="decrypt-dialog"
      isConfirmDisabled={!keyFile || password === "" || confirmName.trim() !== folderName}
      onConfirm={async () => {
        if (!keyFile) return;
        const { job } = await decrypt.mutateAsync({ storageId, path: folderPath, keyFile, password, confirmName });
        onStarted(job);
      }}
    >
      <div className="grid gap-4">
        <p>
          Every file in this folder is written back to disk as plaintext, and the folder is no longer encrypted. Anyone
          who can read the disk can then read the files.
        </p>
        <p className="text-sm text-foreground-muted">
          It runs in the background, so large folders don&rsquo;t keep you waiting: the folder shows its progress, and
          nothing inside can be changed until it finishes.
        </p>
        <KeyFileDropzone file={keyFile} onFile={setKeyFile} testId="decrypt-key" />
        <div>
          <FormLabel htmlFor="decrypt-password">Your password</FormLabel>
          <PasswordInput
            id="decrypt-password"
            value={password}
            autoComplete="current-password"
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
        </div>
        <div>
          <FormLabel htmlFor="decrypt-name">
            Type <strong>{folderName}</strong> to confirm
          </FormLabel>
          <FormInput
            id="decrypt-name"
            value={confirmName}
            autoComplete="off"
            onChange={(changeEvent) => setConfirmName(changeEvent.target.value)}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
