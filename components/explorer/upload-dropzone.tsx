"use client";

import { UploadCloud } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import { ENTRY_DRAG_TYPE } from "@/lib/client/entry-drag";
import { captureDroppedEntries } from "@/lib/client/folder-upload";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * Wraps the file pane: while files or folders from the computer are dragged over it, an overlay
 * says where they will go, and dropping them queues the uploads (folders with everything in them).
 * Entries dragged inside CMM are ignored here; the tree handles those.
 *
 * @example
 * <UploadDropzone folderLabel="notes" isEnabled={canWrite} onDrop={(dropped) => uploadDropped(dropped, "notes")}>…</UploadDropzone>
 */
export function UploadDropzone({
  folderLabel,
  isEnabled,
  onDrop,
  className,
  children,
}: {
  folderLabel: string;
  isEnabled: boolean;
  /** The dropped files and folders, captured during the drop (see `captureDroppedEntries`). */
  onDrop: (dropped: (FileSystemEntry | File)[]) => void;
  className?: string;
  children: ReactNode;
}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const isFileDrag = (dragEvent: DragEvent<HTMLDivElement>) =>
    isEnabled &&
    dragEvent.dataTransfer.types.includes("Files") &&
    !dragEvent.dataTransfer.types.includes(ENTRY_DRAG_TYPE);

  return (
    <div
      className={mergeClassNames("relative", className)}
      data-testid="upload-dropzone"
      onDragOver={(dragEvent) => {
        if (!isFileDrag(dragEvent)) return;
        dragEvent.preventDefault();
        dragEvent.dataTransfer.dropEffect = "copy";
        if (!isDraggingFiles) setIsDraggingFiles(true);
      }}
      onDragLeave={(dragEvent) => {
        if (!dragEvent.currentTarget.contains(dragEvent.relatedTarget as Node | null)) setIsDraggingFiles(false);
      }}
      onDrop={(dragEvent) => {
        if (!isFileDrag(dragEvent)) return;
        dragEvent.preventDefault();
        setIsDraggingFiles(false);
        const dropped = captureDroppedEntries(dragEvent.dataTransfer);
        if (dropped.length > 0) onDrop(dropped);
      }}
    >
      {children}
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-brand bg-canvas/85 text-brand backdrop-blur-sm">
          <UploadCloud className="h-10 w-10 stroke-[1.25]" />
          <p className="font-medium">Drop to upload to {folderLabel}</p>
        </div>
      )}
    </div>
  );
}
