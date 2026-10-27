"use client";

import { useEffect, useId, useState } from "react";
import { KeyFileDropzone } from "@/components/encryption/key-file-dropzone";
import { FormErrorMessage, FormHelpText, FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import { ApiError } from "@/lib/client/api";
import { readKeyFileProtectionOf, type KeyFileChoice } from "@/lib/client/encryption";
import type { KeyFileProtection } from "@/lib/key-file";

/**
 * Whether the chosen key file asks for a passphrase: undefined while it is being read.
 *
 * @example
 * const protection = useKeyFileProtection(keyFile);
 * const needsPassphrase = protection === "passphrase";
 */
export function useKeyFileProtection(file: File | undefined): KeyFileProtection | undefined {
  const [protection, setProtection] = useState<{ file: File; protection: KeyFileProtection }>();
  useEffect(() => {
    if (!file) return;
    let isCurrent = true;
    void readKeyFileProtectionOf(file).then((readProtection) => {
      if (isCurrent) setProtection({ file, protection: readProtection });
    });
    return () => {
      isCurrent = false;
    };
  }, [file]);
  return file && protection?.file === file ? protection.protection : undefined;
}

/**
 * Describes a key file error from the server for its field: the file ("doesn't belong"), or its
 * passphrase (missing or wrong). Other errors are left for the form.
 *
 * @example
 * const { fileError, passphraseError } = describeKeyFileError(unlockError);
 */
export function describeKeyFileError(requestError: unknown): { fileError?: string; passphraseError?: string } {
  if (!(requestError instanceof ApiError)) return {};
  if (requestError.code === "WRONG_KEY_FILE") {
    return {
      fileError: requestError.message.includes("belong")
        ? "Key file doesn't belong to this folder."
        : requestError.message,
    };
  }
  if (requestError.code === "WRONG_PASSPHRASE") return { passphraseError: "Wrong passphrase for this key file." };
  if (requestError.code === "KEY_FILE_PASSPHRASE_REQUIRED")
    return { passphraseError: "Enter the key file's passphrase." };
  return {};
}

/**
 * A key file choice ready to send, or undefined while a file or a needed passphrase is missing.
 *
 * @example
 * const keyFileChoice = readKeyFileChoice(keyFile, passphrase, useKeyFileProtection(keyFile));
 */
export function readKeyFileChoice(
  file: File | undefined,
  passphrase: string,
  protection: KeyFileProtection | undefined,
): KeyFileChoice | undefined {
  if (!file) return undefined;
  if (protection === "passphrase" && passphrase === "") return undefined;
  return protection === "passphrase" ? { file, passphrase } : { file };
}

/**
 * A key file dropzone that asks for the file's passphrase when it is a passphrase-protected
 * (v2) key file, and nothing more for a raw one. The passphrase is sent to the server once, with
 * the file; the unwrapped key then stays in memory for the unlock time.
 *
 * @example
 * const protection = useKeyFileProtection(keyFile);
 * <KeyFileField file={keyFile} onFile={setKeyFile} passphrase={passphrase} onPassphraseChange={setPassphrase} protection={protection} />
 */
export function KeyFileField({
  file,
  onFile,
  passphrase,
  onPassphraseChange,
  protection,
  label,
  testId = "keyfile",
  isDisabled = false,
  fileError,
  passphraseError,
}: {
  file?: File;
  onFile: (file: File | undefined) => void;
  passphrase: string;
  onPassphraseChange: (passphrase: string) => void;
  protection: KeyFileProtection | undefined;
  label?: string;
  testId?: string;
  isDisabled?: boolean;
  fileError?: string;
  passphraseError?: string;
}) {
  const passphraseId = useId();
  const needsPassphrase = file !== undefined && protection === "passphrase";
  return (
    <div className="grid gap-3">
      <div>
        <KeyFileDropzone
          file={file}
          onFile={onFile}
          label={label}
          testId={`${testId}-dropzone`}
          isDisabled={isDisabled}
        />
        <FormErrorMessage message={fileError} />
      </div>
      {needsPassphrase && (
        <div data-testid={`${testId}-passphrase`}>
          <FormLabel htmlFor={passphraseId}>Key file passphrase</FormLabel>
          <PasswordInput
            id={passphraseId}
            value={passphrase}
            autoComplete="off"
            disabled={isDisabled}
            onChange={(changeEvent) => onPassphraseChange(changeEvent.target.value)}
            hasError={passphraseError !== undefined}
          />
          <FormHelpText>This key file is protected by a passphrase. It is needed once, to unlock.</FormHelpText>
          <FormErrorMessage message={passphraseError} />
        </div>
      )}
    </div>
  );
}
