"use client";

import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from "@floating-ui/react";
import { useRouter } from "next/navigation";
import {
  ClipboardPaste,
  Copy,
  Download,
  FilePlus,
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
import { useRef, useState, type ComponentType } from "react";
import { BrainIcon } from "@/components/icons/cmm-icons";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { useOpenTerminal } from "@/components/terminal/use-open-terminal";
import { useMemoryMutations } from "@/lib/client/memory";
import { useFileClipboard } from "@/lib/client/clipboard";
import { isDesktopApp, openInFileManager, readFileManagerName, revealInFileManager } from "@/lib/client/desktop";
import { readParentPath } from "@/lib/client/query-keys";
import { buildMemoryBackupHref, buildMemoryHref } from "@/lib/client/routes";
import { mergeClassNames } from "@/utilities/merge-class-names";

interface MenuAction {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabledReason?: string;
  tone?: "danger";
  dividerBefore?: boolean;
}

/**
 * The right-click menu of the tree, positioned at the pointer with Floating UI. Actions
 * the user can't take are disabled with the reason in a tooltip; arrow keys move between items and
 * Escape closes it.
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<(HTMLElement | null)[]>([]);
  const isOpen = contextMenu !== undefined;
  const [floatingElement, setFloatingElement] = useState<HTMLDivElement | null>(null);
  const [anchorElement, setAnchorElement] = useState<HTMLSpanElement | null>(null);
  const { floatingStyles, context } = useFloating({
    elements: { reference: anchorElement, floating: floatingElement },
    open: isOpen,
    onOpenChange: (nextIsOpen) => {
      if (!nextIsOpen) explorer.openContextMenu(undefined);
    },
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [
      offset({ mainAxis: 2, alignmentAxis: 2 }),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      // At most as tall as the room left on screen; the rest scrolls (scrollbar-visible).
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(120, Math.floor(availableHeight))}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const { getFloatingProps, getItemProps } = useInteractions([
    useDismiss(context),
    useRole(context, { role: "menu" }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex, loop: true }),
  ]);

  if (!contextMenu) return null;
  const { entry } = contextMenu;
  const folderPath = entry ? (entry.type === "directory" ? entry.path : readParentPath(entry.path)) : explorer.rootPath;
  const actionPaths = entry ? explorer.readActionPaths(entry.path) : [];
  const folderReason = canWrite ? explorer.readWriteReason(folderPath) : readOnlyReason;
  const entryReason = entry ? explorer.readWriteReason(entry.path) : folderReason;
  const close = () => explorer.openContextMenu(undefined);

  const actions: MenuAction[] = [];
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
    actions.push({
      key: "reveal",
      label: `Reveal in ${readFileManagerName()}`,
      icon: SquareArrowOutUpRight,
      onSelect: () =>
        showInFileManager(() => revealInFileManager(explorer.storage.id, revealPath), "Couldn't reveal it"),
      disabledReason: desktopReason,
    });
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

  return (
    <FloatingPortal>
      <span
        ref={setAnchorElement}
        aria-hidden="true"
        style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, width: 0, height: 0 }}
      />
      <FloatingFocusManager context={context} modal={false}>
        <div
          ref={setFloatingElement}
          style={floatingStyles}
          data-testid="explorer-context-menu"
          tabIndex={-1}
          className="scrollbar-visible z-[70] min-w-56 overflow-y-auto overscroll-contain rounded-md border border-line-strong bg-surface-strong p-1 text-sm shadow-overlay"
          {...getFloatingProps()}
        >
          {actions.map((action, actionIndex) => {
            const ActionIcon = action.icon;
            const isDisabled = action.disabledReason !== undefined;
            return (
              <div key={action.key}>
                {action.dividerBefore && <div className="my-1 border-t border-line/60" />}
                <button
                  type="button"
                  role="menuitem"
                  ref={(element) => {
                    listRef.current[actionIndex] = element;
                  }}
                  aria-disabled={isDisabled}
                  title={action.disabledReason}
                  tabIndex={activeIndex === actionIndex ? 0 : -1}
                  data-testid={`menu-${action.key}`}
                  {...getItemProps({
                    onClick: () => {
                      if (isDisabled) return;
                      close();
                      action.onSelect();
                    },
                  })}
                  className={mergeClassNames(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left outline-none",
                    action.tone === "danger" ? "text-danger" : "text-foreground",
                    isDisabled ? "cursor-not-allowed opacity-45" : "hover:bg-surface-muted focus:bg-surface-muted",
                  )}
                >
                  <ActionIcon className="h-4 w-4 flex-none stroke-[1.5]" />
                  <span className="flex-1">{action.label}</span>
                  {action.disabledReason && <span className="sr-only">({action.disabledReason})</span>}
                </button>
              </div>
            );
          })}
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
