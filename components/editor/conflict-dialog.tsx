"use client";

import { useEffect, useState } from "react";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { announceError } from "@/components/explorer/explorer-context";
import { CompareView } from "@/components/editor/compare-view";
import type { FileDocument } from "@/hooks/use-file-document";
import type { TextFileResponse } from "@/lib/api-types";

/**
 * Shown when a save hit a newer version on disk (412) or when the user asks to deal with a change
 * made on disk while editing. Reload from disk (losing my changes), Overwrite (save mine
 * over it), or Compare: disk and mine side by side, copy chunks across, then save the result over
 * the version compared.
 *
 * @example
 * {fileDocument.conflict && <ConflictDialog fileDocument={fileDocument} fileName="a.md" language="markdown" />}
 */
export function ConflictDialog({
  fileDocument,
  fileName,
  language,
  startsInCompare = false,
}: {
  fileDocument: FileDocument;
  fileName: string;
  language?: string;
  /** Opens straight into Compare (from the "changed on disk" banner). */
  startsInCompare?: boolean;
}) {
  const [diskVersion, setDiskVersion] = useState<TextFileResponse>();
  const [mergedText, setMergedText] = useState(fileDocument.content);
  const [isBusy, setIsBusy] = useState(false);

  const { readDiskVersion, content } = fileDocument;

  const close = () => fileDocument.openConflict(undefined);

  const openCompare = async () => {
    setIsBusy(true);
    try {
      setDiskVersion(await readDiskVersion());
      setMergedText(content);
    } catch (readError) {
      announceError("Couldn't read the version on disk", readError);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!startsInCompare) return;
    readDiskVersion().then(setDiskVersion, (readError: unknown) =>
      announceError("Couldn't read the version on disk", readError),
    );
  }, [readDiskVersion, startsInCompare]);

  const saveMerged = async () => {
    if (!diskVersion) return;
    setIsBusy(true);
    await fileDocument.saveMerge(mergedText, diskVersion.etag);
    setIsBusy(false);
  };

  return (
    <Modal
      isOpen
      isStatic
      onOpenChange={(isOpen) => !isOpen && close()}
      title={diskVersion ? `Compare “${fileName}”` : `“${fileName}” changed on disk`}
      size={diskVersion ? "extra-large" : "large"}
      panelClassName={diskVersion ? "lg:w-[min(1200px,95vw)]" : undefined}
    >
      <div data-testid="conflict-dialog">
        {diskVersion ? (
          <CompareView
            diskText={diskVersion.content}
            myText={fileDocument.content}
            language={language}
            fileName={fileName}
            onChange={setMergedText}
          />
        ) : (
          <ModalBody>
            <p className="leading-relaxed text-foreground-muted">
              The file was saved somewhere else after you opened it. Your changes aren&rsquo;t saved yet. Reload the
              version on disk (your changes are lost), overwrite it with yours, or compare the two.
            </p>
          </ModalBody>
        )}
        <ModalFooter>
          {diskVersion ? (
            <>
              <Button variant="outline-secondary" onClick={() => setDiskVersion(undefined)} disabled={isBusy}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => void saveMerged()}
                disabled={isBusy}
                data-testid="conflict-save-merged"
              >
                Save this version
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline-secondary" onClick={close} disabled={isBusy}>
                Cancel
              </Button>
              <Button
                variant="outline-primary"
                onClick={() => void openCompare()}
                disabled={isBusy}
                data-testid="conflict-compare"
              >
                Compare
              </Button>
              <Button
                variant="outline-danger"
                onClick={() => fileDocument.reload()}
                disabled={isBusy}
                data-testid="conflict-reload"
              >
                Reload from disk
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setIsBusy(true);
                  void fileDocument.overwrite().finally(() => setIsBusy(false));
                }}
                disabled={isBusy}
                data-testid="conflict-overwrite"
              >
                Overwrite
              </Button>
            </>
          )}
        </ModalFooter>
      </div>
    </Modal>
  );
}
