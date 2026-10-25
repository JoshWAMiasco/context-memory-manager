"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Lock, LockKeyholeOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/primitives/button";
import { EmptyState } from "@/components/primitives/empty-state";
import { ProgressBar } from "@/components/primitives/progress-bar";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { useLockAllEncryptedFolders } from "@/components/encryption/unlocked-folders-button";
import type { EncryptedFolderSummary, EncryptionState } from "@/lib/api-types";
import { useEncryptedFolders } from "@/lib/client/encryption";
import { readJobPercentage, useActiveJobs } from "@/lib/client/jobs";
import { buildStorageHref } from "@/lib/client/routes";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

dayjs.extend(relativeTime);

const STATE_LABELS: Record<EncryptionState, string> = {
  encrypting: "Encrypting…",
  encrypted: "Encrypted",
  decrypting: "Decrypting…",
  rekeying: "Re-keying…",
};

/** The folder's state; while a job runs, its live percentage and a thin bar. */
function FolderStateCell({ folder }: { folder: EncryptedFolderSummary }) {
  const job = useActiveJobs().find(
    (activeJob) => activeJob.target?.storageId === folder.storageId && activeJob.target.path === folder.path,
  );
  const percentage = job ? readJobPercentage(job.progress) : undefined;
  if (folder.state === "encrypted" || percentage === undefined) return <>{STATE_LABELS[folder.state]}</>;
  return (
    <div className="grid min-w-32 gap-1" data-testid="encrypted-folder-progress">
      <span className="tabular-nums">
        {STATE_LABELS[folder.state]} {percentage}%
      </span>
      <ProgressBar
        value={percentage}
        size="extra-small"
        fillClassName="transition-[width] duration-300 ease-linear motion-reduce:transition-none"
      />
    </div>
  );
}

/**
 * Every encrypted folder the user can see: storage, path, state, and whether this
 * session has it unlocked with the time left, each linking to the folder; plus Lock all.
 *
 * @example
 * <EncryptedFoldersTable />
 */
export function EncryptedFoldersTable() {
  const { data: folders, isLoading, error } = useEncryptedFolders();
  const lockAll = useLockAllEncryptedFolders();
  const unlockedCount = (folders ?? []).filter((folder) => folder.unlocked).length;
  if (isLoading) return <LoadingSkeleton rows={3} label="Loading encrypted folders…" />;
  if (error) {
    return (
      <p className="text-danger" role="alert">
        The encrypted folders couldn&rsquo;t be loaded: {error.message}
      </p>
    );
  }
  if (!folders || folders.length === 0) {
    return (
      <EmptyState
        title="No encrypted folders yet"
        description="Encrypt a folder or memory from its Folder settings → Encryption tab."
      />
    );
  }
  return (
    <div className="grid gap-4" data-testid="encrypted-folders">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-foreground-muted">
          {unlockedCount === 0
            ? "All encrypted folders are locked in this session."
            : `${unlockedCount} unlocked in this session.`}
        </p>
        <Button
          variant="outline-secondary"
          size="small"
          disabled={unlockedCount === 0}
          leadingIcon={<Lock className="mr-1.5 h-4 w-4" />}
          onClick={lockAll}
          data-testid="lock-all-encrypted"
        >
          Lock all
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table isHoverable>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Folder</TableHeaderCell>
              <TableHeaderCell>Storage</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell>This session</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {folders.map((folder) => (
              <TableRow key={`${folder.storageId}:${folder.path}`} data-testid="encrypted-folder-row">
                <TableCell>
                  <Link className="font-medium hover:text-brand" href={buildStorageHref(folder.storageId, folder.path)}>
                    {folder.folderName}
                  </Link>
                  <div className="text-xs text-foreground-subtle">{folder.path || "/"}</div>
                </TableCell>
                <TableCell>
                  {folder.storageLabel}
                  {!folder.available && <span className="ml-1 text-xs text-foreground-subtle">(not connected)</span>}
                </TableCell>
                <TableCell>
                  <FolderStateCell folder={folder} />
                </TableCell>
                <TableCell>
                  {folder.unlocked ? (
                    <span className="flex items-center gap-1.5 text-success">
                      <LockKeyholeOpen className="h-4 w-4" aria-hidden />
                      Unlocked{folder.expiresAt ? `, locks ${dayjs(folder.expiresAt).fromNow()}` : ""}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-foreground-muted">
                      <Lock className="h-4 w-4" aria-hidden />
                      Locked
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
