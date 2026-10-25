import "server-only";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { registerJobType, type JobContext, type JobDefinition } from "@/server/jobs/queue";
import { isInsideRoot, joinRelativePath, resolveInStorage } from "@/server/security/path-jail";
import {
  copyDirectoryShell,
  copyFileContents,
  copySymlink,
  findAvailableName,
  measureTree,
  walkTree,
} from "@/server/storage/copy-tree";
import { collectTransferTransforms, runAfterHooks, runGuards, type FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess } from "@/server/storage/roots";
import { moveToTrash } from "@/server/trash";
import { joinStoragePath } from "@/server/storage/storage-path";

export const FILE_COPY_JOB_TYPE = "fs.copy";

export interface StoragePathReference {
  storageId: string;
  path: string;
}

export interface FileCopyPayload {
  sources: StoragePathReference[];
  destination: StoragePathReference;
  destinationLabel: string;
  /** Move: each source goes to its storage's trash once copied. */
  move: boolean;
  /** "keep-both" copies to "name (copy)" when the name is taken; "fail" stops. */
  conflict: "fail" | "keep-both";
  /** The user confirmed that copies out of an encrypted folder are decrypted. */
  confirmDecrypt?: boolean;
  actor: FileActor;
}

export interface FileCopyCheckpoint {
  /** The name each source is copied to, decided once so a resumed job writes to the same place. */
  targetNames: (string | null)[];
  completedSources: number;
}

async function existsWithSameContent(targetPath: string, sizeBytes: number, mtimeMs: number): Promise<boolean> {
  try {
    const targetStats = await lstat(targetPath);
    return targetStats.isFile() && targetStats.size === sizeBytes && Math.abs(targetStats.mtimeMs - mtimeMs) < 1;
  } catch {
    return false;
  }
}

async function runFileCopy({
  payload,
  checkpoint,
  reportProgress,
  saveCheckpoint,
  signal,
}: JobContext<FileCopyPayload, FileCopyCheckpoint>): Promise<void> {
  const { actor, destination } = payload;
  const destinationStorage = requireStorageAccess(actor, destination.storageId, "write");
  const destinationFolder = await resolveInStorage(destinationStorage, destination.path);
  if (!(await stat(destinationFolder.absolutePath)).isDirectory())
    throw validationFailed("The destination is not a folder.");

  const progressState: FileCopyCheckpoint = checkpoint ?? {
    targetNames: payload.sources.map(() => null),
    completedSources: 0,
  };
  const plans = [];
  for (const [sourceIndex, source] of payload.sources.entries()) {
    if (sourceIndex < progressState.completedSources) continue;
    const sourceStorage = requireStorageAccess(actor, source.storageId, payload.move ? "write" : "read");
    const resolvedSource = await resolveInStorage(sourceStorage, source.path);
    if (resolvedSource.relativePath === "") throw validationFailed("A storage's root folder can't be copied or moved.");
    const sourceStats = await lstat(resolvedSource.absolutePath);
    if (
      sourceStats.isDirectory() &&
      source.storageId === destination.storageId &&
      isInsideRoot(resolvedSource.absolutePath, destinationFolder.absolutePath)
    ) {
      throw validationFailed("A folder can't be copied or moved into itself.");
    }
    let targetName = progressState.targetNames[sourceIndex] ?? null;
    if (targetName === null) {
      const sourceName = path.basename(resolvedSource.absolutePath);
      targetName =
        payload.conflict === "keep-both"
          ? await findAvailableName(destinationFolder.absolutePath, sourceName, "copy", sourceStats.isDirectory())
          : sourceName;
      if (
        payload.conflict === "fail" &&
        (await lstat(joinStoragePath(destinationFolder.absolutePath, targetName)).catch(() => undefined))
      ) {
        throw new ApiRouteError(409, "ALREADY_EXISTS", `"${targetName}" already exists in the destination.`);
      }
      progressState.targetNames[sourceIndex] = targetName;
    }
    const targetPath = joinRelativePath(destinationFolder.relativePath, targetName);
    await runGuards({
      type: payload.move ? "move" : "copy",
      storageId: sourceStorage.id,
      path: resolvedSource.relativePath,
      absolutePath: resolvedSource.absolutePath,
      actor,
      isDirectory: sourceStats.isDirectory(),
      confirmDecrypt: payload.confirmDecrypt,
      destination: {
        storageId: destinationStorage.id,
        path: targetPath,
        absolutePath: joinStoragePath(destinationFolder.absolutePath, targetName),
      },
    });
    plans.push({ sourceIndex, sourceStorage, resolvedSource, targetName, targetPath });
  }
  saveCheckpoint(progressState);

  let totalBytes = 0;
  for (const plan of plans) totalBytes += (await measureTree(plan.resolvedSource.absolutePath, signal)).size;
  let doneBytes = 0;
  const report = (currentItem: string) =>
    reportProgress({ done: doneBytes, total: totalBytes, unit: "bytes", currentItem });

  for (const plan of plans) {
    const targetRoot = joinStoragePath(destinationFolder.absolutePath, plan.targetName);
    for await (const treeEntry of walkTree(plan.resolvedSource.absolutePath, { signal })) {
      const entryTargetPath =
        treeEntry.relativePath === "" ? targetRoot : joinStoragePath(targetRoot, ...treeEntry.relativePath.split("/"));
      const displayPath = joinRelativePath(plan.targetName, treeEntry.relativePath).replace(/\/$/, "");
      if (treeEntry.type === "directory") {
        await copyDirectoryShell(treeEntry.mode, entryTargetPath);
      } else if (treeEntry.type === "symlink") {
        if (!(await lstat(entryTargetPath).catch(() => undefined)))
          await copySymlink(treeEntry.absolutePath, entryTargetPath);
      } else if (await existsWithSameContent(entryTargetPath, treeEntry.size, treeEntry.mtimeMs)) {
        doneBytes += treeEntry.size;
      } else {
        const transforms = await collectTransferTransforms({
          type: payload.move ? "move" : "copy",
          storageId: plan.sourceStorage.id,
          path: joinRelativePath(plan.resolvedSource.relativePath, treeEntry.relativePath),
          absolutePath: treeEntry.absolutePath,
          actor,
          isDirectory: false,
          confirmDecrypt: payload.confirmDecrypt,
          destination: {
            storageId: destinationStorage.id,
            path: joinRelativePath(plan.targetPath, treeEntry.relativePath),
            absolutePath: entryTargetPath,
          },
        });
        await copyFileContents(treeEntry.absolutePath, entryTargetPath, {
          signal,
          transforms,
          exclusive: false,
          onBytes: (byteCount) => {
            doneBytes += byteCount;
            report(displayPath);
          },
        });
      }
      report(displayPath);
    }
    getEventBus().emit("fs.changed", { storageId: destinationStorage.id, path: plan.targetPath, change: "added" });
    if (payload.move) await moveToTrash(plan.sourceStorage, plan.resolvedSource.relativePath, actor);
    await runAfterHooks({
      type: payload.move ? "move" : "copy",
      storageId: plan.sourceStorage.id,
      path: plan.resolvedSource.relativePath,
      absolutePath: plan.resolvedSource.absolutePath,
      actor,
      destination: { storageId: destinationStorage.id, path: plan.targetPath, absolutePath: targetRoot },
    });
    progressState.completedSources = plan.sourceIndex + 1;
    saveCheckpoint(progressState);
  }
  reportProgress({ done: totalBytes, total: totalBytes, unit: "bytes" });
}

export const fileCopyJob: JobDefinition<FileCopyPayload, FileCopyCheckpoint> = {
  run: runFileCopy,
  readVolumeKeys: (payload) => [
    ...new Set([...payload.sources.map((source) => source.storageId), payload.destination.storageId]),
  ],
  describe: (payload) => {
    const verb = payload.move ? "Move" : "Copy";
    const firstSource = payload.sources[0];
    const subject =
      payload.sources.length === 1 && firstSource
        ? `"${firstSource.path.split("/").at(-1) ?? firstSource.path}"`
        : `${payload.sources.length} items`;
    const destinationName = payload.destination.path === "" ? payload.destinationLabel : payload.destination.path;
    return `${verb} ${subject} to ${destinationName}`;
  },
};

/** Makes sure the `fs.copy` type is registered in this module copy, then returns its name. */
export function ensureFileCopyJobType(): string {
  registerJobType(FILE_COPY_JOB_TYPE, fileCopyJob);
  return FILE_COPY_JOB_TYPE;
}
