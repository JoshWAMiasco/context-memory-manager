"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { JobProgress, JobStatus, JobSummary } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { QUERY_KEYS } from "@/lib/client/query-keys";

const ACTIVE_STATUSES: readonly JobStatus[] = ["queued", "running", "paused"];

/** How often the job list is read again while a job runs, in case server events were missed. */
const FALLBACK_REFRESH_MILLISECONDS = 5000;

/** What each encryption job does, for labels and the toast when it ends. */
export const CRYPTO_JOB_ACTIVITY: Record<string, { running: string; done: string }> = {
  "crypto.encrypt": { running: "Encrypting", done: "Encryption finished" },
  "crypto.decrypt": { running: "Decrypting", done: "Decryption finished" },
  "crypto.rekey": { running: "Re-keying", done: "Re-key finished" },
};

export function isActiveJob(job: JobSummary): boolean {
  return ACTIVE_STATUSES.includes(job.status);
}

/** How far a job is, 0–100, or undefined while it doesn't know its total yet. */
export function readJobPercentage(progress: JobProgress): number | undefined {
  if (progress.total <= 0) return undefined;
  return Math.min(100, Math.floor((progress.done / progress.total) * 100));
}

/**
 * "about 40 s left", "about 3 min left", "about 1 h 5 min left".
 *
 * @example
 * formatTimeLeft(200); // "about 3 min left"
 */
export function formatTimeLeft(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/**
 * The jobs this user started (admins: every job), kept live by server events: progress and
 * state changes are written into this cache, so every progress bar moves together.
 *
 * @example
 * const { data: jobs } = useJobs();
 */
export function useJobs() {
  return useQuery({
    queryKey: QUERY_KEYS.jobs(),
    queryFn: ({ signal }) => requestJson<{ jobs: JobSummary[] }>("/api/jobs", { signal }).then(({ jobs }) => jobs),
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "running" || job.status === "queued")
        ? FALLBACK_REFRESH_MILLISECONDS
        : false,
  });
}

/** Queued, running and paused jobs, oldest first. */
export function useActiveJobs(): JobSummary[] {
  const { data: jobs } = useJobs();
  return (jobs ?? []).filter(isActiveJob).toReversed();
}

/**
 * The active job working on a folder (an encrypted folder being decrypted), if this user can see it.
 *
 * @example
 * const job = useFolderJob(storageId, "vault");
 */
export function useFolderJob(storageId: string, folderPath: string): JobSummary | undefined {
  return useActiveJobs().find((job) => job.target?.storageId === storageId && job.target.path === folderPath);
}

/** Writes a `job.progress` event into the cached job list. */
export function applyJobProgress(queryClient: QueryClient, jobId: string, progress: JobProgress): void {
  queryClient.setQueryData<JobSummary[]>(QUERY_KEYS.jobs(), (jobs) =>
    jobs?.map((job) =>
      job.id === jobId ? { ...job, progress, status: job.status === "queued" ? "running" : job.status } : job,
    ),
  );
}

/** Writes a `job.state` event into the cached job list (a new job goes first). */
export function applyJobState(queryClient: QueryClient, updatedJob: JobSummary): void {
  queryClient.setQueryData<JobSummary[]>(QUERY_KEYS.jobs(), (jobs) => {
    if (!jobs) return jobs;
    if (!jobs.some((job) => job.id === updatedJob.id)) return [updatedJob, ...jobs];
    return jobs.map((job) => (job.id === updatedJob.id ? updatedJob : job));
  });
}

/**
 * Pause, resume and cancel for a job (`POST /api/jobs/<id>/<action>`); the job list updates from
 * the response and the server's events.
 *
 * @example
 * const { controlJob } = useJobControls();
 * controlJob.mutate({ jobId, action: "pause" });
 */
export function useJobControls() {
  const queryClient = useQueryClient();
  const controlJob = useMutation({
    mutationFn: ({ jobId, action }: { jobId: string; action: "pause" | "resume" | "cancel" }) =>
      requestJson<{ job: JobSummary }>(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" }),
    onSuccess: ({ job }) => applyJobState(queryClient, job),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs() }),
  });
  return { controlJob };
}
