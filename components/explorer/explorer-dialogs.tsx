"use client";

import { useEffect } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { EnableEncryptionWizard } from "@/components/encryption/enable-encryption-wizard";
import { EncryptedDownloadDialog } from "@/components/encryption/encrypted-download-dialog";
import { FolderSettingsSlideover } from "@/components/folder-settings/folder-settings-slideover";
import { GitRequiredDialog } from "@/components/versioning/git-required-dialog";
import { NewMemoryDialog } from "@/components/memory/new-memory-dialog";
import { useExplorer } from "@/components/explorer/explorer-context";
import { DeleteConfirmDialog } from "@/components/explorer/dialogs/delete-confirm";
import { NewItemDialog } from "@/components/explorer/dialogs/new-item";
import { PropertiesDialog } from "@/components/explorer/dialogs/properties";
import { RenameDialog } from "@/components/explorer/dialogs/rename";
import { useFileMutations } from "@/lib/client/fs";
import { joinEntryPath, readBaseName } from "@/lib/client/query-keys";
import { announceError } from "@/components/explorer/explorer-context";

/**
 * Renders the explorer dialog that is open, if any: move to Trash, new item, rename, properties,
 * new memory or convert to memory, Folder settings, the Enable encryption wizard, the encrypted
 * download choice and the "this copy will be decrypted" confirmation. Cmd/Ctrl+, opens Folder
 * settings for the selected folder.
 *
 * @example
 * <ExplorerDialogs />
 */
export function ExplorerDialogs() {
  const explorer = useExplorer();
  const { createFile, createFolder } = useFileMutations();
  const { dialog, storage, selectedPath, findEntry, openDialog } = explorer;
  const close = () => explorer.openDialog(undefined);

  useEffect(() => {
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (!(keyEvent.metaKey || keyEvent.ctrlKey) || keyEvent.key !== "," || selectedPath === "") return;
      if (findEntry(selectedPath)?.type !== "directory") return;
      keyEvent.preventDefault();
      openDialog({ kind: "folder-settings", path: selectedPath });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [findEntry, openDialog, selectedPath]);

  if (!dialog) return null;
  if (dialog.kind === "delete")
    return <DeleteConfirmDialog paths={dialog.paths} onClose={close} onConfirm={explorer.deletePaths} />;
  if (dialog.kind === "rename") {
    return (
      <RenameDialog
        currentName={readBaseName(dialog.path)}
        onClose={close}
        onRename={(newName) => explorer.commitRename(dialog.path, newName)}
      />
    );
  }
  if (dialog.kind === "new-item") {
    return (
      <NewItemDialog
        type={dialog.type}
        onClose={close}
        onCreate={async (name) => {
          const entryPath = joinEntryPath(dialog.parentPath, name);
          try {
            const mutation = dialog.type === "file" ? createFile : createFolder;
            await mutation.mutateAsync({ storageId: storage.id, path: entryPath });
            explorer.selectPath(entryPath);
            return true;
          } catch (createError) {
            announceError("Couldn't create it", createError);
            return false;
          }
        }}
      />
    );
  }
  if (dialog.kind === "new-memory" || dialog.kind === "convert-memory") {
    return (
      <NewMemoryDialog
        storageId={storage.id}
        target={
          dialog.kind === "new-memory"
            ? { kind: "create", parentPath: dialog.parentPath }
            : { kind: "convert", path: dialog.path, folderName: readBaseName(dialog.path) }
        }
        onDone={(memoryPath) => {
          if (dialog.kind === "new-memory" && dialog.parentPath !== "") explorer.setExpanded(dialog.parentPath, true);
          explorer.selectPath(memoryPath);
        }}
        onClose={close}
      />
    );
  }
  if (dialog.kind === "folder-settings") {
    return <FolderSettingsSlideover path={dialog.path} initialTab={dialog.tab} onClose={close} />;
  }
  if (dialog.kind === "encrypt-folder") {
    return (
      <EnableEncryptionWizard
        storageId={storage.id}
        path={dialog.path}
        folderName={readBaseName(dialog.path)}
        onClose={close}
      />
    );
  }
  if (dialog.kind === "enable-versioning") {
    return <GitRequiredDialog path={dialog.path} onClose={close} />;
  }
  if (dialog.kind === "download-encrypted") {
    return (
      <EncryptedDownloadDialog
        fileName={readBaseName(dialog.path)}
        isUnlocked={dialog.isUnlocked}
        onDownload={(asStored) => void explorer.download(dialog.path, { asStored })}
        onClose={close}
      />
    );
  }
  if (dialog.kind === "confirm-decrypt") {
    const { transfer } = dialog;
    return (
      <ConfirmDialog
        isOpen
        onOpenChange={(isOpen) => !isOpen && close()}
        title={transfer.kind === "move" ? "Move out of the encrypted folder?" : "Copy out of the encrypted folder?"}
        confirmLabel={transfer.kind === "move" ? "Move and decrypt" : "Copy and decrypt"}
        confirmVariant="danger"
        testId="confirm-decrypt-dialog"
        onConfirm={async () => {
          await explorer.transfer(transfer.kind, transfer.sources, transfer.destination, { confirmDecrypt: true });
        }}
      >
        {dialog.message} Anyone who can read that folder on disk can read{" "}
        {transfer.sources.length === 1 ? "it" : "them"}.
      </ConfirmDialog>
    );
  }
  return <PropertiesDialog storageId={storage.id} storageLabel={storage.label} path={dialog.path} onClose={close} />;
}
