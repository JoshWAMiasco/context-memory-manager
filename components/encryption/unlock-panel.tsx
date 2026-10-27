"use client";

import { LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/primitives/button";
import { FormErrorMessage, FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import {
  describeKeyFileError,
  KeyFileField,
  readKeyFileChoice,
  useKeyFileProtection,
} from "@/components/encryption/key-file-field";
import { announce } from "@/components/explorer/explorer-context";
import { ApiError } from "@/lib/client/api";
import { useEncryptionMutations } from "@/lib/client/encryption";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * What a locked encrypted folder shows instead of its content: the key file (and its
 * passphrase, when it has one), the account password and Unlock. Unlocking holds the unwrapped
 * key in memory for this session only, so the passphrase is typed once per unlock, never per file.
 *
 * @example
 * <UnlockPanel storageId={storageId} path="persona/notes.md" folderName="persona" />
 */
export function UnlockPanel({
  storageId,
  path: entryPath,
  folderName,
  message,
  onUnlocked,
  className,
}: {
  storageId: string;
  path: string;
  folderName: string;
  /** Replaces the default explanation (for example "Folder locked — unlock to save your changes"). */
  message?: string;
  onUnlocked?: () => void;
  className?: string;
}) {
  const { unlock } = useEncryptionMutations();
  const [keyFile, setKeyFile] = useState<File>();
  const [keyFilePassphrase, setKeyFilePassphrase] = useState("");
  const keyFileProtection = useKeyFileProtection(keyFile);
  const [password, setPassword] = useState("");
  const [keyFileError, setKeyFileError] = useState<string>();
  const [passphraseError, setPassphraseError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const keyFileChoice = readKeyFileChoice(keyFile, keyFilePassphrase, keyFileProtection);

  const chooseKeyFile = (file: File | undefined) => {
    setKeyFile(file);
    setKeyFilePassphrase("");
    setKeyFileError(undefined);
    setPassphraseError(undefined);
  };

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!keyFile) {
      setKeyFileError("Choose the folder's key file.");
      return;
    }
    if (!keyFileChoice) {
      setPassphraseError("Enter the key file's passphrase.");
      return;
    }
    setKeyFileError(undefined);
    setPassphraseError(undefined);
    setPasswordError(undefined);
    setFormError(undefined);
    try {
      await unlock.mutateAsync({ storageId, path: entryPath, keyFile: keyFileChoice, password });
      setPassword("");
      setKeyFilePassphrase("");
      announce("Unlocked", `"${folderName}" stays unlocked for this session until it locks again.`);
      onUnlocked?.();
    } catch (unlockError) {
      const keyFileProblem = describeKeyFileError(unlockError);
      if (unlockError instanceof ApiError && unlockError.code === "INVALID_CREDENTIALS") {
        setPasswordError("Wrong password.");
      } else if (keyFileProblem.fileError || keyFileProblem.passphraseError) {
        setKeyFileError(keyFileProblem.fileError);
        setPassphraseError(keyFileProblem.passphraseError);
      } else {
        setFormError(unlockError instanceof Error ? unlockError.message : "Couldn't unlock the folder.");
      }
    }
  };

  return (
    <div className={mergeClassNames("flex flex-1 items-center justify-center p-6", className)}>
      <form
        className="box w-full max-w-md p-6"
        data-testid="unlock-panel"
        onSubmit={(submitEvent) => void submit(submitEvent)}
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
            <LockKeyhole className="h-7 w-7 stroke-[1.5]" aria-hidden />
          </span>
          <h3 className="mt-3 text-lg font-medium">&ldquo;{folderName}&rdquo; is encrypted</h3>
          <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
            {message ??
              "Its files stay encrypted on disk. Unlock it with its key file and your password to view and edit them in this session."}
          </p>
        </div>
        <div className="mt-5 grid gap-4">
          <KeyFileField
            file={keyFile}
            onFile={chooseKeyFile}
            passphrase={keyFilePassphrase}
            onPassphraseChange={setKeyFilePassphrase}
            protection={keyFileProtection}
            testId="unlock-keyfile"
            fileError={keyFileError}
            passphraseError={passphraseError}
          />
          <div>
            <FormLabel htmlFor="unlock-password">Your password</FormLabel>
            <PasswordInput
              id="unlock-password"
              value={password}
              autoComplete="current-password"
              onChange={(changeEvent) => setPassword(changeEvent.target.value)}
              hasError={passwordError !== undefined}
            />
            <FormErrorMessage message={passwordError} />
          </div>
          <FormErrorMessage message={formError} />
          <Button
            type="submit"
            variant="primary"
            disabled={unlock.isPending || password === ""}
            data-testid="unlock-submit"
          >
            {unlock.isPending ? "Unlocking…" : "Unlock"}
          </Button>
        </div>
      </form>
    </div>
  );
}
