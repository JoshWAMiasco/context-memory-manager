"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, RotateCcw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { FormCheckbox } from "@/components/primitives/form-check";
import { ProgressBar } from "@/components/primitives/progress-bar";
import { FileIcon } from "@/components/explorer/file-icon";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { QUERY_KEYS } from "@/lib/client/query-keys";
import { getUploadQueue, type ConflictAnswer, type ConflictDecision, type UploadItem } from "@/lib/client/upload-queue";
import { mergeClassNames } from "@/utilities/merge-class-names";

const STATUS_LABELS: Record<UploadItem["status"], string> = {
  queued: "Waiting",
  uploading: "Uploading",
  conflict: "Name already taken",
  done: "Uploaded",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

const EMPTY_BADGES = { isMemory: false, protection: "none", encrypted: false, versioned: false } as const;

/** The server snapshot: one constant, so React doesn't see a new value on every render. */
const NO_UPLOADS: readonly UploadItem[] = [];
const readNoUploads = () => NO_UPLOADS;

interface PendingConflict {
  item: UploadItem;
  resolve: (answer: ConflictAnswer) => void;
}

function ConflictModal({
  pendingConflict,
  onAnswer,
}: {
  pendingConflict: PendingConflict;
  onAnswer: (decision: ConflictDecision, applyToAll: boolean) => void;
}) {
  const [applyToAll, setApplyToAll] = useState(false);
  return (
    <Modal isOpen isStatic title={`"${pendingConflict.item.fileName}" already exists`} size="large">
      <div data-testid="upload-conflict-dialog">
        <ModalBody>
          <p className="leading-relaxed text-foreground-muted">
            A file with this name is already in the folder. Replace it, keep both (the upload is saved as &ldquo;name
            (1)&rdquo;), or skip this file.
          </p>
          <FormCheckbox
            id="conflict-apply-to-all"
            className="mt-4"
            label="Do this for every name clash in this upload"
            checked={applyToAll}
            onChange={(changeEvent) => setApplyToAll(changeEvent.target.checked)}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline-secondary" onClick={() => onAnswer("skip", applyToAll)}>
            Skip
          </Button>
          <Button variant="outline-primary" onClick={() => onAnswer("keep-both", applyToAll)}>
            Keep both
          </Button>
          <Button variant="danger" onClick={() => onAnswer("replace", applyToAll)}>
            Replace
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const uploadQueue = getUploadQueue();
  const isActive = item.status === "uploading" || item.status === "queued" || item.status === "conflict";
  return (
    <li className="px-4 py-2.5" data-testid={`upload-item-${item.fileName}`} data-status={item.status}>
      <div className="flex items-center gap-2">
        <FileIcon entry={{ name: item.targetName, type: "file", badges: EMPTY_BADGES }} />
        <span className="min-w-0 flex-1 truncate text-sm" title={item.targetName}>
          {item.targetName}
        </span>
        {item.status === "done" && <CheckCircle2 className="h-4 w-4 text-success" aria-label="Uploaded" />}
        {item.status === "failed" && <CircleAlert className="h-4 w-4 text-danger" aria-label="Failed" />}
        {isActive && (
          <button
            type="button"
            aria-label={`Cancel ${item.fileName}`}
            className="cursor-pointer text-foreground-subtle hover:text-danger"
            onClick={() => uploadQueue.cancel(item.id)}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {(item.status === "failed" || item.status === "cancelled") && (
          <button
            type="button"
            aria-label={`Retry ${item.fileName}`}
            className="cursor-pointer text-foreground-subtle hover:text-brand"
            onClick={() => uploadQueue.retry(item.id)}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>
      {item.status === "uploading" && (
        <ProgressBar
          value={item.uploadedBytes}
          maximum={Math.max(item.totalBytes, 1)}
          size="extra-small"
          className="mt-1.5"
        />
      )}
      <div className="mt-1 flex justify-between text-xs text-foreground-subtle">
        <span className={mergeClassNames(item.status === "failed" && "text-danger")}>
          {item.error ?? STATUS_LABELS[item.status]}
        </span>
        <span>
          {item.status === "uploading" ? `${formatFileSize(item.uploadedBytes)} of ` : ""}
          {formatFileSize(item.totalBytes)}
          {item.speed ? ` · ${formatFileSize(item.speed)}/s` : ""}
        </span>
      </div>
    </li>
  );
}

/**
 * The upload panel at the bottom right: each file's progress, speed, cancel and retry,
 * and a summary when everything has finished. It also asks what to do when a name is taken
 * (Replace, Keep both, Skip, optionally for the whole upload). Mounted once in the signed-in
 * layout, so uploads keep going while you browse.
 *
 * @example
 * <UploadQueuePanel />
 */
export function UploadQueuePanel() {
  const uploadQueue = getUploadQueue();
  const items = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot, readNoUploads);
  const queryClient = useQueryClient();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict>();

  useEffect(() => {
    uploadQueue.setConflictResolver(
      (item) => new Promise<ConflictAnswer>((resolve) => setPendingConflict({ item, resolve })),
    );
    uploadQueue.setUploadedListener((item) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(item.storageId, item.directory) });
    });
    return () => {
      uploadQueue.setConflictResolver(undefined);
      uploadQueue.setUploadedListener(undefined);
    };
  }, [queryClient, uploadQueue]);

  if (items.length === 0) return null;
  const countOf = (status: UploadItem["status"]) => items.filter((item) => item.status === status).length;
  const isFinished = items.every((item) => ["done", "failed", "cancelled", "skipped"].includes(item.status));
  const summary = isFinished
    ? [
        `${countOf("done")} uploaded`,
        countOf("skipped") && `${countOf("skipped")} skipped`,
        countOf("failed") && `${countOf("failed")} failed`,
        countOf("cancelled") && `${countOf("cancelled")} cancelled`,
      ]
        .filter(Boolean)
        .join(", ")
    : `${countOf("done")} of ${items.length} uploaded`;

  return (
    <>
      <section
        aria-label="Uploads"
        data-testid="upload-queue"
        className="fixed right-4 bottom-4 z-[55] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-line-strong bg-surface-strong shadow-overlay"
      >
        <header className="flex items-center gap-2 border-b border-line/60 px-4 py-2.5">
          <h2 className="flex-1 text-sm font-medium" data-testid="upload-summary">
            {isFinished ? "Uploads finished: " : "Uploading: "}
            {summary}
          </h2>
          <button
            type="button"
            aria-label={isCollapsed ? "Show uploads" : "Hide uploads"}
            className="cursor-pointer text-foreground-subtle hover:text-foreground"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {isFinished && (
            <button
              type="button"
              aria-label="Close uploads"
              className="cursor-pointer text-foreground-subtle hover:text-foreground"
              onClick={() => uploadQueue.clearFinished()}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </header>
        {!isCollapsed && (
          <ul className="max-h-80 divide-y divide-line/40 overflow-y-auto">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
      {pendingConflict && (
        <ConflictModal
          key={pendingConflict.item.id}
          pendingConflict={pendingConflict}
          onAnswer={(decision, applyToAll) => {
            pendingConflict.resolve({ decision, applyToAll });
            setPendingConflict(undefined);
          }}
        />
      )}
    </>
  );
}
