"use client";

import { RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/primitives/button";
import { FormErrorMessage, FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import { KeyFileDropzone } from "@/components/encryption/key-file-dropzone";
import { announce } from "@/components/explorer/explorer-context";
import type { EncryptionState, JobSummary } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { useEncryptionMutations } from "@/lib/client/encryption";

const ACTIVITY: Record<Exclude<EncryptionState, "encrypted">, string> = {
  encrypting: "Encryption",
  decrypting: "Decryption",
  rekeying: "Re-keying",
};

/**
 * "Resume encryption": a job interrupted by a restart (or stopped) needs the key file
 * and password again, and a re-key also the new key file. Files already done are skipped.
 *
 * @example
 * <ResumeEncryptionForm storageId={storageId} path="persona" state="encrypting" onResumed={setJob} />
 */
export function ResumeEncryptionForm({
  storageId,
  path: folderPath,
  state,
  onResumed,
}: {
  storageId: string;
  path: string;
  state: Exclude<EncryptionState, "encrypted">;
  onResumed: (job: JobSummary) => void;
}) {
  const { resume } = useEncryptionMutations();
  const [keyFile, setKeyFile] = useState<File>();
  const [newKeyFile, setNewKeyFile] = useState<File>();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const isRekey = state === "rekeying";

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!keyFile) return;
    setErrorMessage(undefined);
    try {
      const { job } = await resume.mutateAsync({ storageId, path: folderPath, keyFile, newKeyFile, password });
      setPassword("");
      announce(`${ACTIVITY[state]} resumed`);
      onResumed(job);
    } catch (resumeError) {
      setErrorMessage(
        resumeError instanceof ApiError && resumeError.code === "INVALID_CREDENTIALS"
          ? "Wrong password."
          : resumeError instanceof Error
            ? resumeError.message
            : "Couldn't resume.",
      );
    }
  };

  return (
    <form
      className="grid gap-4 rounded-md border border-warning/40 bg-warning/5 p-4"
      data-testid="resume-encryption"
      onSubmit={(submitEvent) => void submit(submitEvent)}
    >
      <div className="text-sm leading-relaxed">
        <div className="font-medium">{ACTIVITY[state]} was interrupted</div>
        <span className="text-foreground-muted">
          Files can&rsquo;t be changed until it finishes. CMM doesn&rsquo;t keep keys, so choose the key file
          {isRekey ? "s" : ""} again to continue; files already done are skipped.
        </span>
      </div>
      <KeyFileDropzone
        label={isRekey ? "Old key file" : "Key file"}
        file={keyFile}
        onFile={setKeyFile}
        testId="resume-key"
      />
      {isRekey && (
        <KeyFileDropzone label="New key file" file={newKeyFile} onFile={setNewKeyFile} testId="resume-new-key" />
      )}
      <div>
        <FormLabel htmlFor="resume-password">Your password</FormLabel>
        <PasswordInput
          id="resume-password"
          value={password}
          autoComplete="current-password"
          onChange={(changeEvent) => setPassword(changeEvent.target.value)}
        />
      </div>
      <FormErrorMessage message={errorMessage} />
      <Button
        type="submit"
        variant="primary"
        className="w-fit"
        disabled={resume.isPending || !keyFile || password === "" || (isRekey && !newKeyFile)}
        leadingIcon={<RotateCcw className="mr-1.5 h-4 w-4" />}
        data-testid="resume-submit"
      >
        {resume.isPending ? "Resuming…" : `Resume ${ACTIVITY[state].toLowerCase()}`}
      </Button>
    </form>
  );
}
