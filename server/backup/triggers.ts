import "server-only";
import { eq } from "drizzle-orm";
import { BACKUP_JOB_TYPE, type BackupJobCheckpoint, type BackupJobPayload } from "@/server/backup/job";
import { findAutoRunProfiles, type BackupProfileRow } from "@/server/backup/profiles";
import { getDatabase } from "@/server/db/client";
import { jobs, users } from "@/server/db/schema";
import { getEventBus, type DriveEvent } from "@/server/events/bus";
import { getJobQueue, SYSTEM_JOB_ACTOR } from "@/server/jobs/queue";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { findActiveStorage } from "@/server/storage/roots";

/** A profile that ran less than this long ago doesn't run again on plug-in. */
export const AUTO_RUN_COOLDOWN_MILLISECONDS = 60 * 60 * 1000;

/** Wait after a drive appears before using it: the OS may still be mounting or indexing it. */
const DEFAULT_SETTLE_MILLISECONDS = 5000;

function readTriggerSettings(): { settleMilliseconds: number } {
  return getGlobalSingleton("backup-trigger-settings", () => ({ settleMilliseconds: DEFAULT_SETTLE_MILLISECONDS }));
}

/** Test hook: how long to wait after a drive appears before running or resuming backups. */
export function setBackupTriggerSettleMilliseconds(settleMilliseconds: number): void {
  readTriggerSettings().settleMilliseconds = settleMilliseconds;
}

function parseJson<Value>(jsonText: string | null): Value | undefined {
  if (jsonText === null) return undefined;
  try {
    return JSON.parse(jsonText) as Value;
  } catch {
    return undefined;
  }
}

/**
 * Resumes paused backups that were waiting for a drive when `storageId`, one of their
 * drives, comes back: their profile (or ad-hoc run) has auto-resume on and both of their drives
 * are plugged in again. Returns the resumed job ids.
 */
export function resumeWaitingBackups(storageId: string): string[] {
  const queue = getJobQueue();
  const pausedRows = getDatabase()
    .orm.select()
    .from(jobs)
    .where(eq(jobs.status, "paused"))
    .all()
    .filter((jobRow) => jobRow.type === BACKUP_JOB_TYPE);
  const resumed: string[] = [];
  for (const jobRow of pausedRows) {
    const payload = parseJson<BackupJobPayload>(jobRow.payloadJson);
    const checkpoint = parseJson<BackupJobCheckpoint>(jobRow.checkpointJson);
    if (!payload?.spec.autoResume || !checkpoint?.waitingForStorageId) continue;
    const endpointStorageIds = [payload.spec.source.storageId, payload.spec.destination.storageId];
    // Either drive coming back counts: both may have been unplugged, and come back in any order.
    if (!endpointStorageIds.includes(storageId)) continue;
    const bothAvailable = endpointStorageIds.every(
      (endpointStorageId) => findActiveStorage(endpointStorageId)?.available === true,
    );
    if (!bothAvailable) continue;
    try {
      queue.resume(SYSTEM_JOB_ACTOR, jobRow.id);
      resumed.push(jobRow.id);
    } catch (resumeError) {
      console.error(`[ccm] backup ${jobRow.id} could not resume`, resumeError);
    }
  }
  return resumed;
}

function readProfileOwner(profileRow: BackupProfileRow) {
  if (!profileRow.createdBy) return undefined;
  const owner = getDatabase().orm.select().from(users).where(eq(users.id, profileRow.createdBy)).get();
  return owner && !owner.disabled ? owner : undefined;
}

/**
 * Runs the profiles that back up to or from `storageId` when it is plugged in: auto-run
 * on, not run in the last hour, not already running, and both drives available. Each runs as the
 * user who made it, and a `backup.triggered` notice goes to them. Returns the started job ids.
 */
export async function runAutoProfiles(storageId: string, now = Date.now()): Promise<string[]> {
  const { findActiveProfileJob, startBackup } = await import("@/server/backup");
  const started: string[] = [];
  for (const profileRow of findAutoRunProfiles(storageId)) {
    if (profileRow.lastRunAt && now - profileRow.lastRunAt.getTime() < AUTO_RUN_COOLDOWN_MILLISECONDS) continue;
    if (findActiveProfileJob(profileRow.id)) continue;
    const owner = readProfileOwner(profileRow);
    if (!owner) continue;
    try {
      const job = startBackup(
        { id: owner.id, username: owner.username, role: owner.role },
        { profileId: profileRow.id },
      );
      started.push(job.id);
      getEventBus().emit("backup.triggered", {
        ownerId: owner.id,
        profileId: profileRow.id,
        name: profileRow.name,
        jobId: job.id,
        storageId,
      });
    } catch (startError) {
      console.error(`[ccm] backup profile "${profileRow.name}" could not start`, startError);
    }
  }
  return started;
}

/**
 * Watches for drives being plugged in or mounted (`drive.added`, or a `drive.updated` that turns
 * an unmounted drive available; capacity updates don't count). After a short settle delay it
 * resumes backups waiting for that drive, then runs its auto-run profiles. Returns a function
 * that stops watching.
 */
export function registerBackupTriggers(): () => void {
  const pendingTimers = new Map<string, NodeJS.Timeout>();
  const knownAvailability = new Map<string, boolean>();
  const schedule = (storageId: string) => {
    clearTimeout(pendingTimers.get(storageId));
    const timer = setTimeout(() => {
      pendingTimers.delete(storageId);
      if (!findActiveStorage(storageId)?.available) return;
      resumeWaitingBackups(storageId);
      runAutoProfiles(storageId).catch((triggerError: unknown) =>
        console.error(`[ccm] backup triggers for ${storageId} failed`, triggerError),
      );
    }, readTriggerSettings().settleMilliseconds);
    timer.unref();
    pendingTimers.set(storageId, timer);
  };
  const handleDriveAdded = (driveEvent: DriveEvent) => {
    knownAvailability.set(driveEvent.storageId, driveEvent.available);
    if (driveEvent.available) schedule(driveEvent.storageId);
  };
  const handleDriveUpdated = (driveEvent: DriveEvent) => {
    const wasAvailable = knownAvailability.get(driveEvent.storageId);
    knownAvailability.set(driveEvent.storageId, driveEvent.available);
    if (driveEvent.available && wasAvailable === false) schedule(driveEvent.storageId);
  };
  const handleDriveRemoved = (driveEvent: DriveEvent) => {
    knownAvailability.set(driveEvent.storageId, false);
    clearTimeout(pendingTimers.get(driveEvent.storageId));
    pendingTimers.delete(driveEvent.storageId);
  };
  const eventBus = getEventBus();
  eventBus.on("drive.added", handleDriveAdded);
  eventBus.on("drive.updated", handleDriveUpdated);
  eventBus.on("drive.removed", handleDriveRemoved);
  return () => {
    eventBus.off("drive.added", handleDriveAdded);
    eventBus.off("drive.updated", handleDriveUpdated);
    eventBus.off("drive.removed", handleDriveRemoved);
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
}
