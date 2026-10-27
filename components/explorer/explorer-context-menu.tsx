"use client";

import { useRouter } from "next/navigation";
import {
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus,
  FolderInput,
  FolderOpen,
  FolderOpenDot,
  FolderPlus,
  HardDriveUpload,
  Info,
  PanelsTopLeft,
  Pencil,
  Scissors,
  Settings2,
  Shield,
  SquareArrowOutUpRight,
  SquareTerminal,
  Trash2,
  Upload,
} from "lucide-react";
import { BrainIcon } from "@/components/icons/cmm-icons";
import { ContextMenu, type ContextMenuAction } from "@/components/interactive/context-menu";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { useOpenTerminal } from "@/components/terminal/use-open-terminal";
import { useMemoryMutations } from "@/lib/client/memory";
import { useFileClipboard } from "@/lib/client/clipboard";
import {
  copyEntryPath,
  isDesktopApp,
  openInFileManager,
  readFileManagerName,
  revealInFileManager,
} from "@/lib/client/desktop";
import { readParentPath } from "@/lib/client/query-keys";
import { buildMemoryBackupHref, buildMemoryHref } from "@/lib/client/routes";

/**
 * The right-click menu of the tree: open, new items, rename, copy, cut, move to a folder,
 * paste, trash, upload, download, backup, terminal, the file manager and the full path (desktop
 * app), memory conversion, folder settings and properties. Actions the user can't take are
 * disabled with the reason in a tooltip.
 *
 * @example
 * <ExplorerContextMenu />
 */
export function ExplorerContextMenu() {
  const explorer = useExplorer();
  const router = useRouter();
  const { convertMemory } = useMemoryMutations();
  const onConvertToFolder = (folderPath: string) => {
    convertMemory.mutateAsync({ storageId: explorer.storage.id, path: folderPath, to: "folder" }).then(
      () => announce("Memory is now a plain folder", "Its files stay as they are."),
      (convertError: unknown) => announceError("Couldn't convert the memory", convertError),
    );
  };
  const clipboard = useFileClipboard();
  const terminal = useOpenTerminal();
  const { contextMenu, canWrite, readOnlyReason } = explorer;

  if (!contextMenu) return null;
  const { entry } = contextMenu;
  const folderPath = entry ? (entry.type === "directory" ? entry.path : readParentPath(entry.path)) : explorer.rootPath;
  const actionPaths = entry ? explorer.readActionPaths(entry.path) : [];
  const folderReason = canWrite ? explorer.readWriteReason(folderPath) : readOnlyReason;
  const entryReason = entry ? explorer.readWriteReason(entry.path) : folderReason;
  const close = () => explorer.openContextMenu(undefined);

  const actions: ContextMenuAction[] = [];
  if (entry) {
    actions.push({
      key: "open",
      label: "Open",
      icon: FolderOpen,
      onSelect: () => {
        if (entry.type === "directory") explorer.setExpanded(entry.path, true);
        explorer.selectPath(entry.path);
      },
    });
    if (entry.badges.isMemory && entry.path !== explorer.rootPath) {
      actions.push({
        key: "open-memory-view",
        label: "Open memory view",
        icon: PanelsTopLeft,
        onSelect: () => router.push(buildMemoryHref(explorer.storage.id, entry.path)),
      });
    }
  }
  actions.push(
    {
      key: "new-file",
      label: "New file",
      icon: FilePlus,
      onSelect: () => explorer.startDraft("file", folderPath),
      disabledReason: folderReason,
      dividerBefore: entry !== undefined,
    },
    {
      key: "new-folder",
      label: "New folder",
      icon: FolderPlus,
      onSelect: () => explorer.startDraft("directory", folderPath),
      disabledReason: folderReason,
    },
    {
      key: "new-memory",
      label: "New memory",
      icon: BrainIcon,
      onSelect: () => explorer.openDialog({ kind: "new-memory", parentPath: folderPath }),
      disabledReason: folderReason,
    },
  );
  if (entry) {
    actions.push(
      {
        key: "rename",
        label: "Rename",
        icon: Pencil,
        onSelect: () => explorer.startRename(entry.path),
        disabledReason: entryReason ?? (actionPaths.length > 1 ? "Select one item to rename it." : undefined),
        dividerBefore: true,
      },
      { key: "copy", label: "Copy", icon: Copy, onSelect: () => explorer.copyToClipboard("copy", actionPaths) },
      {
        key: "cut",
        label: "Cut",
        icon: Scissors,
        onSelect: () => explorer.copyToClipboard("cut", actionPaths),
        disabledReason: entryReason,
      },
      {
        key: "move",
        label: actionPaths.length > 1 ? `Move ${actionPaths.length} items to…` : "Move to…",
        icon: FolderInput,
        onSelect: () => explorer.openDialog({ kind: "move", paths: actionPaths }),
        disabledReason: entryReason ?? actionPaths.map(explorer.readWriteReason).find(Boolean),
      },
    );
  }
  actions.push({
    key: "paste",
    label: "Paste",
    icon: ClipboardPaste,
    onSelect: () => void explorer.pasteInto(folderPath),
    disabledReason: folderReason ?? (clipboard ? undefined : "Copy or cut something first."),
    dividerBefore: !entry,
  });
  if (entry) {
    actions.push({
      key: "delete",
      label: actionPaths.length > 1 ? `Move ${actionPaths.length} items to Trash` : "Move to Trash",
      icon: Trash2,
      tone: "danger",
      onSelect: () => explorer.openDialog({ kind: "delete", paths: actionPaths }),
      disabledReason: entryReason,
    });
  }
  actions.push(
    {
      key: "upload",
      label: "Upload here",
      icon: Upload,
      onSelect: () => explorer.openUploadPicker(folderPath),
      disabledReason: folderReason,
      dividerBefore: true,
    },
    {
      key: "download",
      label: entry?.type === "file" ? "Download" : "Download as zip",
      icon: Download,
      onSelect: () => void explorer.download(entry?.path ?? explorer.rootPath),
    },
  );
  if (entry) {
    const areAllFolders = actionPaths.every((actionPath) => explorer.findEntry(actionPath)?.type === "directory");
    actions.push({
      key: "backup-memory",
      label:
        actionPaths.length > 1 ? `Back up ${actionPaths.length} folders to a new memory…` : "Back up to a new memory…",
      icon: HardDriveUpload,
      onSelect: () => router.push(buildMemoryBackupHref(explorer.storage.id, actionPaths)),
      disabledReason: areAllFolders ? undefined : "Only folders can be backed up. Select folders and memories only.",
    });
  }
  if (terminal.isOffered) {
    actions.push({
      key: "open-terminal",
      label: "Open in terminal",
      icon: SquareTerminal,
      onSelect: () => terminal.open(explorer.storage.id, folderPath),
      disabledReason: terminal.disabledReason,
    });
  }
  if (explorer.mode === "desktop") {
    const revealPath = entry?.path ?? explorer.rootPath;
    const desktopReason = isDesktopApp() ? undefined : "Open CMM in its desktop app to reveal files.";
    const showInFileManager = (show: () => Promise<boolean>, failure: string) => {
      show().then(
        (isShown) => {
          if (!isShown) announceError(failure, new Error("It is no longer on disk."));
        },
        (showError: unknown) => announceError(failure, showError),
      );
    };
    if (!entry || entry.type === "directory") {
      actions.push({
        key: "open-in-file-manager",
        label: `Open in ${readFileManagerName()}`,
        icon: FolderOpenDot,
        onSelect: () =>
          showInFileManager(() => openInFileManager(explorer.storage.id, folderPath), "Couldn't open the folder"),
        disabledReason: desktopReason,
      });
    }
    actions.push(
      {
        key: "reveal",
        label: `Reveal in ${readFileManagerName()}`,
        icon: SquareArrowOutUpRight,
        onSelect: () =>
          showInFileManager(() => revealInFileManager(explorer.storage.id, revealPath), "Couldn't reveal it"),
        disabledReason: desktopReason,
      },
      {
        key: "copy-path",
        label: "Copy full path",
        icon: ClipboardCopy,
        onSelect: () =>
          copyEntryPath(explorer.storage.id, revealPath).then(
            (absolutePath) => announce("Copied", absolutePath),
            (copyError: unknown) => announceError("Couldn't copy the path", copyError),
          ),
        disabledReason: desktopReason ?? (actionPaths.length > 1 ? "Select one item to copy its path." : undefined),
      },
    );
  }
  if (entry?.type === "directory") {
    actions.push(
      entry.badges.isMemory
        ? {
            key: "convert-folder",
            label: "Convert to plain folder",
            icon: FolderOpen,
            onSelect: () => onConvertToFolder(entry.path),
            disabledReason: entryReason,
            dividerBefore: true,
          }
        : {
            key: "convert-memory",
            label: "Convert to memory",
            icon: BrainIcon,
            onSelect: () => explorer.openDialog({ kind: "convert-memory", path: entry.path }),
            disabledReason: entryReason,
            dividerBefore: true,
          },
      {
        key: "folder-settings",
        label: "Folder settings",
        icon: Settings2,
        onSelect: () => explorer.openDialog({ kind: "folder-settings", path: entry.path }),
      },
      {
        key: "protection",
        label: "Protection…",
        icon: Shield,
        onSelect: () => explorer.openDialog({ kind: "folder-settings", path: entry.path, tab: "protection" }),
      },
    );
  }
  if (entry) {
    actions.push({
      key: "properties",
      label: "Properties",
      icon: Info,
      onSelect: () => explorer.openDialog({ kind: "properties", path: entry.path }),
      dividerBefore: entry.type !== "directory",
    });
  }

  return <ContextMenu position={contextMenu} actions={actions} onClose={close} testId="explorer-context-menu" />;
}
