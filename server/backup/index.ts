import "server-only";
import type { BackupMode, BackupPreview, JobSummary } from "@/lib/api-types";
import { ADHOC_BACKUP_NAME, type AdhocBackup } from "@/lib/backup";
import { BACKUP_JOB_TYPE, ensureBackupJobType, type BackupJobPayload } from "@/server/backup/job";
import { buildPartsPlan } from "@/server/backup/plan";
import { requireProfile, requireSourceAccess, toBackupSpec, type BackupSpec } from "@/server/backup/profiles";
import { readRunOptions, resolveBackupTarget, toPlanParts } from "@/server/backup/target";
import { registerBackupTriggers } from "@/server/backup/triggers";
import { ApiRouteError } from "@/server/http/api-error";
import { getJobQueue } from "@/server/jobs/queue";
import type { BackgroundService } from "@/server/services";
import type { FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess } from "@/server/storage/roots";

/** The preview lists at most this many deletions and warnings; the counts cover all of them. */
const PREVIEW_LIST_LIMIT = 200;

/** What to run: a saved profile, or settings sent with the request. */
export type BackupRequest = { profileId: string } | { adhoc: AdhocBackup };

interface ResolvedRequest {
  spec: BackupSpec;
  name: string;
  profileId?: string;
}

/** The settings a run uses, from the profile (which `actor` must be able to see) or the request. */
export function resolveBackupRequest(actor: FileActor, request: BackupRequest): ResolvedRequest {
  if ("profileId" in request) {
    const profileRow = requireProfile(actor, request.profileId);
    return { spec: toBackupSpec(profileRow), name: profileRow.name, profileId: profileRow.id };
  }
  const { source, destination, mode, autoResume, memory, ...options } = request.adhoc;
  const spec: BackupSpec = { source, destination, mode, options, autoResume };
  if (memory) spec.memory = requireSourceAccess(actor, { source, memory });
  return { spec, name: memory?.name.trim() ?? ADHOC_BACKUP_NAME };
}

/** The mode a request would run in (mirror runs need the password). */
export function readRequestMode(actor: FileActor, request: BackupRequest): BackupMode {
  return resolveBackupRequest(actor, request).spec.mode;
}

/**
 * A dry run: what a run would copy, skip and (mirror) move to the trash right now, with
 * the warnings and whether the destination has room. Nothing is written.
 *
 * @example
 * const preview = await previewBackup(actor, { profileId });
 */
export async function previewBackup(actor: FileActor, request: BackupRequest): Promise<BackupPreview> {
  const { spec } = resolveBackupRequest(actor, request);
  const target = await resolveBackupTarget(actor, spec);
  const plan = await buildPartsPlan({
    parts: toPlanParts(target),
    dest: { absolutePath: target.targetAbsolutePath, ...target.volume },
    mode: spec.mode,
    options: readRunOptions(target, spec.options),
  });
  const removals = [...plan.replace, ...plan.delete];
  return {
    targetPath: target.targetPath,
    fsType: target.volume.fsType,
    copyFiles: plan.filesTotal,
    copyBytes: plan.bytesTotal,
    skipFiles: plan.skip,
    deleteCount: removals.length,
    deletePaths: removals.slice(0, PREVIEW_LIST_LIMIT).map((removal) => removal.targetPath),
    warnings: plan.warnings.slice(0, PREVIEW_LIST_LIMIT),
    warningCount: plan.warnings.length,
    requiredBytes: plan.requiredBytes,
    freeBytes: plan.freeBytes,
    insufficientSpace: plan.insufficientSpace,
  };
}

/** The active (queued, running or paused) backup job of a profile, if any. */
export function findActiveProfileJob(profileId: string): JobSummary | undefined {
  return getJobQueue()
    .listActive()
    .find((job) => job.type === BACKUP_JOB_TYPE && job.transfer?.profileId === profileId);
}

/**
 * Queues a backup run after checking `read` on the source and `write` on the
 * destination (both plugged in). A profile runs once at a time (409 `BACKUP_RUNNING`).
 *
 * @example
 * const job = startBackup(actor, { profileId });
 */
export function startBackup(actor: FileActor, request: BackupRequest): JobSummary {
  const { spec, name, profileId } = resolveBackupRequest(actor, request);
  const sourceStorage = requireStorageAccess(actor, spec.source.storageId, "read");
  const destinationStorage = requireStorageAccess(actor, spec.destination.storageId, "write");
  if (profileId && findActiveProfileJob(profileId)) {
    throw new ApiRouteError(409, "BACKUP_RUNNING", `"${name}" is already running.`);
  }
  const payload: BackupJobPayload = {
    name,
    spec,
    sourceLabel: sourceStorage.label,
    destinationLabel: destinationStorage.label,
    actor: { id: actor.id, username: actor.username, role: actor.role },
  };
  if (profileId) payload.profileId = profileId;
  return getJobQueue().enqueue(ensureBackupJobType(), payload, actor.id);
}

/**
 * The backup service: runs profiles when their drive is plugged in, and resumes backups
 * whose drive comes back. (History rows follow their jobs from `ensureBackupJobType`.)
 *
 * @example
 * const BACKGROUND_SERVICES = [createBackupService(), …];
 */
export function createBackupService(): BackgroundService {
  let stopTriggers: (() => void) | undefined;
  return {
    name: "backup",
    start: () => {
      ensureBackupJobType();
      stopTriggers = registerBackupTriggers();
    },
    stop: () => {
      stopTriggers?.();
    },
  };
}
