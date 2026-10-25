"use client";

import { CheckCircle, FolderOpen, XCircle } from "lucide-react";
import { useCallback } from "react";
import { useBackupToasts } from "@/components/backup/backup-toasts";
import { DropdownMenu, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { JobProgressDetails } from "@/components/jobs/job-progress-details";
import { useServerEvent } from "@/hooks/use-server-events";
import type { JobSummary } from "@/lib/api-types";
import { CRYPTO_JOB_ACTIVITY, readJobPercentage, useActiveJobs } from "@/lib/client/jobs";
import { readBaseName } from "@/lib/client/query-keys";
import { buildStorageHref } from "@/lib/client/routes";

const RING_RADIUS = 15;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function readOverallPercentage(jobs: JobSummary[]): number | undefined {
  const measured = jobs.filter((job) => readJobPercentage(job.progress) !== undefined);
  if (measured.length === 0) return undefined;
  if (measured.every((job) => job.progress.unit === measured[0]?.progress.unit)) {
    const done = measured.reduce((sum, job) => sum + job.progress.done, 0);
    const total = measured.reduce((sum, job) => sum + job.progress.total, 0);
    return Math.min(100, Math.floor((done / total) * 100));
  }
  return Math.floor(measured.reduce((sum, job) => sum + (readJobPercentage(job.progress) ?? 0), 0) / measured.length);
}

/** A toast when an encryption job ends: they run for a while, often after the dialog was closed. */
function useCryptoJobToasts(): void {
  const handleState = useCallback(({ job }: { job: JobSummary }) => {
    const activity = CRYPTO_JOB_ACTIVITY[job.type];
    if (!activity || (job.status !== "done" && job.status !== "failed")) return;
    const folderName = job.target ? readBaseName(job.target.path) || "storage" : job.title;
    if (job.status === "done") {
      showToastNotification({
        title: activity.done,
        description:
          job.type === "crypto.decrypt"
            ? `"${folderName}" is no longer encrypted. Its files are plaintext on disk again.`
            : `"${folderName}" is encrypted and unlocked for this session.`,
        icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" />,
        durationInMilliseconds: 8000,
      });
      return;
    }
    showToastNotification({
      title: `${activity.running} "${folderName}" stopped`,
      description: job.error ?? "Open the folder's Encryption settings to resume it.",
      icon: <XCircle className="h-5 w-5 stroke-[1] text-danger" />,
      durationInMilliseconds: 10_000,
    });
  }, []);
  useServerEvent("job.state", handleState);
}

/**
 * The background jobs indicator in the top bar: a ring that fills with the overall progress of
 * every queued, running or paused job (decrypting a large folder, copying to a USB stick), and a
 * menu with each job's progress and a link to its folder. Hidden while nothing runs. It also
 * announces when an encryption job or a backup ends.
 *
 * @example
 * <BackgroundJobsButton />
 */
export function BackgroundJobsButton({ className }: { className?: string }) {
  useCryptoJobToasts();
  useBackupToasts();
  const jobs = useActiveJobs();
  if (jobs.length === 0) return null;
  const percentage = readOverallPercentage(jobs);
  const isRunning = jobs.some((job) => job.status === "running");
  const label = `${jobs.length} background job${jobs.length === 1 ? "" : "s"}${percentage === undefined ? "" : `, ${percentage}% done`}`;
  return (
    <DropdownMenu
      className={className}
      menuClassName="mt-1 w-96 max-w-[calc(100vw-2rem)]"
      triggerClassName="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-muted"
      triggerLabel={label}
      trigger={
        <span title={label} data-testid="background-jobs-button" data-percentage={percentage ?? ""}>
          <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r={RING_RADIUS} fill="none" strokeWidth="3" className="stroke-surface-strong" />
            {percentage === undefined ? (
              <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${RING_CIRCUMFERENCE / 4} ${RING_CIRCUMFERENCE}`}
                className="origin-center animate-spin stroke-primary motion-reduce:animate-none"
              />
            ) : (
              <circle
                cx="18"
                cy="18"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - percentage / 100)}
                className={`transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none ${isRunning ? "stroke-primary" : "stroke-warning"}`}
              />
            )}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums">
            {percentage === undefined ? jobs.length : `${percentage}`}
          </span>
        </span>
      }
    >
      <div className="px-2 py-1.5 text-xs text-foreground-muted">
        Running in the background. Closing this page doesn&rsquo;t stop them.
      </div>
      <div className="grid gap-1" data-testid="background-jobs-list">
        {jobs.map((job) => (
          <div key={job.id} className="grid gap-1 rounded-md px-2 py-2">
            <JobProgressDetails job={job} showsCurrentItem={false} />
            {job.target && (
              <DropdownMenuItem
                href={buildStorageHref(job.target.storageId, job.target.path)}
                icon={<FolderOpen className="mr-2 h-4 w-4 flex-none stroke-[1]" />}
                className="-mx-2"
              >
                Open folder
              </DropdownMenuItem>
            )}
          </div>
        ))}
      </div>
    </DropdownMenu>
  );
}
