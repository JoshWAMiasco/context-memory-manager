"use client";

import { Download, FilePlus, FolderPlus, FolderUp, Info, Pencil, Trash2, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/primitives/empty-state";
import { UnsavedChangesGuard } from "@/components/editor/unsaved-changes-guard";
import { useExplorer } from "@/components/explorer/explorer-context";
import { FileIcon } from "@/components/explorer/file-icon";
import { UploadDropzone } from "@/components/explorer/upload-dropzone";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { FolderOverview } from "@/components/memory/folder-overview";
import { FileView } from "@/components/viewer/file-view";
import { PaneAction, PaneHeader } from "@/components/viewer/pane-header";
import { HistoryPanel } from "@/components/versioning/history-panel";
import { UndoRedoButtons } from "@/components/versioning/undo-redo-buttons";
import { ApiError } from "@/lib/client/api";
import { useDirectory, useStat } from "@/lib/client/fs";
import { readBaseName } from "@/lib/client/query-keys";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

function FolderSummary({ folderPath }: { folderPath: string }) {
  const { storage } = useExplorer();
  const { data: listing } = useDirectory(storage.id, folderPath);
  if (!listing) return <LoadingSkeleton rows={3} label="Loading the folder…" />;
  const folderCount = listing.entries.filter((entry) => entry.type === "directory").length;
  const files = listing.entries.filter((entry) => entry.type === "file");
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
  return (
    <div data-testid="folder-summary" className="grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="box p-4">
        <div className="text-2xl font-medium">{plural(folderCount, "folder")}</div>
        <div className="text-xs text-foreground-subtle">directly inside</div>
      </div>
      <div className="box p-4">
        <div className="text-2xl font-medium">{plural(files.length, "file")}</div>
        <div className="text-xs text-foreground-subtle">
          {formatFileSize(totalSize)}
          {listing.nextCursor ? " so far (very large folder)" : ""}
        </div>
      </div>
    </div>
  );
}

/**
 * The right-hand pane: the selected entry's header (icon, name, location, size,
 * modified time, badges, actions) and body. Folders show a summary; files open in `FileView`
 * (viewer and editor). An entry whose history was opened shows the History view. A file that disappears keeps its view, so unsaved edits can still be
 * saved elsewhere. Files dragged from the computer onto it are uploaded into the shown folder.
 *
 * @example
 * <FilePane />
 */
export function FilePane() {
  const explorer = useExplorer();
  const { storage, selectedPath } = explorer;
  const isRoot = selectedPath === "";
  const { data: fileStat, error } = useStat(storage.id, selectedPath, !isRoot);
  const entry = fileStat?.entry;
  const folderPath = isRoot ? "" : entry?.type === "directory" ? entry.path : undefined;
  const uploadFolder = folderPath ?? explorer.readTargetFolder(selectedPath);
  const writeReason = explorer.readWriteReason(isRoot ? "" : selectedPath);

  const folderActions = (targetFolder: string) => (
    <>
      <PaneAction
        label="New file"
        icon={FilePlus}
        disabledReason={writeReason}
        onClick={() => explorer.openDialog({ kind: "new-item", type: "file", parentPath: targetFolder })}
      />
      <PaneAction
        label="New folder"
        icon={FolderPlus}
        disabledReason={writeReason}
        onClick={() => explorer.openDialog({ kind: "new-item", type: "directory", parentPath: targetFolder })}
      />
      <PaneAction
        label="Upload files"
        icon={Upload}
        disabledReason={writeReason}
        onClick={() => explorer.openUploadPicker(targetFolder)}
      />
      <PaneAction
        label="Upload a folder"
        icon={FolderUp}
        disabledReason={writeReason}
        onClick={() => explorer.openFolderUploadPicker(targetFolder)}
      />
    </>
  );

  let content: ReactNode;
  if (entry && explorer.historyPath === selectedPath && entry.path === selectedPath) {
    const focus = explorer.historyFocus;
    content = (
      <HistoryPanel key={`${storage.id}:${entry.path}:${focus?.sha ?? ""}:${focus?.trashItemId ?? ""}`} entry={entry} />
    );
  } else if (isRoot) {
    content = (
      <>
        <PaneHeader
          title={storage.label}
          icon={
            <FileIcon
              entry={{
                name: storage.label,
                type: "directory",
                badges: { isMemory: false, protection: "none", encrypted: false, versioned: false },
              }}
              isOpen
            />
          }
        >
          {folderActions("")}
          <PaneAction label="Download as zip" icon={Download} onClick={() => void explorer.download("")} />
        </PaneHeader>
        <div className="p-5">
          <FolderSummary folderPath="" />
        </div>
      </>
    );
  } else if (entry?.type === "file" && entry.path === selectedPath && fileStat) {
    content = <FileView key={`${storage.id}:${entry.path}`} entry={entry} fileStat={fileStat} />;
  } else if (error && !entry) {
    content = (
      <EmptyState
        className="m-auto"
        title={
          error instanceof ApiError && error.status === 404 ? "This item no longer exists" : "Couldn't open this item"
        }
        description={error.message}
      />
    );
  } else if (!entry) {
    content = <LoadingSkeleton rows={5} label="Loading…" className="p-5" />;
  } else {
    content = (
      <>
        <PaneHeader entry={entry} title={entry.name} icon={<FileIcon entry={entry} isOpen />}>
          <UndoRedoButtons path={entry.path} />
          {folderActions(entry.path)}
          <PaneAction
            label="Download as zip"
            icon={Download}
            testId="pane-download"
            onClick={() => void explorer.download(entry.path)}
          />
          <PaneAction
            label="Rename"
            icon={Pencil}
            testId="pane-rename"
            disabledReason={writeReason}
            onClick={() => explorer.openDialog({ kind: "rename", path: entry.path })}
          />
          <PaneAction
            label="Move to Trash"
            icon={Trash2}
            testId="pane-delete"
            disabledReason={writeReason}
            onClick={() => explorer.openDialog({ kind: "delete", paths: [entry.path] })}
          />
          <PaneAction
            label="Properties"
            icon={Info}
            testId="pane-properties"
            onClick={() => explorer.openDialog({ kind: "properties", path: entry.path })}
          />
        </PaneHeader>
        <div className="p-5">
          <FolderOverview entry={entry} />
        </div>
      </>
    );
  }

  return (
    <UploadDropzone
      className="flex h-full min-h-0 flex-col overflow-auto"
      folderLabel={uploadFolder === "" ? storage.label : readBaseName(uploadFolder)}
      isEnabled={explorer.readWriteReason(uploadFolder) === undefined}
      onDrop={(dropped) => explorer.uploadDropped(dropped, uploadFolder)}
    >
      <div className="flex min-h-0 flex-1 flex-col" data-testid="file-pane">
        {content}
      </div>
      <UnsavedChangesGuard />
    </UploadDropzone>
  );
}
