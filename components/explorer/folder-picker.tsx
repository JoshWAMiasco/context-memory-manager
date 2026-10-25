"use client";

import { ChevronRight, CornerLeftUp, Folder, FolderOpen } from "lucide-react";
import { LoadingIndicator } from "@/components/primitives/loading-indicator";
import { useDirectory } from "@/lib/client/fs";
import { readBaseName, readParentPath } from "@/lib/client/query-keys";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface FolderPickerProps {
  storageId: string;
  storageLabel: string;
  /** The chosen folder, relative to the storage ("" for its root). */
  value: string;
  onChange: (folderPath: string) => void;
  testId?: string;
  className?: string;
}

/**
 * Picks a folder in a storage, reading the same folder listings as the explorer tree:
 * the chosen folder's path as breadcrumbs, and its subfolders to step into. The folder being
 * shown is the one chosen.
 *
 * @example
 * <FolderPicker storageId="home" storageLabel="Home" value={path} onChange={setPath} />
 */
export function FolderPicker({ storageId, storageLabel, value, onChange, testId, className }: FolderPickerProps) {
  const { data: listing, isPending, error } = useDirectory(storageId, value);
  const folders = (listing?.entries ?? []).filter((entry) => entry.type === "directory");
  const segments = value === "" ? [] : value.split("/");
  return (
    <div
      className={mergeClassNames("overflow-hidden rounded-md border border-line", className)}
      data-testid={testId}
      data-path={value}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface-subtle px-2 py-1.5 text-xs">
        <FolderOpen className="mr-1 h-3.5 w-3.5 stroke-[1.5] text-primary" aria-hidden />
        <button type="button" className="rounded px-1 hover:bg-surface-muted" onClick={() => onChange("")}>
          {storageLabel}
        </button>
        {segments.map((segment, segmentIndex) => (
          <span key={`${segmentIndex}-${segment}`} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 text-foreground-faint" aria-hidden />
            <button
              type="button"
              className="rounded px-1 hover:bg-surface-muted"
              onClick={() => onChange(segments.slice(0, segmentIndex + 1).join("/"))}
            >
              {segment}
            </button>
          </span>
        ))}
      </div>
      <ul
        className="max-h-44 overflow-y-auto py-1 text-sm"
        role="listbox"
        aria-label={`Folders in ${readBaseName(value) || storageLabel}`}
      >
        {value !== "" && (
          <li>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground-muted hover:bg-surface-muted"
              onClick={() => onChange(readParentPath(value))}
            >
              <CornerLeftUp className="h-4 w-4 stroke-[1.5]" aria-hidden />
              Up one level
            </button>
          </li>
        )}
        {isPending && (
          <li className="flex items-center gap-2 px-3 py-1.5 text-foreground-subtle">
            <LoadingIndicator className="h-4 w-4" /> Loading folders…
          </li>
        )}
        {error && <li className="px-3 py-1.5 text-danger">{error.message}</li>}
        {!isPending && !error && folders.length === 0 && (
          <li className="px-3 py-1.5 text-foreground-subtle">No subfolders. This folder is selected.</li>
        )}
        {folders.map((folder) => (
          <li key={folder.path}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-muted"
              onClick={() => onChange(folder.path)}
            >
              <Folder className="h-4 w-4 flex-none stroke-[1.5] text-primary" aria-hidden />
              <span className="truncate">{folder.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
