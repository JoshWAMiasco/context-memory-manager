"use client";

import dayjs from "dayjs";
import type { ReactNode } from "react";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { FileIcon } from "@/components/explorer/file-icon";
import { ItemBadges } from "@/components/explorer/item-badges";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { ProtectionTab } from "@/components/folder-settings/protection-tab";
import { useStat } from "@/lib/client/fs";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

const KIND_LABELS: Record<string, string> = {
  folder: "Folder",
  markdown: "Markdown",
  code: "Code",
  text: "Text",
  csv: "Table (CSV)",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  archive: "Archive",
  binary: "File",
};

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Name, kind, size, times, location, badges and permissions of one entry, the memory name,
 * and for files "Protect this file".
 *
 * @example
 * <PropertiesDialog storageId={storageId} storageLabel="Files" path="notes/today.md" onClose={close} />
 */
export function PropertiesDialog({
  storageId,
  storageLabel,
  path,
  onClose,
}: {
  storageId: string;
  storageLabel: string;
  path: string;
  onClose: () => void;
}) {
  const { data: fileStat, error } = useStat(storageId, path);
  const entry = fileStat?.entry;
  const formatTime = (timeMs: number) => dayjs(timeMs).format("MMMM D, YYYY HH:mm:ss");
  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title="Properties" size="large">
      <ModalBody>
        {error && <p className="text-danger">{error.message}</p>}
        {!entry && !error && <LoadingSkeleton rows={4} label="Loading properties…" />}
        {entry && (
          <dl data-testid="properties-dialog" className="text-sm">
            <PropertyRow label="Name">
              <span className="flex items-center gap-2">
                <FileIcon entry={entry} />
                {entry.name}
              </span>
            </PropertyRow>
            <PropertyRow label="Kind">
              {KIND_LABELS[entry.kind] ?? entry.kind}
              {entry.badges.isMemory ? " (memory)" : ""}
            </PropertyRow>
            {entry.type === "file" && (
              <PropertyRow label="Size">{`${formatFileSize(entry.size)} (${entry.size.toLocaleString()} bytes)`}</PropertyRow>
            )}
            <PropertyRow label="Location">
              {storageLabel} / {path}
            </PropertyRow>
            <PropertyRow label="Created">{formatTime(entry.createdMs)}</PropertyRow>
            <PropertyRow label="Modified">{formatTime(entry.mtimeMs)}</PropertyRow>
            <PropertyRow label="Access">
              {fileStat.permissions.write
                ? "Read and write"
                : `Read only${fileStat.permissions.reason ? `: ${fileStat.permissions.reason}` : ""}`}
            </PropertyRow>
            <PropertyRow label="Status">
              <ItemBadges badges={entry.badges} path={entry.path} showsInherited />
              {!entry.badges.encrypted && !entry.badges.versioned && entry.badges.protection === "none" && "Normal"}
            </PropertyRow>
            {entry.badges.memory && <PropertyRow label="Memory name">{entry.badges.memory.name}</PropertyRow>}
          </dl>
        )}
        {entry?.type === "file" && (
          <details className="mt-4 rounded-md border border-line" data-testid="protect-this-file">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Protect this file</summary>
            <div className="border-t border-line p-4">
              <ProtectionTab path={entry.path} />
            </div>
          </details>
        )}
      </ModalBody>
      <ModalFooter>
        <ModalCloseButton>Close</ModalCloseButton>
      </ModalFooter>
    </Modal>
  );
}
