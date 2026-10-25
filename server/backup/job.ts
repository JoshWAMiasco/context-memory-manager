import "server-only";
import { lstat, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { BackupPhase, JobProgress } from "@/lib/api-types";
import { ADHOC_BACKUP_NAME } from "@/lib/backup";
import { BackupCopyError, classifyCopyError, copyFile, ThroughputMeter } from "@/server/backup/copy";
import { buildPartsPlan, SNAPSHOT_FOLDER_PATTERN } from "@/server/backup/plan";
import { markProfileRun, type BackupSpec } from "@/server/backup/profiles";
import { recordRunCounters, recordRunStart, syncRunWithJob, type RunCounters } from "@/server/backup/runs";
import {
  ensureMemoryFolder,
  readRunOptions,
  resolveBackupTarget,
  toPlanParts,
  type BackupTarget,
} from "@/server/backup/target";
import { getEventBus, type DriveEvent } from "@/server/events/bus";
import { ApiRouteError } from "@/server/http/api-error";
import {
  getJobQueue,
  JobPauseRequest,
  registerJobType,
  type JobContext,
  type JobDefinition,
} from "@/server/jobs/queue";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { joinRelativePath, parentRelativePath } from "@/server/security/path-jail";
import { copySymlink } from "@/server/storage/copy-tree";
import type { FileActor } from "@/server/storage/pipeline";
import { findActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { moveToTrash } from "@/server/trash";

export const BACKUP_JOB_TYPE = "backup.run";

export const DRIVE_DISCONNECTED_MESSAGE = "Drive disconnected — will resume when reconnected.";
export const DRIVE_DISCONNECTED_MANUAL_MESSAGE = "Drive disconnected — resume it once the drive is back.";

/** The checkpoint and History counts are saved at most this often while files are copied. */
const CHECKPOINT_MILLISECONDS = 1000;

export interface BackupJobPayload {
  /** The profile's name, or "Ad-hoc backup". */
  name: string;
  profileId?: string;
  spec: BackupSpec;
  sourceLabel: string;
  destinationLabel: string;
  actor: FileActor;
}

export interface BackupJobCheckpoint {
  /** The plan the index belongs to; a resumed run whose new plan differs starts that plan from the top. */
  planHash: string;
  /** The next plan entry to copy. */
  index: number;
  /** Bytes and files of this plan copied so far. */
  bytesDone: number;
  filesDone: number;
  /** A snapshot keeps writing into the folder its first attempt chose. */
  snapshotName?: string;
  /** Totals over every attempt, for History. */
  counters: RunCounters;
  /** The storage whose drive went away; the job resumes when it is back. */
  waitingForStorageId?: string;
}

function emptyCounters(): RunCounters {
  return { bytesCopied: 0, filesCopied: 0, filesSkipped: 0, filesDeleted: 0, errors: [], warnings: [] };
}

/** Bytes for people: "1.5 GB". */
function formatBytes(byteCount: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = byteCount;
  let unitIndex = 0;
  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }
  return `${Number(size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1))} ${units[unitIndex]}`;
}

/** Marks an abort that came from a drive going away (not from Pause or Cancel). */
class DriveDisconnected extends Error {
  constructor(readonly storageId: string) {
    super("Drive disconnected");
    this.name = "DriveDisconnected";
  }
}

/**
 * Aborts when the source or destination drive is unplugged or unmounted (`drive.removed`, or a
 * `drive.updated` that is no longer available), so a copy stops at once instead of failing
 * file by file.
 */
function watchForDisconnect(storageIds: readonly string[]) {
  const controller = new AbortController();
  const handleDriveEvent = (driveEvent: DriveEvent) => {
    if (driveEvent.available || !storageIds.includes(driveEvent.storageId) || controller.signal.aborted) return;
    controller.abort(new DriveDisconnected(driveEvent.storageId));
  };
  const eventBus = getEventBus();
  eventBus.on("drive.removed", handleDriveEvent);
  eventBus.on("drive.updated", handleDriveEvent);
  return {
    signal: controller.signal,
    readStorageId: () =>
      controller.signal.reason instanceof DriveDisconnected ? controller.signal.reason.storageId : undefined,
    dispose: () => {
      eventBus.off("drive.removed", handleDriveEvent);
      eventBus.off("drive.updated", handleDriveEvent);
    },
  };
}

/** The first of `storageIds` that is gone: an unplugged or unmounted drive, or a root folder that disappeared. */
async function findMissingStorage(storageIds: readonly string[]): Promise<string | undefined> {
  for (const storageId of storageIds) {
    const activeStorage = findActiveStorage(storageId);
    if (!activeStorage?.available) return storageId;
    if (!(await stat(activeStorage.rootPath).catch(() => undefined))) return storageId;
  }
  return undefined;
}

/**
 * Moves the oldest snapshot folders beyond `keep` into the destination's trash.
 * Returns how many were moved.
 */
async function pruneSnapshots(target: BackupTarget, keep: number, actor: FileActor): Promise<number> {
  const parentPath = parentRelativePath(target.targetPath);
  const parentAbsolutePath = path.dirname(target.targetAbsolutePath);
  const snapshotNames = (await readdir(parentAbsolutePath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && SNAPSHOT_FOLDER_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .toSorted();
  const excess = snapshotNames.slice(0, Math.max(0, snapshotNames.length - keep));
  for (const snapshotName of excess) {
    await moveToTrash(target.destinationStorage, joinRelativePath(parentPath, snapshotName), actor);
  }
  return excess.length;
}

function describeError(copyError: unknown): string {
  if (copyError instanceof BackupCopyError || copyError instanceof ApiRouteError) return copyError.message;
  return classifyCopyError(copyError).message;
}

/**
 * Runs one backup: scans and plans, copies file by file (with verification when set),
 * moves mirror deletions to the destination's trash, prunes old snapshots, and records the run in
 * History. Progress goes out every 250 ms with the phase, bytes and files, speed and ETA. The
 * checkpoint is saved about every second; a resumed run plans again, so files copied before the
 * pause count as unchanged, and continues at the saved index when the plan is the same. A
 * removed drive pauses the job ("Drive disconnected"); a cancelled or interrupted copy removes
 * its `.cmm-part` file. Encrypted folders are copied byte for byte, so they stay ciphertext.
 */
async function runBackup({
  jobId,
  payload,
  checkpoint,
  reportProgress,
  saveCheckpoint,
  signal,
}: JobContext<BackupJobPayload, BackupJobCheckpoint>): Promise<void> {
  const { spec, actor } = payload;
  const storageIds = [spec.source.storageId, spec.destination.storageId];
  const state: BackupJobCheckpoint = checkpoint
    ? { ...checkpoint, waitingForStorageId: undefined }
    : { planHash: "", index: 0, bytesDone: 0, filesDone: 0, counters: emptyCounters() };
  const isFirstAttempt = checkpoint === undefined;
  recordRunStart({
    jobId,
    profileId: payload.profileId,
    name: payload.name,
    mode: spec.mode,
    source: { ...spec.source, label: payload.sourceLabel },
    destination: { ...spec.destination, label: payload.destinationLabel },
    memory: spec.memory,
    createdBy: actor.id,
  });
  if (isFirstAttempt && payload.profileId) markProfileRun(payload.profileId);

  const disconnect = watchForDisconnect(storageIds);
  const runSignal = AbortSignal.any([signal, disconnect.signal]);
  const meter = new ThroughputMeter();
  let phase: BackupPhase = "scanning";
  let bytesTotal = 0;
  let filesTotal = 0;
  let currentItem: string | undefined;
  let lastSavedAt = 0;
  let target: BackupTarget | undefined;

  const report = () => {
    const progress: JobProgress = {
      done: state.bytesDone,
      total: bytesTotal,
      unit: "bytes",
      files: { done: state.filesDone, total: filesTotal },
      phase,
    };
    if (currentItem) progress.currentItem = currentItem;
    const speed = meter.bytesPerSecond;
    if (speed !== undefined && phase === "copying") {
      progress.speed = speed;
      progress.eta = speed > 0 ? Math.max(0, (bytesTotal - state.bytesDone) / speed) : undefined;
    }
    reportProgress(progress);
  };
  const save = (force = false) => {
    if (!force && Date.now() - lastSavedAt < CHECKPOINT_MILLISECONDS) return;
    lastSavedAt = Date.now();
    saveCheckpoint(state);
    recordRunCounters(jobId, state.counters);
  };
  const recordError = (errorPath: string, copyError: unknown) => {
    state.counters.errors.push({ path: errorPath, message: describeError(copyError) });
  };

  try {
    report();
    const missingAtStart = await findMissingStorage(storageIds);
    if (missingAtStart) throw new DriveDisconnected(missingAtStart);
    target = await resolveBackupTarget(actor, spec, { snapshotName: state.snapshotName });
    state.snapshotName = target.snapshotName;
    const plan = await buildPartsPlan({
      parts: toPlanParts(target),
      dest: { absolutePath: target.targetAbsolutePath, ...target.volume },
      mode: spec.mode,
      options: readRunOptions(target, spec.options),
      signal: runSignal,
      onScan: (entryCount) => {
        currentItem = `${entryCount.toLocaleString("en-US")} items scanned`;
        report();
      },
    });
    if (plan.insufficientSpace) {
      throw new ApiRouteError(
        507,
        "INSUFFICIENT_SPACE",
        `This backup needs ${formatBytes(plan.requiredBytes)} of free space on the destination, but it has ${formatBytes(plan.freeBytes)}. Nothing was copied.`,
      );
    }
    state.counters.warnings = plan.warnings;
    if (state.planHash === "") state.counters.filesSkipped = plan.skip;
    if (plan.hash !== state.planHash) {
      state.index = 0;
      state.bytesDone = 0;
      state.filesDone = 0;
    }
    state.planHash = plan.hash;
    bytesTotal = plan.bytesTotal;
    filesTotal = plan.filesTotal;
    save(true);

    const sourceRoots = target.parts.map((part) => part.source.absolutePath);
    const targetRoot = target.targetAbsolutePath;
    const toAbsolute = (rootPath: string, relativePath: string) =>
      joinStoragePath(rootPath, ...relativePath.split("/"));
    if (spec.memory) await ensureMemoryFolder(target, spec.memory);
    await mkdir(targetRoot, { recursive: true });
    for (const part of target.parts) {
      if (part.folder !== "") await mkdir(toAbsolute(targetRoot, part.folder), { recursive: true });
    }
    for (const stalePart of plan.staleParts) await rm(toAbsolute(targetRoot, stalePart), { force: true });
    for (const replacement of plan.replace) {
      runSignal.throwIfAborted();
      await moveToTrash(target.destinationStorage, joinRelativePath(target.targetPath, replacement.targetPath), actor);
      state.counters.filesDeleted += 1;
    }

    phase = "copying";
    currentItem = undefined;
    meter.reset();
    report();
    for (let entryIndex = state.index; entryIndex < plan.copy.length; entryIndex += 1) {
      runSignal.throwIfAborted();
      const entry = plan.copy[entryIndex];
      if (!entry) break;
      const sourcePath = toAbsolute(sourceRoots[entry.part ?? 0] ?? "", entry.sourcePath);
      const targetPath = toAbsolute(targetRoot, entry.targetPath);
      if (entry.type === "directory") {
        await mkdir(targetPath, { recursive: true, mode: (entry.mode & 0o777) | 0o200 });
      } else if (entry.type === "symlink") {
        if (!(await lstat(targetPath).catch(() => undefined))) {
          await copySymlink(sourcePath, targetPath).catch((linkError: unknown) =>
            recordError(entry.sourcePath, linkError),
          );
        }
      } else {
        currentItem = entry.sourcePath;
        const bytesBefore = state.bytesDone;
        try {
          await copyFile(sourcePath, targetPath, {
            verify: spec.options.verify,
            signal: runSignal,
            onBytes: (byteCount) => {
              state.bytesDone += byteCount;
              meter.sample(state.bytesDone);
              report();
            },
            onVerifyBytes: () => {
              if (phase === "verifying") return;
              phase = "verifying";
              report();
            },
          });
          state.counters.filesCopied += 1;
          state.counters.bytesCopied += entry.size;
        } catch (copyError) {
          if (runSignal.aborted) throw copyError;
          const missingStorage = await findMissingStorage(storageIds);
          if (missingStorage) throw new DriveDisconnected(missingStorage);
          const classified = classifyCopyError(copyError);
          if (classified.kind === "no-space") throw new ApiRouteError(507, "INSUFFICIENT_SPACE", classified.message);
          recordError(entry.sourcePath, classified);
        }
        state.bytesDone = bytesBefore + entry.size;
        state.filesDone += 1;
        phase = "copying";
      }
      state.index = entryIndex + 1;
      report();
      save();
    }
    save(true);

    if (plan.delete.length > 0) {
      phase = "deleting";
      currentItem = undefined;
      report();
      for (const deletion of plan.delete) {
        runSignal.throwIfAborted();
        const deletionPath = joinRelativePath(target.targetPath, deletion.targetPath);
        try {
          await moveToTrash(target.destinationStorage, deletionPath, actor);
          state.counters.filesDeleted += 1;
        } catch (deleteError) {
          const missingStorage = await findMissingStorage(storageIds);
          if (missingStorage) throw new DriveDisconnected(missingStorage);
          recordError(deletion.targetPath, deleteError);
        }
        save();
      }
    }
    if (spec.mode === "snapshot" && spec.options.keepSnapshots) {
      await pruneSnapshots(target, spec.options.keepSnapshots, actor).catch((pruneError: unknown) =>
        recordError(parentRelativePath(target?.targetPath ?? ""), pruneError),
      );
    }
    phase = "done";
    currentItem = undefined;
    report();
    save(true);
  } catch (runError) {
    const disconnectedStorage =
      disconnect.readStorageId() ?? (runError instanceof DriveDisconnected ? runError.storageId : undefined);
    if (disconnectedStorage && !signal.aborted) {
      state.waitingForStorageId = disconnectedStorage;
      save(true);
      throw new JobPauseRequest(spec.autoResume ? DRIVE_DISCONNECTED_MESSAGE : DRIVE_DISCONNECTED_MANUAL_MESSAGE);
    }
    save(true);
    throw runError;
  } finally {
    disconnect.dispose();
    if (target) {
      getEventBus().emit("fs.changed", {
        storageId: target.destinationStorage.id,
        path: target.memoryPath ?? target.targetPath,
        change: "changed",
      });
    }
  }
}

function describeEndpoint(label: string, endpointPath: string): string {
  return endpointPath === "" ? label : `"${path.posix.basename(endpointPath)}"`;
}

/** Why a paused backup can't be resumed yet: one of its drives isn't plugged in. */
function readResumeBlocker(jobId: string): string | undefined {
  const jobRow = getJobQueue().get(jobId);
  if (!jobRow?.payloadJson) return undefined;
  const payload = JSON.parse(jobRow.payloadJson) as BackupJobPayload;
  for (const [storageId, label] of [
    [payload.spec.source.storageId, payload.sourceLabel],
    [payload.spec.destination.storageId, payload.destinationLabel],
  ] as const) {
    if (!findActiveStorage(storageId)?.available) return `Connect "${label}" to resume this backup.`;
  }
  return undefined;
}

/** "notes", or "3 folders", for a memory backup's job title. */
function describeMemorySources(paths: readonly string[], sourceLabel: string): string {
  if (paths.length !== 1) return `${paths.length} folders`;
  return describeEndpoint(sourceLabel, paths[0] ?? "");
}

export const backupJob: JobDefinition<BackupJobPayload, BackupJobCheckpoint> = {
  run: runBackup,
  // One backup per destination volume at a time.
  readVolumeKeys: (payload) => [payload.spec.destination.storageId],
  describe: (payload) => {
    const { memory } = payload.spec;
    if (memory) {
      return `Back up ${describeMemorySources(memory.paths, payload.sourceLabel)} into the memory "${memory.name}" on ${describeEndpoint(payload.destinationLabel, payload.spec.destination.path)}`;
    }
    const subject = `Back up ${describeEndpoint(payload.sourceLabel, payload.spec.source.path)} to ${describeEndpoint(payload.destinationLabel, payload.spec.destination.path)}`;
    return payload.name === ADHOC_BACKUP_NAME
      ? subject
      : `${payload.name}: ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
  },
  readTransfer: (payload) => ({
    source: payload.spec.source,
    destination: payload.spec.destination,
    mode: payload.spec.mode,
    ...(payload.profileId ? { profileId: payload.profileId } : {}),
    ...(payload.spec.memory ? { memory: payload.spec.memory } : {}),
  }),
  readResumeBlocker,
};

/**
 * Makes sure the `backup.run` type is registered in this module copy, and that History rows
 * follow their jobs' state (paused, done, failed, cancelled; once per process), then returns its
 * name.
 */
export function ensureBackupJobType(): string {
  registerJobType(BACKUP_JOB_TYPE, backupJob);
  getGlobalSingleton("backup-run-sync", () => {
    getEventBus().on("job.state", ({ job }) => {
      if (job.type === BACKUP_JOB_TYPE) syncRunWithJob(job);
    });
    return true;
  });
  return BACKUP_JOB_TYPE;
}
