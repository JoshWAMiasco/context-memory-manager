"use client";

import { FolderInput } from "lucide-react";
import { useState } from "react";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { FormLabel } from "@/components/primitives/form-field";
import { FormSelect } from "@/components/primitives/form-select";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { useExplorer } from "@/components/explorer/explorer-context";
import { FolderPicker } from "@/components/explorer/folder-picker";
import { useStorages, type StoragePath } from "@/lib/client/fs";
import { readBusyFolders, useJobs } from "@/lib/client/jobs";
import { findMoveProblem } from "@/lib/client/move";
import { readBaseName, readParentPath } from "@/lib/client/query-keys";

/**
 * "Move to…": pick a destination folder, in this storage or another writable one, for the
 * selected entries. The move itself goes through the explorer's `transfer`, so leaving an
 * encrypted folder still asks for confirmation, and a cross-disk move becomes a background job
 * that keeps the source and destination folders busy until it ends.
 *
 * @example
 * <MoveDialog paths={["notes/a.md", "notes/b.md"]} onClose={close} />
 */
export function MoveDialog({ paths, onClose }: { paths: readonly string[]; onClose: () => void }) {
  const explorer = useExplorer();
  const { data: storages = [] } = useStorages();
  const { data: jobs = [] } = useJobs();
  const firstPath = paths[0] ?? "";
  const [destinationStorageId, setDestinationStorageId] = useState(explorer.storage.id);
  const [destinationPath, setDestinationPath] = useState(readParentPath(firstPath));
  const [isMoving, setIsMoving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const writableStorages = storages.filter((storage) => storage.available && storage.access === "write");
  const destinationStorage =
    writableStorages.find((storage) => storage.id === destinationStorageId) ?? explorer.storage;
  const sources: StoragePath[] = paths.map((path) => ({ storageId: explorer.storage.id, path }));
  const destination: StoragePath = { storageId: destinationStorage.id, path: destinationPath };
  const problem = findMoveProblem(sources, destination, readBusyFolders(jobs, destinationStorage.id));
  const subject = paths.length === 1 ? `"${readBaseName(firstPath)}"` : `${paths.length} items`;
  const destinationName = destinationPath === "" ? destinationStorage.label : readBaseName(destinationPath);

  const move = async () => {
    setIsMoving(true);
    setErrorMessage(undefined);
    try {
      const result = await explorer.transfer("move", sources, destination);
      // Undefined: the explorer showed the error, or swapped this dialog for the decrypt confirmation.
      if (result) onClose();
    } catch (moveError) {
      setErrorMessage(moveError instanceof Error ? moveError.message : "Couldn't move.");
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && !isMoving && onClose()} title={`Move ${subject}`} size="medium">
      <div data-testid="move-dialog">
        <ModalBody>
          <div className="grid gap-4">
            <FormErrorAlert message={errorMessage} />
            {writableStorages.length > 1 && (
              <div>
                <FormLabel htmlFor="move-storage">Storage</FormLabel>
                <FormSelect
                  id="move-storage"
                  value={destinationStorage.id}
                  onChange={(changeEvent) => {
                    setDestinationStorageId(changeEvent.target.value);
                    setDestinationPath("");
                  }}
                  options={writableStorages.map((storage) => ({ value: storage.id, label: storage.label }))}
                  data-testid="move-storage"
                />
              </div>
            )}
            <div>
              <FormLabel>Destination folder</FormLabel>
              <FolderPicker
                storageId={destinationStorage.id}
                storageLabel={destinationStorage.label}
                value={destinationPath}
                onChange={setDestinationPath}
                testId="move-folder-picker"
              />
            </div>
            <p className="text-sm text-foreground-muted" data-testid="move-summary">
              {problem ?? (
                <>
                  Move {subject} to <strong>{destinationName}</strong>
                  {destinationStorage.id === explorer.storage.id ? "" : ` on ${destinationStorage.label}`}. A move to
                  another disk runs in the background; both folders stay busy until it finishes.
                </>
              )}
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Cancel</ModalCloseButton>
          <Button
            variant="primary"
            disabled={isMoving || problem !== undefined}
            leadingIcon={<FolderInput className="mr-1.5 h-4 w-4" />}
            onClick={() => void move()}
            data-testid="move-confirm"
          >
            {isMoving ? "Moving…" : "Move here"}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
