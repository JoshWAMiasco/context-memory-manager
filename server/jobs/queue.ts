import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { JobProgress, JobStatus, JobSummary, JobTarget, JobTransfer } from "@/lib/api-types";
import { getDatabase } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, notFound, validationFailed } from "@/server/http/api-error";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import type { StorageActor } from "@/server/storage/roots";

export const MAX_RUNNING_JOBS = 3;
export const PROGRESS_THROTTLE_MILLISECONDS = 250;
export const INTERRUPTED_MESSAGE = "Interrupted when CMM stopped. Resume it to continue.";

export type JobRow = typeof jobs.$inferSelect;

/** Marks pause requests with a registry symbol, so every copy of this module recognises them. */
const JOB_PAUSE_REQUEST_BRAND = Symbol.for("cmm.job-pause-request");

/**
 * Thrown by a job handler to stop as "paused" with a reason people can read (a backup whose drive
 * was unplugged); it resumes from its last checkpoint like any paused job. `instanceof`
 * also recognises one thrown by another copy of this module (the entry bundle and Next's chunks).
 */
export class JobPauseRequest extends Error {
  override name = "JobPauseRequest";
  readonly [JOB_PAUSE_REQUEST_BRAND] = true;

  static override [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && JOB_PAUSE_REQUEST_BRAND in value;
  }
}

/** Who resumes a job that CMM resumes on its own (a backup whose drive came back). */
export const SYSTEM_JOB_ACTOR: StorageActor = { id: "system", role: "admin" };

/** What a job handler gets. `signal` aborts on pause and cancel; save a checkpoint to resume from. */
export interface JobContext<Payload, Checkpoint> {
  jobId: string;
  payload: Payload;
  checkpoint: Checkpoint | undefined;
  reportProgress: (progress: JobProgress) => void;
  saveCheckpoint: (checkpoint: Checkpoint) => void;
  signal: AbortSignal;
}

export interface JobDefinition<Payload, Checkpoint> {
  run: (context: JobContext<Payload, Checkpoint>) => Promise<void>;
  /** Volume keys (storage ids) the job uses: one running job per key. */
  readVolumeKeys: (payload: Payload) => string[];
  /** A title for people: "Copy 3 items to Backups". */
  describe: (payload: Payload) => string;
  /** The folder the job works on, so the UI can show its progress there (an encrypted folder). */
  readTarget?: (payload: Payload) => JobTarget;
  /** Folders nothing else should touch while the job runs (a move's source and destination folders). */
  readLocks?: (payload: Payload) => JobTarget[];
  /** Where a backup reads and writes, for the Backup page's topology. */
  readTransfer?: (payload: Payload) => JobTransfer;
  /** Restart automatically after CMM was stopped mid-run. Off by default: the job waits, paused. */
  autoResume?: boolean;
  /** Why a paused job can't simply be resumed (an encryption job needs its key file again). */
  readResumeBlocker?: (jobId: string) => string | undefined;
}

interface JobScope {
  volumeKeys: string[];
  title: string;
  target?: JobTarget;
  locks?: JobTarget[];
  transfer?: JobTransfer;
}

interface RunningJob {
  controller: AbortController;
  stopReason?: "pause" | "cancel";
  volumeKeys: string[];
  ownerId: string | null;
  startedAt: number;
  doneAtStart?: number;
  latestProgress?: JobProgress;
  lastProgressEmit: number;
  progressTimer?: NodeJS.Timeout;
}

type AnyJobDefinition = JobDefinition<never, never>;

function getJobTypeRegistry(): Map<string, AnyJobDefinition> {
  return getGlobalSingleton("job-types", () => new Map<string, AnyJobDefinition>());
}

/** Registers a job type by name; registering a name again replaces it. */
export function registerJobType<Payload, Checkpoint>(
  jobType: string,
  definition: JobDefinition<Payload, Checkpoint>,
): void {
  getJobTypeRegistry().set(jobType, definition as unknown as AnyJobDefinition);
}

function parseJson<Value>(jsonText: string | null): Value | undefined {
  return jsonText === null ? undefined : (JSON.parse(jsonText) as Value);
}

function readScope(jobRow: JobRow): JobScope {
  return parseJson<JobScope>(jobRow.scopeJson) ?? { volumeKeys: [], title: jobRow.type };
}

export function toJobSummary(jobRow: JobRow): JobSummary {
  const scope = readScope(jobRow);
  const summary: JobSummary = {
    id: jobRow.id,
    type: jobRow.type,
    status: jobRow.status,
    progress: parseJson<JobProgress>(jobRow.progressJson) ?? { done: 0, total: 0, unit: "items" },
    title: scope.title,
    createdAt: jobRow.createdAt.toISOString(),
    updatedAt: jobRow.updatedAt.toISOString(),
  };
  if (scope.target) summary.target = scope.target;
  if (scope.locks && scope.locks.length > 0) summary.locks = scope.locks;
  if (scope.transfer) summary.transfer = scope.transfer;
  if (jobRow.error) summary.error = jobRow.error;
  return summary;
}

/**
 * The persistent job queue. Jobs live in the `jobs` table; at most three run at once and
 * at most one per volume key, so two copies onto the same USB stick queue up. Pause and cancel
 * abort the handler's signal; a paused job resumes from its last checkpoint.
 */
export class JobQueue {
  private readonly running = new Map<string, RunningJob>();
  private readonly idleWaiters: (() => void)[] = [];

  enqueue<Payload>(jobType: string, payload: Payload, createdBy: string | null): JobSummary {
    const definition = getJobTypeRegistry().get(jobType) as unknown as JobDefinition<Payload, unknown> | undefined;
    if (!definition) throw new Error(`Unknown job type "${jobType}".`);
    const scope: JobScope = {
      volumeKeys: definition.readVolumeKeys(payload),
      title: definition.describe(payload),
      target: definition.readTarget?.(payload),
      locks: definition.readLocks?.(payload),
      transfer: definition.readTransfer?.(payload),
    };
    const jobRow = getDatabase()
      .orm.insert(jobs)
      .values({
        id: randomUUID(),
        type: jobType,
        status: "queued",
        scopeJson: JSON.stringify(scope),
        payloadJson: JSON.stringify(payload),
        createdBy,
        updatedAt: new Date(),
      })
      .returning()
      .get();
    this.emitState(jobRow);
    this.pump();
    return toJobSummary(jobRow);
  }

  /** The jobs `actor` started (admins see every job), newest first. */
  list(actor: StorageActor): JobSummary[] {
    const { orm } = getDatabase();
    const query = orm.select().from(jobs);
    const jobRows =
      actor.role === "admin"
        ? query.orderBy(desc(jobs.createdAt)).limit(200).all()
        : query.where(eq(jobs.createdBy, actor.id)).orderBy(desc(jobs.createdAt)).limit(200).all();
    return jobRows.map(toJobSummary);
  }

  /** Every queued, running or paused job, whoever started it (to refuse changes under a running job). */
  listActive(): JobSummary[] {
    return getDatabase()
      .orm.select()
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "running", "paused"]))
      .all()
      .map(toJobSummary);
  }

  get(jobId: string): JobRow | undefined {
    return getDatabase().orm.select().from(jobs).where(eq(jobs.id, jobId)).get();
  }

  private requireOwnJob(actor: StorageActor, jobId: string): JobRow {
    const jobRow = this.get(jobId);
    if (!jobRow || (actor.role !== "admin" && jobRow.createdBy !== actor.id))
      throw notFound("That job does not exist.");
    return jobRow;
  }

  pause(actor: StorageActor, jobId: string): JobSummary {
    const jobRow = this.requireOwnJob(actor, jobId);
    const runningJob = this.running.get(jobId);
    if (runningJob) {
      runningJob.stopReason = "pause";
      runningJob.controller.abort();
      return toJobSummary(jobRow);
    }
    if (jobRow.status !== "queued") throw validationFailed("Only a queued or running job can be paused.");
    return toJobSummary(this.updateStatus(jobId, "paused"));
  }

  resume(actor: StorageActor, jobId: string): JobSummary {
    const jobRow = this.requireOwnJob(actor, jobId);
    if (jobRow.status !== "paused") throw validationFailed("Only a paused job can be resumed.");
    const resumeBlocker = getJobTypeRegistry().get(jobRow.type)?.readResumeBlocker?.(jobId);
    if (resumeBlocker) throw validationFailed(resumeBlocker);
    const queuedRow = this.updateStatus(jobId, "queued", null);
    this.pump();
    return toJobSummary(queuedRow);
  }

  cancel(actor: StorageActor, jobId: string): JobSummary {
    const jobRow = this.requireOwnJob(actor, jobId);
    const runningJob = this.running.get(jobId);
    if (runningJob) {
      runningJob.stopReason = "cancel";
      runningJob.controller.abort();
      return toJobSummary(jobRow);
    }
    if (jobRow.status !== "queued" && jobRow.status !== "paused") {
      throw validationFailed("This job has already finished.");
    }
    return toJobSummary(this.updateStatus(jobId, "cancelled"));
  }

  /** Whether a queued or running job uses `volumeKey` (eject refuses then). */
  isVolumeBusy(volumeKey: string): boolean {
    const activeRows = getDatabase()
      .orm.select()
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "running"]))
      .all();
    return activeRows.some((jobRow) => readScope(jobRow).volumeKeys.includes(volumeKey));
  }

  /**
   * After a restart, jobs that were running are paused with "interrupted", unless their type
   * allows resuming on its own, then the queue starts.
   */
  recoverInterrupted(): number {
    const { orm } = getDatabase();
    const interruptedRows = orm.select().from(jobs).where(eq(jobs.status, "running")).all();
    for (const interruptedRow of interruptedRows) {
      if (this.running.has(interruptedRow.id)) continue;
      const autoResume = getJobTypeRegistry().get(interruptedRow.type)?.autoResume === true;
      this.updateStatus(interruptedRow.id, autoResume ? "queued" : "paused", autoResume ? null : INTERRUPTED_MESSAGE);
    }
    this.pump();
    return interruptedRows.length;
  }

  /** Resolves once no job is running or startable; for tests and shutdown. */
  waitForIdle(): Promise<void> {
    if (this.running.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stops running jobs as "paused" (shutdown), so they resume later. */
  async pauseAll(): Promise<void> {
    for (const runningJob of this.running.values()) {
      runningJob.stopReason = "pause";
      runningJob.controller.abort();
    }
    await this.waitForIdle();
  }

  /** Starts queued jobs, oldest first, while slots and volume keys are free. */
  pump(): void {
    if (this.running.size >= MAX_RUNNING_JOBS) return;
    const queuedRows = getDatabase()
      .orm.select()
      .from(jobs)
      .where(eq(jobs.status, "queued"))
      .orderBy(jobs.createdAt)
      .all();
    const busyKeys = new Set([...this.running.values()].flatMap((runningJob) => runningJob.volumeKeys));
    for (const queuedRow of queuedRows) {
      if (this.running.size >= MAX_RUNNING_JOBS) break;
      const { volumeKeys } = readScope(queuedRow);
      if (volumeKeys.some((volumeKey) => busyKeys.has(volumeKey))) continue;
      for (const volumeKey of volumeKeys) busyKeys.add(volumeKey);
      this.start(queuedRow, volumeKeys);
    }
  }

  private start(jobRow: JobRow, volumeKeys: string[]): void {
    const runningJob: RunningJob = {
      controller: new AbortController(),
      volumeKeys,
      ownerId: jobRow.createdBy,
      startedAt: Date.now(),
      lastProgressEmit: 0,
    };
    this.running.set(jobRow.id, runningJob);
    const runningRow = this.updateStatus(jobRow.id, "running", null);
    void this.execute(runningRow, runningJob);
  }

  private async execute(jobRow: JobRow, runningJob: RunningJob): Promise<void> {
    const definition = getJobTypeRegistry().get(jobRow.type) as unknown as JobDefinition<unknown, unknown> | undefined;
    let finalStatus: JobStatus = "done";
    let errorMessage: string | null = null;
    try {
      if (!definition) throw new Error(`Unknown job type "${jobRow.type}".`);
      await definition.run({
        jobId: jobRow.id,
        payload: parseJson(jobRow.payloadJson),
        checkpoint: parseJson(jobRow.checkpointJson),
        reportProgress: (progress) => this.reportProgress(jobRow.id, runningJob, progress),
        saveCheckpoint: (checkpoint) => {
          getDatabase()
            .orm.update(jobs)
            .set({ checkpointJson: JSON.stringify(checkpoint), updatedAt: new Date() })
            .where(eq(jobs.id, jobRow.id))
            .run();
        },
        signal: runningJob.controller.signal,
      });
    } catch (jobError) {
      if (jobError instanceof JobPauseRequest && runningJob.stopReason !== "cancel") {
        finalStatus = "paused";
        errorMessage = jobError.message;
      } else if (runningJob.controller.signal.aborted) {
        finalStatus = runningJob.stopReason === "cancel" ? "cancelled" : "paused";
      } else {
        finalStatus = "failed";
        errorMessage =
          jobError instanceof ApiRouteError || jobError instanceof Error ? jobError.message : "The job failed.";
        if (!(jobError instanceof ApiRouteError))
          console.error(`[cmm] job ${jobRow.id} (${jobRow.type}) failed`, jobError);
      }
    }
    clearTimeout(runningJob.progressTimer);
    this.flushProgress(jobRow.id, runningJob);
    this.running.delete(jobRow.id);
    this.updateStatus(jobRow.id, finalStatus, errorMessage);
    this.pump();
    if (this.running.size === 0) {
      for (const resolveWaiter of this.idleWaiters.splice(0)) resolveWaiter();
    }
  }

  private reportProgress(jobId: string, runningJob: RunningJob, progress: JobProgress): void {
    runningJob.doneAtStart ??= progress.done;
    const elapsedSeconds = (Date.now() - runningJob.startedAt) / 1000;
    const doneThisRun = progress.done - runningJob.doneAtStart;
    const speed = elapsedSeconds > 0.5 && doneThisRun > 0 ? doneThisRun / elapsedSeconds : undefined;
    runningJob.latestProgress = {
      ...progress,
      speed: progress.speed ?? speed,
      eta: progress.eta ?? (speed ? Math.max(0, (progress.total - progress.done) / speed) : undefined),
    };
    const sinceLastEmit = Date.now() - runningJob.lastProgressEmit;
    if (sinceLastEmit >= PROGRESS_THROTTLE_MILLISECONDS) {
      this.flushProgress(jobId, runningJob);
    } else {
      runningJob.progressTimer ??= setTimeout(() => {
        runningJob.progressTimer = undefined;
        this.flushProgress(jobId, runningJob);
      }, PROGRESS_THROTTLE_MILLISECONDS - sinceLastEmit);
    }
  }

  private flushProgress(jobId: string, runningJob: RunningJob): void {
    const progress = runningJob.latestProgress;
    if (!progress) return;
    runningJob.latestProgress = undefined;
    runningJob.lastProgressEmit = Date.now();
    getDatabase()
      .orm.update(jobs)
      .set({ progressJson: JSON.stringify(progress), updatedAt: new Date() })
      .where(eq(jobs.id, jobId))
      .run();
    getEventBus().emit("job.progress", { jobId, ownerId: runningJob.ownerId, progress });
  }

  private updateStatus(jobId: string, status: JobStatus, error?: string | null): JobRow {
    const statusChanges: Partial<JobRow> = { status, updatedAt: new Date() };
    if (error !== undefined) statusChanges.error = error;
    const jobRow = getDatabase().orm.update(jobs).set(statusChanges).where(eq(jobs.id, jobId)).returning().get();
    this.emitState(jobRow);
    return jobRow;
  }

  private emitState(jobRow: JobRow): void {
    getEventBus().emit("job.state", { ownerId: jobRow.createdBy, job: toJobSummary(jobRow) });
  }
}

export function getJobQueue(): JobQueue {
  return getGlobalSingleton(
    "job-queue",
    () => new JobQueue(),
    (storedValue) => typeof (storedValue as JobQueue | undefined)?.isVolumeBusy === "function",
  );
}
