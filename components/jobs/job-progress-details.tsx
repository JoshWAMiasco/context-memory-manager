"use client";

import { ProgressBar } from "@/components/primitives/progress-bar";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { JobSummary } from "@/lib/api-types";
import { formatTimeLeft, readJobPercentage } from "@/lib/client/jobs";
import { mergeClassNames } from "@/utilities/merge-class-names";

function readDetails(job: JobSummary): string[] {
  const { progress, status } = job;
  if (status === "queued") return ["Waiting for another job on this storage to finish"];
  if (progress.total <= 0) return ["Listing files…"];
  const details = [
    progress.unit === "bytes"
      ? `${formatFileSize(progress.done)} of ${formatFileSize(progress.total)}`
      : `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`,
  ];
  if (progress.files) {
    details.push(`${progress.files.done.toLocaleString()} of ${progress.files.total.toLocaleString()} files`);
  }
  if (status === "paused") return [...details, "Paused"];
  if (progress.speed && progress.unit === "bytes") details.push(`${formatFileSize(progress.speed)}/s`);
  if (progress.eta !== undefined && progress.done < progress.total) details.push(formatTimeLeft(progress.eta));
  return details;
}

/**
 * A job's progress bar with bytes, files, speed and time left. The bar glides between updates
 * (they arrive about four times a second), and pulses while the job is still listing its files.
 *
 * @example
 * <JobProgressDetails job={job} />
 */
export function JobProgressDetails({
  job,
  showsTitle = true,
  showsCurrentItem = true,
  className,
}: {
  job: JobSummary;
  showsTitle?: boolean;
  showsCurrentItem?: boolean;
  className?: string;
}) {
  const percentage = readJobPercentage(job.progress);
  const isPaused = job.status === "paused";
  return (
    <div
      className={mergeClassNames("grid grid-cols-1 gap-1.5", className)}
      data-testid="job-progress"
      data-job-id={job.id}
      data-status={job.status}
      data-percentage={percentage ?? ""}
    >
      {(showsTitle || percentage !== undefined) && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-medium">{showsTitle ? job.title : ""}</span>
          {percentage !== undefined && <span className="tabular-nums">{percentage}%</span>}
        </div>
      )}
      {percentage === undefined ? (
        <div className="h-2 w-full animate-pulse rounded-sm bg-primary/30 motion-reduce:animate-none" />
      ) : (
        <ProgressBar
          value={percentage}
          tone={isPaused ? "warning" : "primary"}
          fillClassName="transition-[width] duration-300 ease-linear motion-reduce:transition-none"
        />
      )}
      <div className="flex flex-wrap gap-x-2 text-xs text-foreground-subtle tabular-nums">
        {readDetails(job).map((detail, detailIndex) => (
          <span key={detail}>
            {detailIndex > 0 && <span aria-hidden>· </span>}
            {detail}
          </span>
        ))}
      </div>
      {showsCurrentItem && job.status === "running" && job.progress.currentItem && (
        <div className="truncate font-mono text-xs text-foreground-faint" title={job.progress.currentItem}>
          {job.progress.currentItem}
        </div>
      )}
    </div>
  );
}
