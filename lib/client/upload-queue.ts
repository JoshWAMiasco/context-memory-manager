import type { FileEntry, ReplaceResult } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { buildKeepBothName, uploadFile, type UploadOptions, type UploadTransport } from "@/lib/client/upload";

export const PARALLEL_UPLOADS = 3;
const MAXIMUM_KEEP_BOTH_ATTEMPTS = 100;

export type UploadItemStatus = "queued" | "uploading" | "conflict" | "done" | "failed" | "cancelled" | "skipped";

export interface UploadItem {
  id: string;
  batchId: string;
  fileName: string;
  /** The name it is saved under ("Keep both" renames it). */
  targetName: string;
  storageId: string;
  directory: string;
  status: UploadItemStatus;
  uploadedBytes: number;
  totalBytes: number;
  /** Bytes per second, while uploading. */
  speed?: number;
  error?: string;
  /** Set for "Replace with file from computer…": it overwrites `targetName`, if that is unchanged. */
  replace?: { expectedEtag?: string };
  /** What a finished replace left to compare with. */
  replaced?: ReplaceResult;
  /** Part of a folder upload: its folder and its one confirmation. */
  batch?: { root: string; actionToken?: string };
}

export type ConflictDecision = "replace" | "keep-both" | "skip";

export interface ConflictAnswer {
  decision: ConflictDecision;
  applyToAll: boolean;
}

export type ConflictResolver = (item: UploadItem) => Promise<ConflictAnswer>;

interface QueueEntry {
  item: UploadItem;
  file: File;
  controller?: AbortController;
}

let nextIdentifier = 0;

function createIdentifier(prefix: string): string {
  nextIdentifier += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextIdentifier}`;
}

/**
 * The upload queue behind the upload panel: three files at a time, a conflict question per name
 * clash (Replace, Keep both, Skip, optionally for the whole batch), cancel and retry. React reads
 * it through `useSyncExternalStore`.
 */
export class UploadQueue {
  private entries: QueueEntry[] = [];
  private snapshot: readonly UploadItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly batchDecisions = new Map<string, ConflictDecision>();
  private conflictResolver?: ConflictResolver;
  private conflictChain: Promise<unknown> = Promise.resolve();
  private uploadedListener?: (item: UploadItem, entry: FileEntry) => void;

  constructor(
    private readonly transport?: UploadTransport,
    private readonly retryOptions: Pick<UploadOptions, "maximumAttempts" | "readRetryDelay"> = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly UploadItem[] => this.snapshot;

  setConflictResolver(resolver: ConflictResolver | undefined): void {
    this.conflictResolver = resolver;
  }

  setUploadedListener(listener: ((item: UploadItem, entry: FileEntry) => void) | undefined): void {
    this.uploadedListener = listener;
  }

  /**
   * Queues files for one folder as one batch; returns the batch id. `batch` is an upload grant
   * covering the folder (one confirmation for all the files, as for a folder upload).
   */
  add(
    files: readonly File[],
    storageId: string,
    directory: string,
    batch?: { root: string; actionToken?: string },
  ): string {
    const batchId = createIdentifier("batch");
    for (const file of files) {
      this.entries.push({
        file,
        item: {
          id: createIdentifier("upload"),
          batchId,
          fileName: file.name,
          targetName: file.name,
          storageId,
          directory,
          status: "queued",
          uploadedBytes: 0,
          totalBytes: file.size,
          batch,
        },
      });
    }
    this.publish();
    this.pump();
    return batchId;
  }

  /**
   * Queues a folder upload's files, each into its own folder, as one batch (one answer to a name
   * clash can cover all of them). `batch` is the folder upload's one confirmation.
   */
  addTree(
    files: readonly { file: File; directory: string }[],
    storageId: string,
    batch: { root: string; actionToken?: string },
  ): string {
    const batchId = createIdentifier("batch");
    for (const { file, directory } of files) {
      this.entries.push({
        file,
        item: {
          id: createIdentifier("upload"),
          batchId,
          fileName: file.name,
          targetName: file.name,
          storageId,
          directory,
          status: "queued",
          uploadedBytes: 0,
          totalBytes: file.size,
          batch,
        },
      });
    }
    this.publish();
    this.pump();
    return batchId;
  }

  /**
   * Queues a file that replaces an existing one (`targetName` in `directory`), keeping that name.
   * It fails with `ETAG_MISMATCH` if the file changed since `expectedEtag`.
   */
  addReplacement(file: File, storageId: string, directory: string, targetName: string, expectedEtag?: string): string {
    const batchId = createIdentifier("batch");
    this.entries.push({
      file,
      item: {
        id: createIdentifier("upload"),
        batchId,
        fileName: file.name,
        targetName,
        storageId,
        directory,
        status: "queued",
        uploadedBytes: 0,
        totalBytes: file.size,
        replace: { expectedEtag },
      },
    });
    this.publish();
    this.pump();
    return batchId;
  }

  cancel(itemId: string): void {
    const queueEntry = this.findEntry(itemId);
    if (!queueEntry) return;
    if (queueEntry.item.status === "queued" || queueEntry.item.status === "conflict") {
      this.update(queueEntry, { status: "cancelled" });
      return;
    }
    queueEntry.controller?.abort();
  }

  retry(itemId: string): void {
    const queueEntry = this.findEntry(itemId);
    if (!queueEntry || (queueEntry.item.status !== "failed" && queueEntry.item.status !== "cancelled")) return;
    this.update(queueEntry, { status: "queued", uploadedBytes: 0, error: undefined, speed: undefined });
    this.pump();
  }

  /** Removes finished items (done, skipped, cancelled, failed) from the list. */
  clearFinished(): void {
    this.entries = this.entries.filter((queueEntry) =>
      ["queued", "uploading", "conflict"].includes(queueEntry.item.status),
    );
    this.publish();
  }

  private findEntry(itemId: string): QueueEntry | undefined {
    return this.entries.find((queueEntry) => queueEntry.item.id === itemId);
  }

  private publish(): void {
    this.snapshot = this.entries.map((queueEntry) => queueEntry.item);
    for (const listener of this.listeners) listener();
  }

  private update(queueEntry: QueueEntry, changes: Partial<UploadItem>): void {
    queueEntry.item = { ...queueEntry.item, ...changes };
    this.publish();
  }

  private pump(): void {
    const activeCount = this.entries.filter((queueEntry) =>
      ["uploading", "conflict"].includes(queueEntry.item.status),
    ).length;
    const waitingEntries = this.entries.filter((queueEntry) => queueEntry.item.status === "queued");
    for (const queueEntry of waitingEntries.slice(0, Math.max(0, PARALLEL_UPLOADS - activeCount))) {
      void this.run(queueEntry);
    }
  }

  private askAboutConflict(queueEntry: QueueEntry): Promise<ConflictDecision> {
    const decided = this.batchDecisions.get(queueEntry.item.batchId);
    if (decided) return Promise.resolve(decided);
    const answer = this.conflictChain.then(async (): Promise<ConflictDecision> => {
      const decidedMeanwhile = this.batchDecisions.get(queueEntry.item.batchId);
      if (decidedMeanwhile) return decidedMeanwhile;
      if (!this.conflictResolver) return "skip";
      const { decision, applyToAll } = await this.conflictResolver(queueEntry.item);
      if (applyToAll) this.batchDecisions.set(queueEntry.item.batchId, decision);
      return decision;
    });
    this.conflictChain = answer.catch(() => undefined);
    return answer;
  }

  private async run(queueEntry: QueueEntry): Promise<void> {
    const controller = new AbortController();
    queueEntry.controller = controller;
    this.update(queueEntry, { status: "uploading", uploadedBytes: 0 });
    let overwrite = false;
    let keepBothAttempt = 0;
    const startedAt = Date.now();
    try {
      for (;;) {
        try {
          const completion = await uploadFile(
            queueEntry.file,
            {
              storageId: queueEntry.item.storageId,
              directory: queueEntry.item.directory,
              name: queueEntry.item.targetName,
              overwrite,
              replace: queueEntry.item.replace,
              batch: queueEntry.item.batch,
            },
            {
              transport: this.transport,
              ...this.retryOptions,
              signal: controller.signal,
              onProgress: (uploadedBytes) => {
                const elapsedSeconds = (Date.now() - startedAt) / 1000;
                this.update(queueEntry, {
                  uploadedBytes,
                  speed: elapsedSeconds > 0.25 ? uploadedBytes / elapsedSeconds : undefined,
                });
              },
            },
          );
          this.update(queueEntry, {
            status: "done",
            uploadedBytes: queueEntry.item.totalBytes,
            speed: undefined,
            replaced: completion.replaced,
          });
          this.uploadedListener?.(queueEntry.item, completion.entry);
          return;
        } catch (uploadError) {
          if (!(uploadError instanceof ApiError) || uploadError.code !== "ALREADY_EXISTS") throw uploadError;
          if (keepBothAttempt > 0) {
            keepBothAttempt += 1;
            if (keepBothAttempt > MAXIMUM_KEEP_BOTH_ATTEMPTS) throw uploadError;
            this.update(queueEntry, { targetName: buildKeepBothName(queueEntry.item.fileName, keepBothAttempt) });
            continue;
          }
          this.update(queueEntry, { status: "conflict" });
          const decision = await this.askAboutConflict(queueEntry);
          if (controller.signal.aborted || queueEntry.item.status === "cancelled") return;
          if (decision === "skip") {
            this.update(queueEntry, { status: "skipped", speed: undefined });
            return;
          }
          if (decision === "replace") overwrite = true;
          if (decision === "keep-both") {
            keepBothAttempt = 1;
            this.update(queueEntry, { targetName: buildKeepBothName(queueEntry.item.fileName, keepBothAttempt) });
          }
          this.update(queueEntry, { status: "uploading" });
        }
      }
    } catch (uploadError) {
      if (controller.signal.aborted) {
        this.update(queueEntry, { status: "cancelled", speed: undefined });
      } else {
        this.update(queueEntry, {
          status: "failed",
          speed: undefined,
          error: uploadError instanceof Error ? uploadError.message : "The upload failed.",
        });
      }
    } finally {
      queueEntry.controller = undefined;
      this.pump();
    }
  }
}

let sharedQueue: UploadQueue | undefined;

/** The tab's shared upload queue. */
export function getUploadQueue(): UploadQueue {
  sharedQueue ??= new UploadQueue();
  return sharedQueue;
}
