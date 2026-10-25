"use client";

import dayjs from "dayjs";
import { History } from "lucide-react";
import { BackupModeBadge } from "@/components/backup/backup-mode-badge";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Badge, type BadgeTone } from "@/components/primitives/badge";
import { Button } from "@/components/primitives/button";
import { EmptyState } from "@/components/primitives/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { BackupRunSummary } from "@/lib/api-types";
import { readMemoryFolderName } from "@/lib/backup";

const STATUS_TONES: Record<BackupRunSummary["status"], BadgeTone> = {
  running: "primary",
  paused: "warning",
  done: "success",
  failed: "danger",
  cancelled: "slate",
};

const STATUS_LABELS: Record<BackupRunSummary["status"], string> = {
  running: "Running",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

/**
 * A run's status as a badge: Done, Failed, Paused…
 *
 * @example
 * <RunStatusBadge status="done" />
 */
export function RunStatusBadge({ status }: { status: BackupRunSummary["status"] }) {
  return (
    <Badge tone={STATUS_TONES[status]} data-testid="run-status">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function formatTime(isoTime: string | null): string {
  return isoTime ? dayjs(isoTime).format("YYYY-MM-DD HH:mm:ss") : "—";
}

/**
 * The details of one run: its counts, why it stopped, every error with its path, and every
 * warning (skipped or renamed files).
 *
 * @example
 * <RunDetailsModal run={run} onClose={close} />
 */
export function RunDetailsModal({ run, onClose }: { run: BackupRunSummary; onClose: () => void }) {
  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={run.name} size="large">
      <div data-testid="run-details">
        <ModalBody className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            <BackupModeBadge mode={run.mode} />
            <span className="text-foreground-muted">
              {run.source.label}
              {run.source.path ? ` / ${run.source.path}` : ""} → {run.destination.label}
              {run.destination.path ? ` / ${run.destination.path}` : ""}
              {run.memory ? ` / ${readMemoryFolderName(run.memory.name)}` : ""}
            </span>
          </div>
          {run.memory && (
            <p className="text-foreground-muted" data-testid="run-memory-sources">
              Memory &ldquo;{run.memory.name}&rdquo; from{" "}
              {run.memory.paths.map((memoryPath) => memoryPath || run.source.label).join(", ")}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <dt className="text-foreground-subtle">Started</dt>
            <dd className="sm:col-span-2">{formatTime(run.startedAt)}</dd>
            <dt className="text-foreground-subtle">Ended</dt>
            <dd className="sm:col-span-2">{formatTime(run.endedAt)}</dd>
            <dt className="text-foreground-subtle">Copied</dt>
            <dd className="sm:col-span-2">
              {run.filesCopied.toLocaleString()} files, {formatFileSize(run.bytesCopied)}
            </dd>
            <dt className="text-foreground-subtle">Unchanged</dt>
            <dd className="sm:col-span-2">{run.filesSkipped.toLocaleString()} files</dd>
            <dt className="text-foreground-subtle">Moved to Trash</dt>
            <dd className="sm:col-span-2">{run.filesDeleted.toLocaleString()}</dd>
          </dl>
          {run.message && <p className="text-foreground-muted">{run.message}</p>}
          <section>
            <h3 className="mb-1 font-medium">Errors ({run.errors.length})</h3>
            {run.errors.length === 0 ? (
              <p className="text-foreground-subtle">None.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-line" data-testid="run-errors">
                {run.errors.map((runError, errorIndex) => (
                  <li
                    key={`${errorIndex}-${runError.path}`}
                    className="border-b border-line/60 px-3 py-2 last:border-b-0"
                  >
                    <div className="font-mono text-xs break-all">{runError.path}</div>
                    <div className="text-danger">{runError.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-1 font-medium">Warnings ({run.warnings.length})</h3>
            {run.warnings.length === 0 ? (
              <p className="text-foreground-subtle">None.</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-line" data-testid="run-warnings">
                {run.warnings.map((warning, warningIndex) => (
                  <li
                    key={`${warningIndex}-${warning.path}`}
                    className="border-b border-line/60 px-3 py-2 last:border-b-0"
                  >
                    <div className="font-mono text-xs break-all">{warning.path}</div>
                    <div className="text-warning">{warning.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Close</ModalCloseButton>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/**
 * The History tab: every run with its start and end, profile, status, bytes and files
 * copied, unchanged files and errors; Details lists each error and warning with its path.
 *
 * @example
 * <RunHistory runs={runs} onShowDetails={setDetailsRun} />
 */
export function RunHistory({
  runs,
  onShowDetails,
}: {
  runs: BackupRunSummary[];
  onShowDetails: (run: BackupRunSummary) => void;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        className="py-10"
        icon={<History className="h-10 w-10 stroke-[1]" />}
        title="No backups yet"
        description="Each run is listed here with what it copied, skipped and any errors."
      />
    );
  }
  return (
    <div className="overflow-x-auto" data-testid="backup-history">
      <Table size="small" appearance="list" isHoverable>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Started</TableHeaderCell>
            <TableHeaderCell>Ended</TableHeaderCell>
            <TableHeaderCell>Profile</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell className="text-right">Copied</TableHeaderCell>
            <TableHeaderCell className="text-right">Files</TableHeaderCell>
            <TableHeaderCell className="text-right">Unchanged</TableHeaderCell>
            <TableHeaderCell className="text-right">Errors</TableHeaderCell>
            <TableHeaderCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id} data-testid="backup-run-row" data-run-id={run.id} data-job-id={run.jobId}>
              <TableCell className="whitespace-nowrap tabular-nums">{formatTime(run.startedAt)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatTime(run.endedAt)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="truncate">{run.name}</span>
                  <BackupModeBadge mode={run.mode} />
                </div>
              </TableCell>
              <TableCell>
                <RunStatusBadge status={run.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatFileSize(run.bytesCopied)}</TableCell>
              <TableCell className="text-right tabular-nums">{run.filesCopied.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{run.filesSkipped.toLocaleString()}</TableCell>
              <TableCell className={`text-right tabular-nums ${run.errors.length > 0 ? "text-danger" : ""}`}>
                {run.errors.length.toLocaleString()}
                {run.warnings.length > 0 && (
                  <span className="ml-1 text-warning" title={`${run.warnings.length} warnings`}>
                    ({run.warnings.length} ⚠)
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button size="small" variant="secondary" onClick={() => onShowDetails(run)}>
                  Details
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
