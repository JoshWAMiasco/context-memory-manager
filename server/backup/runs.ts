import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
  BackupEndpoint,
  BackupMode,
  BackupRunError,
  BackupRunSummary,
  BackupWarning,
  JobSummary,
} from "@/lib/api-types";
import { getDatabase } from "@/server/db/client";
import { backupProfiles, backupRuns } from "@/server/db/schema";
import type { StorageActor } from "@/server/storage/roots";

export type BackupRunRow = typeof backupRuns.$inferSelect;

/** History keeps at most this many errors and warnings per run. */
export const MAX_RECORDED_ISSUES = 1000;

export interface RunCounters {
  bytesCopied: number;
  filesCopied: number;
  filesSkipped: number;
  filesDeleted: number;
  errors: BackupRunError[];
  warnings: BackupWarning[];
}

export interface RunStart {
  jobId: string;
  profileId?: string;
  name: string;
  mode: BackupMode;
  source: BackupEndpoint & { label: string };
  destination: BackupEndpoint & { label: string };
  createdBy: string | null;
}

/**
 * Records that a backup job started or resumed: one History row per job, created the
 * first time and set back to "running" on each resume.
 */
export function recordRunStart(start: RunStart): BackupRunRow {
  const { orm } = getDatabase();
  const existing = orm.select().from(backupRuns).where(eq(backupRuns.jobId, start.jobId)).get();
  if (existing) {
    return orm
      .update(backupRuns)
      .set({ status: "running", endedAt: null, message: null })
      .where(eq(backupRuns.id, existing.id))
      .returning()
      .get();
  }
  // The profile may have been deleted while its run waited in the queue.
  const profileExists =
    start.profileId !== undefined &&
    orm.select({ id: backupProfiles.id }).from(backupProfiles).where(eq(backupProfiles.id, start.profileId)).get() !==
      undefined;
  return orm
    .insert(backupRuns)
    .values({
      id: randomUUID(),
      jobId: start.jobId,
      profileId: profileExists ? (start.profileId ?? null) : null,
      name: start.name,
      mode: start.mode,
      sourceJson: JSON.stringify(start.source),
      destinationJson: JSON.stringify(start.destination),
      status: "running",
      startedAt: new Date(),
      createdBy: start.createdBy,
    })
    .returning()
    .get();
}

/** Saves a run's counts, errors and warnings so far. */
export function recordRunCounters(jobId: string, counters: RunCounters): void {
  getDatabase()
    .orm.update(backupRuns)
    .set({
      bytesCopied: counters.bytesCopied,
      filesCopied: counters.filesCopied,
      filesSkipped: counters.filesSkipped,
      filesDeleted: counters.filesDeleted,
      errorsJson: JSON.stringify(counters.errors.slice(0, MAX_RECORDED_ISSUES)),
      warningsJson: JSON.stringify(counters.warnings.slice(0, MAX_RECORDED_ISSUES)),
    })
    .where(eq(backupRuns.jobId, jobId))
    .run();
}

const RUN_STATUSES = new Set<BackupRunRow["status"]>(["running", "paused", "done", "failed", "cancelled"]);

/**
 * Keeps a run's status in step with its job (the queue's `job.state` events): paused, done,
 * failed or cancelled, with the job's message and an end time once it is over.
 */
export function syncRunWithJob(job: JobSummary): void {
  if (!RUN_STATUSES.has(job.status as BackupRunRow["status"])) return;
  const status = job.status as BackupRunRow["status"];
  const isOver = status === "done" || status === "failed" || status === "cancelled";
  getDatabase()
    .orm.update(backupRuns)
    .set({ status, message: job.error ?? null, endedAt: isOver ? new Date() : null })
    .where(eq(backupRuns.jobId, job.id))
    .run();
}

function parseJson<Value>(jsonText: string, fallback: Value): Value {
  try {
    return JSON.parse(jsonText) as Value;
  } catch {
    return fallback;
  }
}

export function toRunSummary(runRow: BackupRunRow): BackupRunSummary {
  return {
    id: runRow.id,
    jobId: runRow.jobId,
    profileId: runRow.profileId,
    name: runRow.name,
    mode: runRow.mode,
    source: parseJson(runRow.sourceJson, { storageId: "", path: "", label: "" }),
    destination: parseJson(runRow.destinationJson, { storageId: "", path: "", label: "" }),
    status: runRow.status,
    startedAt: runRow.startedAt.toISOString(),
    endedAt: runRow.endedAt?.toISOString() ?? null,
    bytesCopied: runRow.bytesCopied,
    filesCopied: runRow.filesCopied,
    filesSkipped: runRow.filesSkipped,
    filesDeleted: runRow.filesDeleted,
    errors: parseJson(runRow.errorsJson, []),
    warnings: parseJson(runRow.warningsJson, []),
    message: runRow.message,
  };
}

/** Backup History, newest first: the runs `actor` started (admins see every run). */
export function listRuns(
  actor: StorageActor,
  { profileId, limit = 200 }: { profileId?: string; limit?: number } = {},
): BackupRunSummary[] {
  const conditions = [];
  if (actor.role !== "admin") conditions.push(eq(backupRuns.createdBy, actor.id));
  if (profileId) conditions.push(eq(backupRuns.profileId, profileId));
  return getDatabase()
    .orm.select()
    .from(backupRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(backupRuns.startedAt))
    .limit(Math.min(Math.max(1, limit), 500))
    .all()
    .map(toRunSummary);
}

/** A profile's latest run, for its card. */
export function readLatestRun(profileId: string): BackupRunSummary | undefined {
  const runRow = getDatabase()
    .orm.select()
    .from(backupRuns)
    .where(eq(backupRuns.profileId, profileId))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)
    .get();
  return runRow ? toRunSummary(runRow) : undefined;
}
