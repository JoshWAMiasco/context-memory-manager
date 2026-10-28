"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { FolderOpen, ServerCog } from "lucide-react";
import { Card } from "@/components/primitives/card";
import { buildJobsHref } from "@/components/jobs/run-as-job";
import type { TerminalSummary } from "@/lib/api-types";
import { formatRunningTime } from "@/lib/terminal";
import { mergeClassNames } from "@/utilities/merge-class-names";

const CLOCK_INTERVAL_MILLISECONDS = 15_000;
const clockListeners = new Set<() => void>();
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const clockListener of clockListeners) clockListener();
    }, CLOCK_INTERVAL_MILLISECONDS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/**
 * The time now, updated every 15 seconds while something shows a running time (0 on the server).
 *
 * @example
 * const now = useNow();
 */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeToClock,
    () => clockNow || Date.now(),
    () => 0,
  );
}

/**
 * When a job started, as the viewer's locale writes a date and time.
 *
 * @example
 * formatStartedAt("2026-10-28T08:00:00Z"); // "Oct 28, 2026, 8:00 AM" (en-US)
 */
export function formatStartedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Where a job runs: its storage, and the folder in it.
 *
 * @example
 * formatJobLocation(job); // "Home / projects/site"
 */
export function formatJobLocation(job: TerminalSummary): string {
  return job.path === "" ? job.storageLabel : `${job.storageLabel} / ${job.path}`;
}

/**
 * A job's state: running (pulsing), or ended with its exit code.
 *
 * @example
 * <JobStatus job={job} exitCode={exitCode} />
 */
export function JobStatus({ job, exitCode }: { job: TerminalSummary; exitCode?: number }) {
  const hasExited = job.status === "exited" || exitCode !== undefined;
  const code = exitCode ?? job.exitCode;
  return (
    <span
      className={mergeClassNames(
        "inline-flex flex-none items-center gap-1.5 text-xs",
        hasExited ? "text-foreground-subtle" : "text-success",
      )}
      data-testid="job-status"
    >
      <span className="relative flex h-2 w-2">
        {!hasExited && <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />}
        <span
          className={mergeClassNames("relative h-2 w-2 rounded-full", hasExited ? "bg-line-strong" : "bg-success")}
        />
      </span>
      {hasExited ? `Ended${code ? ` (${code})` : ""}` : "Running"}
    </span>
  );
}

/**
 * A job as a card (the Jobs page, the dashboard): its title and state, when it started, how long
 * it has run and where. The whole card opens the job.
 *
 * @example
 * <JobCard job={job} />
 */
export function JobCard({ job }: { job: TerminalSummary }) {
  const now = useNow();
  return (
    <Card
      className="group/job relative flex flex-col gap-3 p-4 transition-colors hover:border-brand/60"
      data-testid="job-card"
      data-terminal-id={job.id}
    >
      <div className="flex items-center gap-2.5">
        <ServerCog className="h-5 w-5 flex-none stroke-[1.2] text-brand" />
        <Link
          href={buildJobsHref(job.id)}
          className="min-w-0 flex-1 truncate font-medium group-hover/job:text-brand after:absolute after:inset-0 after:content-['']"
        >
          {job.title}
        </Link>
        <JobStatus job={job} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-foreground-subtle">Started</dt>
        <dd className="truncate" data-testid="job-started">
          {now ? formatStartedAt(job.createdAt) : ""}
        </dd>
        <dt className="text-foreground-subtle">Running for</dt>
        <dd className="truncate" data-testid="job-running-time">
          {now ? (job.status === "exited" ? "—" : formatRunningTime(job.createdAt, now)) : ""}
        </dd>
        <dt className="text-foreground-subtle">Location</dt>
        <dd className="flex min-w-0 items-center gap-1" title={formatJobLocation(job)}>
          <FolderOpen className="h-3.5 w-3.5 flex-none stroke-[1.3] text-foreground-subtle" />
          <span className="truncate" data-testid="job-location">
            {formatJobLocation(job)}
          </span>
        </dd>
      </dl>
    </Card>
  );
}
