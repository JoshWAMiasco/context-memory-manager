"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  ArrowLeft,
  Columns2,
  GitBranch,
  Pencil,
  Plug,
  Redo2,
  RotateCcw,
  Rows2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
import { EmptyState } from "@/components/primitives/empty-state";
import { announce, useExplorer } from "@/components/explorer/explorer-context";
import { DiffView, type DiffLayout } from "@/components/versioning/diff-view";
import { UndoRedoButtons } from "@/components/versioning/undo-redo-buttons";
import type { CommitFile, FileEntry, HistoryCommit, HistoryCommitKind } from "@/lib/api-types";
import { readBaseName } from "@/lib/client/query-keys";
import {
  useCommitDetail,
  useFileDiff,
  useVersioningLog,
  useVersioningMutations,
  useVersioningStatus,
} from "@/lib/client/versioning";
import { mergeClassNames } from "@/utilities/merge-class-names";

dayjs.extend(relativeTime);

const COMMIT_ROW_HEIGHT = 58;

const KIND_ICONS: Record<HistoryCommitKind, { icon: LucideIcon; label: string; tone: string }> = {
  change: { icon: Pencil, label: "Change", tone: "text-foreground-muted" },
  undo: { icon: Undo2, label: "Undo", tone: "text-warning" },
  redo: { icon: Redo2, label: "Redo", tone: "text-info" },
  restore: { icon: RotateCcw, label: "Restore", tone: "text-success" },
  external: { icon: Plug, label: "Changed outside CCM", tone: "text-pending" },
  enable: { icon: GitBranch, label: "Versioning turned on", tone: "text-foreground-muted" },
};

const STATUS_LABELS: Record<CommitFile["status"], { letter: string; label: string; tone: string }> = {
  A: { letter: "A", label: "Added", tone: "text-success" },
  M: { letter: "M", label: "Modified", tone: "text-info" },
  D: { letter: "D", label: "Deleted", tone: "text-danger" },
  R: { letter: "R", label: "Renamed", tone: "text-warning" },
};

function relativeToScope(scopePath: string, storagePath: string): string {
  return scopePath === "" ? storagePath : storagePath.slice(scopePath.length + 1);
}

function CommitRow({
  commit,
  isSelected,
  onSelect,
}: {
  commit: HistoryCommit;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const kind = KIND_ICONS[commit.kind];
  const KindIcon = kind.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected}
      data-testid="history-commit"
      data-sha={commit.sha}
      data-kind={commit.kind}
      className={mergeClassNames(
        "flex h-full w-full cursor-pointer items-start gap-2.5 border-b border-line/50 px-3 py-2 text-left text-sm hover:bg-surface-muted",
        isSelected && "bg-surface-muted",
      )}
    >
      <Tooltip content={kind.label}>
        <KindIcon className={mergeClassNames("mt-0.5 h-4 w-4 flex-none", kind.tone)} aria-label={kind.label} />
      </Tooltip>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{commit.message}</span>
        <span className="block truncate text-xs text-foreground-subtle">
          {commit.author} ·{" "}
          <span title={dayjs(commit.date).format("MMMM D, YYYY HH:mm")}>{dayjs(commit.date).fromNow()}</span>
        </span>
      </span>
      <span className="font-mono text-xs text-foreground-faint">{commit.short}</span>
    </button>
  );
}

function CommitList({
  storageId,
  logPath,
  selectedSha,
  onSelect,
}: {
  storageId: string;
  logPath: string;
  selectedSha?: string;
  onSelect: (commit: HistoryCommit) => void;
}) {
  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useVersioningLog(storageId, logPath);
  const commits = data?.pages.flatMap((page) => page.commits) ?? [];
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => COMMIT_ROW_HEIGHT,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && lastIndex >= commits.length - 5) void fetchNextPage();
  }, [commits.length, fetchNextPage, hasNextPage, isFetchingNextPage, lastIndex]);
  const firstCommit = commits[0];
  useEffect(() => {
    if (!selectedSha && firstCommit) onSelect(firstCommit);
  }, [firstCommit, onSelect, selectedSha]);

  if (error) return <p className="p-3 text-sm text-danger">{error.message}</p>;
  if (!data) return <p className="p-3 text-sm text-foreground-subtle">Loading history…</p>;
  if (commits.length === 0) return <p className="p-3 text-sm text-foreground-subtle">No changes recorded yet.</p>;
  return (
    <div ref={setScrollElement} className="h-full overflow-auto" data-testid="history-commits">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualItem) => {
          const commit = commits[virtualItem.index];
          if (!commit) return null;
          return (
            <div
              key={commit.sha}
              className="absolute inset-x-0"
              style={{ top: virtualItem.start, height: virtualItem.size }}
            >
              <CommitRow commit={commit} isSelected={commit.sha === selectedSha} onSelect={() => onSelect(commit)} />
            </div>
          );
        })}
      </div>
      {isFetchingNextPage && <p className="p-2 text-center text-xs text-foreground-subtle">Loading more…</p>}
    </div>
  );
}

function DiffArea({
  storageId,
  file,
  sha,
  layout,
}: {
  storageId: string;
  file: CommitFile;
  sha: string;
  layout: DiffLayout;
}) {
  const { data: diff, error } = useFileDiff(storageId, file, sha);
  if (error)
    return (
      <p className="text-sm text-danger" data-testid="diff-error">
        {error.message}
      </p>
    );
  if (!diff) return <p className="text-sm text-foreground-subtle">Loading the comparison…</p>;
  return <DiffView key={`${sha}:${file.path}`} diff={diff} fileName={readBaseName(file.path)} layout={layout} />;
}

/**
 * The History view of the file pane: the commits of the selected file (or of its whole
 * versioned folder), newest first and virtualised, with kind icons and relative times. A commit
 * lists its changed files; a file opens a read-only comparison (side by side or unified).
 * "Restore this file to this version" and "Restore whole folder to this version" ask first and
 * make a new commit.
 *
 * @example
 * <HistoryPanel entry={entry} />
 */
export function HistoryPanel({ entry }: { entry: FileEntry }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const { data: status } = useVersioningStatus(storage.id, entry.path);
  const { restoreFile, restoreFolder } = useVersioningMutations();
  const [showsWholeFolder, setShowsWholeFolder] = useState(false);
  const [selectedSha, setSelectedSha] = useState<string>();
  const [chosenFile, setChosenFile] = useState<CommitFile>();
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [confirming, setConfirming] = useState<"file" | "folder">();
  const scopePath = status?.scopePath ?? entry.path;
  const isScopeItself = status?.scopePath === entry.path;
  const logPath = showsWholeFolder || isScopeItself ? scopePath : entry.path;
  const { data: detail } = useCommitDetail(storage.id, scopePath, selectedSha);
  const files = detail?.files ?? [];
  const selectedFile =
    (chosenFile && files.find((file) => file.path === chosenFile.path)) ??
    files.find((file) => file.path === entry.path) ??
    files[0];
  const blockedReason = explorer.readOnlyReason ?? status?.peek?.blockedReason;
  const folderName = status?.folderName ?? (readBaseName(scopePath) || storage.label);

  if (status && !status.versioned) {
    return (
      <EmptyState
        className="m-auto"
        title="Versioning is off here"
        description="Turn it on in Folder settings → Versioning to keep a history of every change."
      />
    );
  }

  const selectCommit = (commit: HistoryCommit) => {
    setSelectedSha(commit.sha);
    setChosenFile(undefined);
  };
  const restoreTarget = selectedFile?.status === "D" ? undefined : selectedFile;
  const short = selectedSha?.slice(0, 7) ?? "";

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="history-panel" data-path={logPath}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line/60 px-5 py-3">
        <Button
          variant="outline-secondary"
          size="small"
          onClick={explorer.closeHistory}
          leadingIcon={<ArrowLeft className="mr-1.5 h-3.5 w-3.5" />}
          data-testid="history-close"
        >
          Back
        </Button>
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-medium">
          History of {logPath === scopePath ? folderName : entry.name}
        </h2>
        {!isScopeItself && (
          <div className="flex rounded-md border border-line text-xs" role="group" data-testid="history-filter">
            {[
              { isWhole: false, label: entry.type === "file" ? "This file only" : "This folder only" },
              { isWhole: true, label: "Whole folder" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={showsWholeFolder === option.isWhole}
                onClick={() => {
                  setShowsWholeFolder(option.isWhole);
                  setSelectedSha(undefined);
                }}
                className={mergeClassNames(
                  "cursor-pointer px-2.5 py-1 first:rounded-l-md last:rounded-r-md",
                  showsWholeFolder === option.isWhole ? "bg-surface-strong font-medium" : "hover:bg-surface-muted",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <UndoRedoButtons path={scopePath} />
      </header>
      <div className="grid min-h-0 flex-1 grid-rows-[16rem_1fr] md:grid-cols-[19rem_1fr] md:grid-rows-1">
        <div className="min-h-0 border-b border-line/60 md:border-r md:border-b-0">
          <CommitList
            key={logPath}
            storageId={storage.id}
            logPath={logPath}
            selectedSha={selectedSha}
            onSelect={selectCommit}
          />
        </div>
        <div className="min-h-0 overflow-auto p-5" data-testid="history-detail">
          {!detail ? (
            <p className="text-sm text-foreground-subtle">{selectedSha ? "Loading…" : "Choose a change."}</p>
          ) : (
            <div className="grid gap-4">
              <div>
                <h3 className="font-medium" data-testid="history-commit-message">
                  {detail.commit.message}
                </h3>
                <p className="text-xs text-foreground-subtle">
                  {detail.commit.author} · {dayjs(detail.commit.date).format("MMMM D, YYYY HH:mm")} ·{" "}
                  <span className="font-mono">{detail.commit.short}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {restoreTarget && (
                  <Tooltip content={blockedReason ?? `Write ${readBaseName(restoreTarget.path)} back as it was here`}>
                    <Button
                      variant="outline-primary"
                      size="small"
                      aria-disabled={blockedReason !== undefined}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                      onClick={() => blockedReason === undefined && setConfirming("file")}
                      data-testid="restore-file"
                      leadingIcon={<RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                    >
                      Restore this file to this version
                    </Button>
                  </Tooltip>
                )}
                <Tooltip content={blockedReason ?? "Put every file of the folder back as it was here"}>
                  <Button
                    variant="outline-secondary"
                    size="small"
                    aria-disabled={blockedReason !== undefined}
                    className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                    onClick={() => blockedReason === undefined && setConfirming("folder")}
                    data-testid="restore-folder"
                    leadingIcon={<RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                  >
                    Restore whole folder to this version
                  </Button>
                </Tooltip>
              </div>
              {files.length === 0 ? (
                <p className="text-sm text-foreground-subtle">No files changed in this step.</p>
              ) : (
                <ul className="divide-y divide-line/50 rounded-md border border-line" data-testid="commit-files">
                  {files.map((file) => {
                    const fileStatus = STATUS_LABELS[file.status];
                    return (
                      <li key={`${file.status}:${file.path}`}>
                        <button
                          type="button"
                          onClick={() => setChosenFile(file)}
                          aria-current={file.path === selectedFile?.path}
                          data-testid="commit-file"
                          data-path={file.path}
                          className={mergeClassNames(
                            "flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-surface-muted",
                            file.path === selectedFile?.path && "bg-surface-muted",
                          )}
                        >
                          <span
                            className={mergeClassNames("w-4 font-mono text-xs font-semibold", fileStatus.tone)}
                            title={fileStatus.label}
                          >
                            {fileStatus.letter}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {file.oldPath ? `${relativeToScope(scopePath, file.oldPath)} → ` : ""}
                            {relativeToScope(scopePath, file.path)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedFile && selectedSha && (
                <section className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="truncate text-sm font-medium">{relativeToScope(scopePath, selectedFile.path)}</h4>
                    <div className="flex rounded-md border border-line" role="group" aria-label="Comparison layout">
                      {(
                        [
                          { value: "split", label: "Side by side", icon: Columns2 },
                          { value: "unified", label: "Unified", icon: Rows2 },
                        ] as const
                      ).map(({ value, label, icon: LayoutIcon }) => (
                        <Tooltip key={value} content={label}>
                          <button
                            type="button"
                            aria-label={label}
                            aria-pressed={layout === value}
                            onClick={() => setLayout(value)}
                            data-testid={`diff-layout-${value}`}
                            className={mergeClassNames(
                              "cursor-pointer px-2 py-1 first:rounded-l-md last:rounded-r-md",
                              layout === value ? "bg-surface-strong" : "hover:bg-surface-muted",
                            )}
                          >
                            <LayoutIcon className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                  <DiffArea storageId={storage.id} file={selectedFile} sha={selectedSha} layout={layout} />
                </section>
              )}
            </div>
          )}
        </div>
      </div>
      {confirming === "file" && restoreTarget && selectedSha && (
        <ConfirmDialog
          isOpen
          onOpenChange={(isOpen) => !isOpen && setConfirming(undefined)}
          title={`Restore ${readBaseName(restoreTarget.path)}?`}
          confirmLabel="Restore file"
          testId="restore-file-dialog"
          onConfirm={async () => {
            await restoreFile.mutateAsync({ storageId: storage.id, path: restoreTarget.path, sha: selectedSha });
            announce("File restored", `${readBaseName(restoreTarget.path)} is back as it was in ${short}.`);
          }}
        >
          Its content is written back as it was in {short}. This is a new step in the history, so you can undo it.
        </ConfirmDialog>
      )}
      {confirming === "folder" && selectedSha && (
        <ConfirmDialog
          isOpen
          onOpenChange={(isOpen) => !isOpen && setConfirming(undefined)}
          title={`Restore "${folderName}" to ${short}?`}
          confirmLabel="Restore folder"
          confirmVariant="danger"
          testId="restore-folder-dialog"
          onConfirm={async () => {
            await restoreFolder.mutateAsync({ storageId: storage.id, path: scopePath, sha: selectedSha });
            announce("Folder restored", `"${folderName}" is back as it was in ${short}.`);
          }}
        >
          Every file is put back as it was in {short}, and files added since are removed (they stay in the history).
          This is a new step in the history, so you can undo it.
        </ConfirmDialog>
      )}
    </div>
  );
}
