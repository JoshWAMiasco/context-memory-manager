"use client";

import { ArrowRight, HardDriveDownload, Pause, Play, X } from "lucide-react";
import { BackupModeBadge } from "@/components/backup/backup-mode-badge";
import { JobProgressDetails } from "@/components/jobs/job-progress-details";
import { Button } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import { EmptyState } from "@/components/primitives/empty-state";
import { StaticAlert } from "@/components/primitives/static-alert";
import type { BackupPhase, JobSummary, StorageSummary } from "@/lib/api-types";
import { isActiveJob, useJobControls } from "@/lib/client/jobs";

const PHASE_LABELS: Record<BackupPhase, string> = {
  scanning: "Scanning",
  copying: "Copying",
  verifying: "Verifying",
  deleting: "Moving deleted files to Trash",
  done: "Finishing",
};

function describeEndpoint(storages: readonly StorageSummary[], storageId: string, endpointPath: string): string {
  const label = storages.find((storage) => storage.id === storageId)?.label ?? "Unplugged drive";
  return endpointPath === "" ? label : `${label} / ${endpointPath}`;
}

function readStatusText(job: JobSummary): string {
  if (job.status === "queued") return "Waiting";
  if (job.status === "paused") return "Paused";
  return job.progress.phase ? PHASE_LABELS[job.progress.phase] : "Starting";
}

/**
 * The Active jobs tab: a card per queued, running or paused backup with source →
 * destination, its mode, progress (bytes, files, speed, time left, the current file), why it is
 * paused ("Drive disconnected — will resume when reconnected"), and Pause, Resume and Cancel.
 *
 * @example
 * <BackupJobPanel jobs={backupJobs} storages={storages} />
 */
export function BackupJobPanel({ jobs, storages }: { jobs: JobSummary[]; storages: StorageSummary[] }) {
  const { controlJob } = useJobControls();
  const activeJobs = jobs.filter(isActiveJob);
  if (activeJobs.length === 0) {
    return (
      <EmptyState
        className="py-10"
        icon={<HardDriveDownload className="h-10 w-10 stroke-[1]" />}
        title="No backups running"
        description="Run a profile, or drag from this computer to a drive in the picture above to plan one."
      />
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="backup-job-panel">
      {activeJobs.map((job) => {
        const transfer = job.transfer;
        const isBusy = controlJob.isPending && controlJob.variables?.jobId === job.id;
        return (
          <Card
            key={job.id}
            className="grid gap-3 p-4"
            data-testid="backup-job-card"
            data-job-id={job.id}
            data-status={job.status}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {transfer && (
                <>
                  <span className="min-w-0 truncate font-medium">
                    {describeEndpoint(storages, transfer.source.storageId, transfer.source.path)}
                  </span>
                  <ArrowRight className="h-4 w-4 flex-none text-foreground-subtle" aria-hidden />
                  <span className="min-w-0 truncate font-medium">
                    {describeEndpoint(storages, transfer.destination.storageId, transfer.destination.path)}
                  </span>
                  <BackupModeBadge mode={transfer.mode} />
                </>
              )}
              <span className="ml-auto text-xs text-foreground-subtle" data-testid="backup-job-status">
                {readStatusText(job)}
              </span>
            </div>
            <JobProgressDetails job={job} />
            {job.status === "paused" && job.error && (
              <StaticAlert tone="warning" variant="soft" className="text-sm" data-testid="backup-job-pause-reason">
                {job.error}
              </StaticAlert>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {(job.status === "running" || job.status === "queued") && (
                <Button
                  size="small"
                  variant="secondary"
                  leadingIcon={<Pause className="h-3.5 w-3.5" />}
                  disabled={isBusy}
                  onClick={() => controlJob.mutate({ jobId: job.id, action: "pause" })}
                >
                  Pause
                </Button>
              )}
              {job.status === "paused" && (
                <Button
                  size="small"
                  variant="primary"
                  leadingIcon={<Play className="h-3.5 w-3.5" />}
                  disabled={isBusy}
                  onClick={() => controlJob.mutate({ jobId: job.id, action: "resume" })}
                >
                  Resume
                </Button>
              )}
              <Button
                size="small"
                variant="secondary"
                leadingIcon={<X className="h-3.5 w-3.5" />}
                disabled={isBusy}
                onClick={() => controlJob.mutate({ jobId: job.id, action: "cancel" })}
              >
                Cancel
              </Button>
            </div>
            {controlJob.isError && controlJob.variables?.jobId === job.id && (
              <p className="text-sm text-danger" role="alert">
                {controlJob.error.message}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
