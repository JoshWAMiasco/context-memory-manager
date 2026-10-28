"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, PanelRight, ServerCog, SquareTerminal, Trash2 } from "lucide-react";
import { announceError } from "@/components/explorer/explorer-context";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { formatJobLocation, formatStartedAt, JobCard, JobStatus, useNow } from "@/components/jobs/job-card";
import { buildJobsHref } from "@/components/jobs/run-as-job";
import { Button } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import { EmptyState } from "@/components/primitives/empty-state";
import { TerminalView, type TerminalConnection } from "@/components/terminal/terminal-view";
import type { TerminalSummary } from "@/lib/api-types";
import { buildStorageHref } from "@/lib/client/routes";
import { dockTerminal, useTerminalMutations, useTerminals } from "@/lib/client/terminals";
import { formatRunningTime } from "@/lib/terminal";

const CARD_GRID_CLASS_NAMES = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4";

/**
 * One job, across the whole page (no file tree beside it): a header with its state, when it
 * started, how long it has run and where, and Open in editor (docks it beside that folder's
 * editor), Make a terminal again (it then ends when CMM closes) and Discard (stops it; nothing of
 * it is kept). The terminal fills the rest.
 */
function JobView({ job }: { job: TerminalSummary }) {
  const router = useRouter();
  const now = useNow();
  const { closeTerminal, setJob } = useTerminalMutations();
  const [exitCode, setExitCode] = useState<number>();
  const [connection, setConnection] = useState<TerminalConnection>("connecting");
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);
  const hasExited = job.status === "exited" || exitCode !== undefined;

  const openInEditor = () => {
    dockTerminal(job.id);
    router.push(buildStorageHref(job.storageId, job.path));
  };
  // Promises, not mutate callbacks: this view unmounts as soon as the job leaves the list.
  const makeTerminal = () =>
    setJob
      .mutateAsync({ terminalId: job.id, isJob: false })
      .then(() => {
        showToastNotification({
          title: `"${job.title}" is a terminal again`,
          description: "It is in the terminal dock, and ends when CMM closes.",
          tone: "success",
        });
        router.push(buildJobsHref());
      })
      .catch((jobError: unknown) => announceError("Couldn't change the job", jobError));
  const discard = () =>
    closeTerminal
      .mutateAsync(job.id)
      .then(() => router.push(buildJobsHref()))
      .catch((closeError: unknown) => announceError("Couldn't discard the job", closeError));

  return (
    <div className="flex flex-col gap-3" data-testid="job-view" data-terminal-id={job.id}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={buildJobsHref()}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-muted hover:text-foreground"
          aria-label="All jobs"
          title="All jobs"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate font-display text-lg font-medium">{job.title}</h1>
            <JobStatus job={job} exitCode={exitCode} />
            {!hasExited && connection === "disconnected" && <span className="text-xs text-warning">Reconnecting…</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-foreground-muted">
            <span data-testid="job-started">Started {now ? formatStartedAt(job.createdAt) : ""}</span>
            {!hasExited && (
              <span data-testid="job-running-time">Running for {now ? formatRunningTime(job.createdAt, now) : ""}</span>
            )}
            <span className="truncate" data-testid="job-location">
              in {formatJobLocation(job)} · {job.shell}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline-secondary"
            size="small"
            onClick={openInEditor}
            leadingIcon={<PanelRight className="mr-1.5 h-4 w-4 stroke-[1.3]" />}
            data-testid="job-open-in-editor"
          >
            Open in editor
          </Button>
          {!hasExited && (
            <Button
              variant="outline-secondary"
              size="small"
              onClick={makeTerminal}
              leadingIcon={<SquareTerminal className="mr-1.5 h-4 w-4 stroke-[1.3]" />}
              title="It moves to the terminal dock and ends when CMM closes"
              data-testid="job-make-terminal"
            >
              Make a terminal
            </Button>
          )}
          <Button
            variant="outline-danger"
            size="small"
            onClick={() => (hasExited ? discard() : setIsConfirmingDiscard(true))}
            leadingIcon={<Trash2 className="mr-1.5 h-4 w-4 stroke-[1.3]" />}
            data-testid="job-discard"
          >
            Discard
          </Button>
        </div>
      </div>
      <div
        className="box h-[calc(100dvh-15rem)] min-h-[240px] overflow-hidden bg-field py-1 pl-2 md:h-[calc(100dvh-12rem)] md:min-h-[420px]"
        data-testid="job-terminal"
      >
        <TerminalView
          key={job.id}
          terminalId={job.id}
          shell={job.shell}
          isVisible
          onOutput={() => undefined}
          onExit={setExitCode}
          onConnectionChange={setConnection}
        />
      </div>
      <ConfirmDialog
        isOpen={isConfirmingDiscard}
        onOpenChange={setIsConfirmingDiscard}
        title={`Discard the job "${job.title}"?`}
        confirmLabel="Discard job"
        confirmVariant="danger"
        testId="discard-job-dialog"
        onConfirm={discard}
      >
        Whatever is running in it stops, and nothing of it is kept.
      </ConfirmDialog>
    </div>
  );
}

/**
 * The Jobs page: terminals that keep running in the background after CMM is closed, restarted or
 * updated, as cards. Choosing one (`?id=`) shows it across the whole page. Jobs leave no history:
 * a discarded job is gone.
 *
 * @example
 * <JobsPage />
 */
export function JobsPage() {
  const searchParameters = useSearchParams();
  const selectedId = searchParameters.get("id");
  const { data, isLoading } = useTerminals();
  const jobs = data?.available ? data.terminals.filter((terminal) => terminal.isJob) : [];

  if (selectedId) {
    const job = jobs.find((candidate) => candidate.id === selectedId);
    if (job) return <JobView job={job} />;
    if (isLoading) return <p className="text-sm text-foreground-muted">Loading…</p>;
    return (
      <Card className="mx-auto w-full max-w-xl p-8" data-testid="job-gone">
        <EmptyState
          icon={<ServerCog className="h-10 w-10 stroke-[1]" />}
          title="This job is gone"
          description="It was discarded, or it is a terminal again."
          action={
            <Link href={buildJobsHref()} className="text-sm font-medium text-brand hover:underline">
              All jobs
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="jobs-page">
      <div>
        <h1 className="font-display text-xl font-medium">Jobs</h1>
        <p className="mt-0.5 text-sm text-foreground-muted">
          Terminals that keep running in the background, also after CMM is closed, restarted or updated.
        </p>
      </div>
      {data && !data.available && (
        <Card className="mx-auto w-full max-w-xl p-8" data-testid="jobs-unavailable">
          <EmptyState
            icon={<ServerCog className="h-10 w-10 stroke-[1]" />}
            title="Jobs are not available"
            description={data.unavailableReason}
          />
        </Card>
      )}
      {data?.available && jobs.length === 0 && (
        <Card className="mx-auto w-full max-w-xl p-8" data-testid="no-jobs">
          <EmptyState
            icon={<ServerCog className="h-10 w-10 stroke-[1]" />}
            title="No jobs running"
            description="Open a terminal on a folder, then choose Run as a job in its title bar. It moves here and keeps running after CMM closes."
          />
        </Card>
      )}
      {jobs.length > 0 && (
        <div className={CARD_GRID_CLASS_NAMES}>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
