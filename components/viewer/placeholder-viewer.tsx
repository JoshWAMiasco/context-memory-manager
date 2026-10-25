"use client";

import dayjs from "dayjs";
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/primitives/button";
import { FileIcon } from "@/components/explorer/file-icon";
import { ItemBadges } from "@/components/explorer/item-badges";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { FileEntry } from "@/lib/api-types";
import { describeFileKind } from "@/lib/file-kinds";

const KIND_LABELS: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  pdf: "PDF document",
  archive: "Archive",
  binary: "Binary file",
  image: "Image",
  markdown: "Markdown",
  code: "Source code",
  text: "Text",
  csv: "Table (CSV)",
};

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * What a file shows when it has no preview: video, audio, archives, binaries, and files
 * too large, damaged or locked to show. A large file-type icon, the file's details and Download.
 * Media is never played: no `<video>`, `<audio>`, `<iframe>` or `<embed>` is rendered.
 *
 * @example
 * <PlaceholderViewer entry={entry} onDownload={() => explorer.download(entry.path)} />
 */
export function PlaceholderViewer({
  entry,
  message,
  onDownload,
}: {
  entry: FileEntry;
  /** Overrides the default text, for example "This image is too large to preview". */
  message?: string;
  onDownload: () => void;
}) {
  const kindInfo = describeFileKind(entry.name);
  const isMedia = kindInfo.kind === "video" || kindInfo.kind === "audio";
  const text =
    message ??
    (isMedia ? "Preview isn't available for video or audio files." : "Preview isn't available for this file type.");
  return (
    <div className="flex flex-1 flex-col items-center px-5 py-10" data-testid="placeholder-viewer">
      <FileIcon entry={entry} className="h-24 w-24" />
      <p className="mt-4 text-center text-foreground-muted" data-testid="placeholder-message">
        {text}
      </p>
      <Button
        variant="outline-primary"
        className="mt-4"
        onClick={onDownload}
        leadingIcon={<Download className="mr-2 h-4 w-4" />}
        data-testid="placeholder-download"
      >
        Download
      </Button>
      <dl className="box mt-6 w-full max-w-lg px-5 py-3 text-sm" data-testid="placeholder-metadata">
        <MetadataRow label="Name">{entry.name}</MetadataRow>
        <MetadataRow label="Type">
          {KIND_LABELS[kindInfo.kind] ?? "File"} <span className="text-foreground-subtle">({kindInfo.mime})</span>
        </MetadataRow>
        <MetadataRow label="Size">
          {formatFileSize(entry.size)}{" "}
          <span className="text-foreground-subtle">({entry.size.toLocaleString()} bytes)</span>
        </MetadataRow>
        <MetadataRow label="Modified">{dayjs(entry.mtimeMs).format("MMM D, YYYY HH:mm")}</MetadataRow>
        <MetadataRow label="Created">{dayjs(entry.createdMs).format("MMM D, YYYY HH:mm")}</MetadataRow>
        <MetadataRow label="Path">{entry.path}</MetadataRow>
        {(entry.badges.isMemory ||
          entry.badges.protection !== "none" ||
          entry.badges.encrypted ||
          entry.badges.versioned) && (
          <MetadataRow label="Badges">
            <ItemBadges badges={entry.badges} path={entry.path} />
          </MetadataRow>
        )}
      </dl>
    </div>
  );
}
