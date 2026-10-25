"use client";

import dayjs from "dayjs";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/interactive/tooltip";
import { useExplorer } from "@/components/explorer/explorer-context";
import { ItemBadges } from "@/components/explorer/item-badges";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { FileEntry } from "@/lib/api-types";

/**
 * An icon button in the pane header, with its label (or the reason it is disabled) as a tooltip.
 *
 * @example
 * <PaneAction label="Rename" icon={Pencil} onClick={rename} disabledReason={readOnlyReason} />
 */
export function PaneAction({
  label,
  icon: ActionIcon,
  onClick,
  disabledReason,
  testId,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabledReason?: string;
  testId?: string;
}) {
  return (
    <Tooltip content={disabledReason ?? label}>
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabledReason !== undefined}
        data-testid={testId}
        onClick={() => !disabledReason && onClick()}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-muted hover:text-brand aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
      >
        <ActionIcon className="h-4 w-4 stroke-[1.5]" />
      </button>
    </Tooltip>
  );
}

function PathCrumbs({ entryPath }: { entryPath: string }) {
  const explorer = useExplorer();
  const segments = entryPath.split("/").filter(Boolean);
  return (
    <nav aria-label="Location" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-foreground-subtle">
      <button type="button" className="cursor-pointer hover:text-brand" onClick={() => explorer.selectPath("")}>
        {explorer.storage.label}
      </button>
      {segments.slice(0, -1).map((segment, segmentIndex) => {
        const segmentPath = segments.slice(0, segmentIndex + 1).join("/");
        return (
          <span key={segmentPath} className="flex items-center gap-1">
            <span>/</span>
            <button
              type="button"
              className="cursor-pointer hover:text-brand"
              onClick={() => explorer.selectPath(segmentPath)}
            >
              {segment}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/**
 * The top of the right pane: icon, name with badges, location, size and modified time, and the
 * actions passed as children.
 *
 * @example
 * <PaneHeader entry={entry} title={entry.name} icon={<FileIcon entry={entry} />}>…actions…</PaneHeader>
 */
export function PaneHeader({
  entry,
  title,
  icon,
  extra,
  children,
}: {
  entry?: FileEntry;
  title: string;
  icon: ReactNode;
  /** Shown after the size and time line, for example the image dimensions. */
  extra?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-3 border-b border-line/60 px-5 py-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-1">{icon}</span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate font-display text-base font-medium" data-testid="pane-title">
            <span className="truncate">{title}</span>
            {entry && <ItemBadges badges={entry.badges} path={entry.path} showsInherited />}
          </h2>
          {entry && <PathCrumbs entryPath={entry.path} />}
          {entry && (
            <p className="mt-0.5 text-xs text-foreground-subtle">
              {entry.type === "file" ? `${formatFileSize(entry.size)} · ` : ""}
              Modified {dayjs(entry.mtimeMs).format("MMM D, YYYY HH:mm")}
              {extra}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-0.5">{children}</div>
    </header>
  );
}
