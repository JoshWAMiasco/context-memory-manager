"use client";

import dayjs from "dayjs";
import { Camera, GitBranch, History } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/primitives/button";
import { useExplorer } from "@/components/explorer/explorer-context";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { DisableVersioningDialog } from "@/components/versioning/disable-versioning-dialog";
import { GitRequiredDialog } from "@/components/versioning/git-required-dialog";
import { SnapshotDialog } from "@/components/versioning/snapshot-dialog";
import { UndoRedoButtons } from "@/components/versioning/undo-redo-buttons";
import { useGitStatus, useVersioningStatus } from "@/lib/client/versioning";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The Versioning tab of Folder settings. Off: what versioning does and Enable (always
 * through the Git-required dialog). On: Git's version, when it was enabled, how many commits and
 * how big `.git` is, Create snapshot…, Open history, Undo and Redo, and Turn off versioning….
 *
 * @example
 * <VersioningTab path="persona" />
 */
export function VersioningTab({ path: folderPath }: { path: string }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const { data: status } = useVersioningStatus(storage.id, folderPath);
  const { data: git } = useGitStatus(status?.versioned === true);
  const [openPanel, setOpenPanel] = useState<"enable" | "disable" | "snapshot">();
  if (!status) return <LoadingSkeleton rows={3} label="Loading versioning…" />;
  const writeReason =
    explorer.readOnlyReason ?? (explorer.userRole === "viewer" ? "Viewers can't change versioning." : undefined);
  const isScopeItself = status.scopePath === folderPath;
  const openHistory = () => {
    explorer.openDialog(undefined);
    explorer.openHistory(status.scopePath);
  };

  if (!status.versioned) {
    return (
      <div className="grid gap-5" data-testid="versioning-tab" data-versioned="false">
        <div className="flex gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 flex-none text-foreground-muted" aria-hidden />
          <div className="text-sm leading-relaxed text-foreground-muted">
            Versioning keeps every change to this folder in a history: each save, upload, rename or delete, and changes
            made by other programs. You can see what changed, restore an earlier version, and undo or redo steps. It
            uses Git, which must be installed on this computer. Encrypted folders can&rsquo;t be versioned.
          </div>
        </div>
        {(writeReason ?? status.blockedReason) && (
          <p className="rounded-md border border-line bg-surface-subtle p-3 text-sm text-foreground-muted">
            {writeReason ?? status.blockedReason}
          </p>
        )}
        <Button
          variant="primary"
          className="w-fit"
          disabled={writeReason !== undefined || status.blockedReason !== undefined}
          leadingIcon={<GitBranch className="mr-1.5 h-4 w-4" />}
          onClick={() => setOpenPanel("enable")}
          data-testid="versioning-enable"
        >
          Enable versioning…
        </Button>
        {openPanel === "enable" && <GitRequiredDialog path={folderPath} onClose={() => setOpenPanel(undefined)} />}
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-testid="versioning-tab" data-versioned="true">
      {!isScopeItself && (
        <p className="rounded-md border border-line bg-surface-subtle p-3 text-sm text-foreground-muted">
          This folder is inside the versioned folder &ldquo;{status.scopePath || storage.label}&rdquo;, whose history
          covers it. Change versioning there.
        </p>
      )}
      <dl>
        <DetailRow label="Git">{git?.installed ? `Git ${git.version}` : "Not found on this computer"}</DetailRow>
        {status.enabledAt && (
          <DetailRow label="Enabled">
            {dayjs(status.enabledAt).format("MMMM D, YYYY HH:mm")}
            {status.enabledBy ? ` by ${status.enabledBy}` : ""}
            {status.adopted ? " (existing history kept)" : ""}
          </DetailRow>
        )}
        <DetailRow label="Commits">
          <span data-testid="versioning-commit-count">{status.commitCount?.toLocaleString() ?? "—"}</span>
        </DetailRow>
        <DetailRow label="History size">
          {status.gitSizeBytes === undefined ? "—" : formatFileSize(status.gitSizeBytes)}
          <span className="ml-2 text-xs text-foreground-subtle">.git, on this computer only</span>
        </DetailRow>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline-secondary"
          leadingIcon={<History className="mr-1.5 h-4 w-4" />}
          onClick={openHistory}
          data-testid="versioning-open-history"
        >
          Open history
        </Button>
        <Button
          variant="outline-secondary"
          disabled={writeReason !== undefined}
          leadingIcon={<Camera className="mr-1.5 h-4 w-4" />}
          onClick={() => setOpenPanel("snapshot")}
          data-testid="versioning-snapshot"
        >
          Create snapshot…
        </Button>
        <UndoRedoButtons path={status.scopePath} />
      </div>
      {isScopeItself && (
        <section className="rounded-md border border-danger/40 p-4" data-testid="versioning-danger-zone">
          <h4 className="font-medium text-danger">Turn off versioning</h4>
          <p className="mt-1 text-sm text-foreground-muted">
            Stops recording changes. The history can be kept in an archive or deleted; your files stay as they are.
          </p>
          <Button
            variant="outline-danger"
            className="mt-3"
            disabled={writeReason !== undefined}
            onClick={() => setOpenPanel("disable")}
            data-testid="versioning-disable"
          >
            Turn off versioning…
          </Button>
        </section>
      )}
      {openPanel === "disable" && (
        <DisableVersioningDialog
          path={folderPath}
          folderName={status.folderName}
          onClose={() => setOpenPanel(undefined)}
        />
      )}
      {openPanel === "snapshot" && <SnapshotDialog path={status.scopePath} onClose={() => setOpenPanel(undefined)} />}
    </div>
  );
}
