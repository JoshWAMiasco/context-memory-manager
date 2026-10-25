"use client";

import { CircleAlert, Download, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/primitives/button";
import { ProgressBar } from "@/components/primitives/progress-bar";
import { FileIcon } from "@/components/explorer/file-icon";
import type { FileEntry } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import type { TransferProgress } from "@/lib/client/fetch-with-progress";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** Files at least this large show the progress card straight away. */
const LARGE_FILE_BYTES = 1024 * 1024;
const PROGRESS_CARD_DELAY_MILLISECONDS = 300;

export type ContentSkeletonVariant = "text" | "table" | "image";

const TEXT_LINE_WIDTHS = ["w-2/3", "w-5/6", "w-1/2", "w-3/4", "w-2/5", "w-4/5", "w-3/5", "w-1/3"];

function ContentSkeleton({ variant }: { variant: ContentSkeletonVariant }) {
  if (variant === "image") {
    return <div className="m-auto h-64 w-full max-w-lg animate-pulse rounded-md bg-surface-muted" />;
  }
  if (variant === "table") {
    return (
      <div className="grid animate-pulse grid-cols-4 gap-px p-5">
        {Array.from({ length: 32 }, (_unused, cellIndex) => (
          <div
            key={cellIndex}
            className={mergeClassNames("h-7 bg-surface-muted", cellIndex < 4 && "bg-surface-strong")}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex animate-pulse flex-col gap-2.5 p-5">
      {TEXT_LINE_WIDTHS.map((widthClassName, lineIndex) => (
        <div key={lineIndex} className={mergeClassNames("h-3.5 rounded-sm bg-surface-muted", widthClassName)} />
      ))}
    </div>
  );
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Shown while a file's content loads: a skeleton shaped like the viewer, then, after
 * 300 ms or straight away for files over 1 MB, a card with the file, a percentage bar,
 * "12.3 of 29.0 MB" and Cancel.
 *
 * @example
 * <ContentLoader entry={entry} progress={fileDocument.progress} variant="text" onCancel={fileDocument.cancelLoad} />
 */
export function ContentLoader({
  entry,
  progress,
  variant,
  label = "Loading…",
  onCancel,
}: {
  entry: Pick<FileEntry, "name" | "type" | "badges" | "size">;
  progress?: TransferProgress;
  variant: ContentSkeletonVariant;
  label?: string;
  onCancel?: () => void;
}) {
  const [isSlow, setIsSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), PROGRESS_CARD_DELAY_MILLISECONDS);
    return () => clearTimeout(timer);
  }, []);

  if (!isSlow && entry.size < LARGE_FILE_BYTES) return <ContentSkeleton variant={variant} />;
  const total = progress?.total ?? entry.size;
  const loaded = progress?.loaded ?? 0;
  const percentage = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ContentSkeleton variant={variant} />
      <div className="absolute inset-0 flex items-center justify-center p-5">
        <div className="box w-full max-w-sm p-5 shadow-overlay" data-testid="content-progress" role="status">
          <div className="flex items-center gap-2.5">
            <FileIcon entry={entry} className="h-6 w-6" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{entry.name}</div>
              <div className="text-xs text-foreground-subtle">{label}</div>
            </div>
            <span className="text-sm text-foreground-muted" data-testid="content-progress-percent">
              {percentage}%
            </span>
          </div>
          <ProgressBar value={percentage} maximum={100} className="mt-3" />
          <div className="mt-2 flex items-center justify-between text-xs text-foreground-subtle">
            <span data-testid="content-progress-bytes">
              {formatMegabytes(loaded)} of {formatMegabytes(total)} MB
            </span>
            {onCancel && (
              <Button variant="outline-secondary" size="small" onClick={onCancel} data-testid="content-progress-cancel">
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The inline error card for content that failed to load, with Retry and Download.
 *
 * @example
 * <ContentError error={loadError} onRetry={reload} onDownload={download} />
 */
export function ContentError({
  error,
  onRetry,
  onDownload,
  children,
}: {
  error: unknown;
  onRetry: () => void;
  onDownload?: () => void;
  children?: ReactNode;
}) {
  const isCancelled = error instanceof DOMException && error.name === "AbortError";
  const message = isCancelled
    ? "Loading was cancelled."
    : error instanceof ApiError || error instanceof Error
      ? error.message
      : "Something went wrong.";
  return (
    <div className="flex flex-1 items-center justify-center p-5">
      <div className="box w-full max-w-sm p-5 text-center" data-testid="content-error" role="alert">
        <CircleAlert className="mx-auto h-8 w-8 stroke-[1.3] text-danger" aria-hidden />
        <div className="mt-2 font-medium">{isCancelled ? "Not loaded" : "Couldn't load this file"}</div>
        <p className="mt-1 text-sm text-foreground-muted">{message}</p>
        {children}
        <div className="mt-4 flex justify-center gap-2">
          <Button
            variant="outline-primary"
            size="small"
            onClick={onRetry}
            leadingIcon={<RotateCcw className="mr-1.5 h-4 w-4" />}
          >
            Retry
          </Button>
          {onDownload && (
            <Button
              variant="outline-secondary"
              size="small"
              onClick={onDownload}
              leadingIcon={<Download className="mr-1.5 h-4 w-4" />}
            >
              Download
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
