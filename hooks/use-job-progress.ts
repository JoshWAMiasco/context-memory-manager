"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent } from "@/hooks/use-server-events";
import type { JobProgress, JobStatus, JobSummary } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";

export interface JobProgressState {
  status: JobStatus;
  progress?: JobProgress;
  error?: string;
}

const FINISHED_STATUSES: readonly JobStatus[] = ["done", "failed", "cancelled"];

/**
 * Follows one job through server events: its status, latest progress and error. Pass the job the
 * server returned when it was started; `onFinished` runs once when it ends. A short job can finish
 * before its events reach the tab, so the job's current state is also read once at the start.
 *
 * @example
 * const jobState = useJobProgress(startedJob, () => refetch());
 */
export function useJobProgress(
  job: JobSummary | undefined,
  onFinished?: (job: JobSummary) => void,
): JobProgressState | undefined {
  const [state, setState] = useState<JobProgressState>();
  const [trackedJobId, setTrackedJobId] = useState<string>();
  const finishedJobIdsRef = useRef(new Set<string>());
  const onFinishedRef = useRef(onFinished);
  if (job && job.id !== trackedJobId) {
    setTrackedJobId(job.id);
    setState({ status: job.status, progress: job.progress, error: job.error });
  }

  useEffect(() => {
    onFinishedRef.current = onFinished;
  });

  const acceptJob = useCallback((updatedJob: JobSummary) => {
    setState({ status: updatedJob.status, progress: updatedJob.progress, error: updatedJob.error });
    if (!FINISHED_STATUSES.includes(updatedJob.status) || finishedJobIdsRef.current.has(updatedJob.id)) return;
    finishedJobIdsRef.current.add(updatedJob.id);
    onFinishedRef.current?.(updatedJob);
  }, []);

  const jobId = job?.id;
  useEffect(() => {
    if (!jobId) return;
    let isCurrent = true;
    requestJson<{ jobs: JobSummary[] }>("/api/jobs").then(
      ({ jobs }) => {
        const currentJob = jobs.find((listedJob) => listedJob.id === jobId);
        if (isCurrent && currentJob) acceptJob(currentJob);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [acceptJob, jobId]);

  const handleProgress = useCallback(
    ({ jobId: progressJobId, progress }: { jobId: string; progress: JobProgress }) => {
      if (progressJobId === jobId)
        setState((previous) => ({ status: previous?.status ?? "running", ...previous, progress }));
    },
    [jobId],
  );
  const handleState = useCallback(
    ({ job: updatedJob }: { job: JobSummary }) => {
      if (updatedJob.id === jobId) acceptJob(updatedJob);
    },
    [acceptJob, jobId],
  );
  useServerEvent("job.progress", handleProgress);
  useServerEvent("job.state", handleState);
  return job ? state : undefined;
}
