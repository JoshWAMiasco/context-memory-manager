"use client";

import { FileKey2, FileLock2 } from "lucide-react";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { mergeClassNames } from "@/utilities/merge-class-names";

function Choice({
  title,
  description,
  icon: Icon,
  isDisabled,
  disabledReason,
  onChoose,
  testId,
}: {
  title: string;
  description: string;
  icon: typeof FileKey2;
  isDisabled?: boolean;
  disabledReason?: string;
  onChoose: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onChoose}
      data-testid={testId}
      className={mergeClassNames(
        "flex w-full cursor-pointer gap-3 rounded-md border border-line p-4 text-left hover:border-brand hover:bg-surface-strong",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent",
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 flex-none text-foreground-muted" aria-hidden />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-foreground-muted">{isDisabled ? disabledReason : description}</span>
      </span>
    </button>
  );
}

/**
 * Downloading a file from an encrypted folder: decrypted (the folder must be unlocked),
 * or exactly as stored, still encrypted.
 *
 * @example
 * <EncryptedDownloadDialog fileName="notes.md" isUnlocked onDownload={download} onClose={close} />
 */
export function EncryptedDownloadDialog({
  fileName,
  isUnlocked,
  onDownload,
  onClose,
}: {
  fileName: string;
  isUnlocked: boolean;
  onDownload: (asStored: boolean) => void;
  onClose: () => void;
}) {
  const choose = (asStored: boolean) => {
    onClose();
    onDownload(asStored);
  };
  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Download "${fileName}"`} size="medium">
      <ModalBody>
        <div className="grid gap-3" data-testid="encrypted-download-dialog">
          <Choice
            title="Decrypted"
            description="The file as you see it in CCM. It will be plaintext on the computer you download it to."
            icon={FileKey2}
            isDisabled={!isUnlocked}
            disabledReason="Unlock the folder first to download the decrypted file."
            onChoose={() => choose(false)}
            testId="download-decrypted"
          />
          <Choice
            title="Encrypted (raw)"
            description="The bytes as stored, still encrypted. Only CCM with the key file can open it."
            icon={FileLock2}
            onChoose={() => choose(true)}
            testId="download-raw"
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalCloseButton>Cancel</ModalCloseButton>
      </ModalFooter>
    </Modal>
  );
}
