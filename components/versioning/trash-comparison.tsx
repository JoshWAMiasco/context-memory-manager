"use client";

import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { ArrowLeft, Columns2, GitBranch, RotateCcw, Rows2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { DiffView, type DiffLayout } from "@/components/versioning/diff-view";
import type { FileEntry, TextFileResponse, TrashedTextResponse } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { buildTextUrl } from "@/lib/client/fs";
import { readParentPath } from "@/lib/client/query-keys";
import { describeFileKind, isTextKind } from "@/lib/file-kinds";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * "What changed" for a file replaced in a folder without versioning: the version the replace kept
 * in Trash beside the file now in place, as a read-only comparison. The kept version can be put
 * back as a copy ("name (restored)"), and versioning can be turned on to keep every version.
 * Comparing is for text files; other kinds say so.
 *
 * @example
 * <TrashComparison entry={entry} trashItemId="home:4f1c…" />
 */
export function TrashComparison({ entry, trashItemId }: { entry: FileEntry; trashItemId: string }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const isComparable = isTextKind(describeFileKind(entry.name).kind);
  const previous = useQuery({
    queryKey: ["trash", "content", trashItemId],
    queryFn: ({ signal }) =>
      requestJson<TrashedTextResponse>(`/api/trash/${encodeURIComponent(trashItemId)}/content`, { signal }),
    enabled: isComparable,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const current = useQuery({
    queryKey: ["trash", "current", storage.id, entry.path, entry.mtimeMs],
    queryFn: ({ signal }) => requestJson<TextFileResponse>(buildTextUrl(storage.id, entry.path), { signal }),
    enabled: isComparable,
    retry: false,
  });
  const loadError = previous.error ?? current.error;
  const keptAt = previous.data ? dayjs(previous.data.item.deletedAt).format("MMMM D, YYYY HH:mm") : undefined;

  let body;
  if (!isComparable) {
    body = (
      <p className="text-sm text-foreground-muted" data-testid="diff-unsupported">
        Comparing this file type isn&rsquo;t supported yet. The previous version is in Trash, where you can restore it.
      </p>
    );
  } else if (loadError) {
    body = (
      <p className="text-sm text-danger" data-testid="diff-error">
        {loadError.message}
      </p>
    );
  } else if (!previous.data || !current.data) {
    body = <p className="text-sm text-foreground-subtle">Loading the comparison…</p>;
  } else {
    body = (
      <DiffView
        diff={{
          path: entry.path,
          binary: false,
          before: previous.data.content,
          after: current.data.content,
          beforeSize: previous.data.item.size,
          afterSize: entry.size,
        }}
        fileName={entry.name}
        layout={layout}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="trash-comparison" data-path={entry.path}>
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
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-medium">What changed in {entry.name}</h2>
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
      </header>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-auto p-5">
        <div>
          <p className="text-sm">
            <span className="text-foreground-subtle">Before:</span> the version replaced
            {keptAt ? ` on ${keptAt}` : ""}, kept in Trash ·{" "}
            <span className="text-foreground-subtle">After:</span> the file now
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Tooltip content={explorer.readWriteReason(readParentPath(entry.path)) ?? "Put the previous version back next to this one"}>
              <Button
                variant="outline-primary"
                size="small"
                aria-disabled={explorer.readWriteReason(readParentPath(entry.path)) !== undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                onClick={() =>
                  explorer.readWriteReason(readParentPath(entry.path)) === undefined && setIsConfirmingRestore(true)
                }
                data-testid="restore-trashed-version"
                leadingIcon={<RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              >
                Restore the previous version as a copy
              </Button>
            </Tooltip>
            <Button
              variant="outline-secondary"
              size="small"
              onClick={() => explorer.openDialog({ kind: "enable-versioning", path: readParentPath(entry.path) })}
              leadingIcon={<GitBranch className="mr-1.5 h-3.5 w-3.5" />}
              data-testid="enable-versioning-hint"
            >
              Turn on versioning to keep every version
            </Button>
          </div>
        </div>
        {body}
      </div>
      <ConfirmDialog
        isOpen={isConfirmingRestore}
        onOpenChange={setIsConfirmingRestore}
        title="Restore the previous version?"
        confirmLabel="Restore as a copy"
        testId="restore-trashed-dialog"
        onConfirm={async () => {
          try {
            const restored = await requestJson<{ path: string }>(
              `/api/trash/${encodeURIComponent(trashItemId)}/restore`,
              { method: "POST" },
            );
            announce("Previous version restored", `It is back as ${restored.path}.`);
            explorer.closeHistory();
            explorer.selectPath(restored.path);
          } catch (restoreError) {
            announceError("Couldn't restore it", restoreError);
          }
        }}
      >
        It comes back next to {entry.name} as a copy (&ldquo;{entry.name} (restored)&rdquo; or similar), so nothing
        is overwritten.
      </ConfirmDialog>
    </div>
  );
}
