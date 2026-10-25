"use client";

import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from "@floating-ui/react";
import {
  ClipboardPaste,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Info,
  Pencil,
  Scissors,
  Settings2,
  Shield,
  SquareArrowOutUpRight,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type ComponentType } from "react";
import { BrainIcon } from "@/components/icons/cmm-icons";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { useMemoryMutations } from "@/lib/client/memory";
import { useFileClipboard } from "@/lib/client/clipboard";
import { isDesktopApp, readFileManagerName, revealInFileManager } from "@/lib/client/desktop";
import { readParentPath } from "@/lib/client/query-keys";
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
  const { convertMemory } = useMemoryMutations();
  const onConvertToFolder = (folderPath: string) => {
    convertMemory.mutateAsync({ storageId: explorer.storage.id, path: folderPath, to: "folder" }).then(
      () => announce("Memory is now a plain folder", "Its files stay as they are."),
      (convertError: unknown) => announceError("Couldn't convert the memory", convertError),
    );
  };
  const clipboard = useFileClipboard();
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
    middleware: [offset({ mainAxis: 2, alignmentAxis: 2 }), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getFloatingProps, getItemProps } = useInteractions([
    useDismiss(context),
    useRole(context, { role: "menu" }),
    useListNavigation(context, { listRef, activeIndex, onNavigate: setActiveIndex, loop: true }),
  ]);

  if (!contextMenu) return null;
  const { entry } = contextMenu;
  const folderPath = entry ? (entry.type === "directory" ? entry.path : readParentPath(entry.path)) : "";
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
      onSelect: () => void explorer.download(entry?.path ?? ""),
    },
  );
  if (explorer.mode === "desktop") {
    const revealPath = entry?.path ?? "";
    actions.push({
      key: "reveal",
      label: `Reveal in ${readFileManagerName()}`,
      icon: SquareArrowOutUpRight,
      onSelect: () => {
        revealInFileManager(explorer.storage.id, revealPath).then(
          (isShown) => {
            if (!isShown) announceError("Couldn't reveal it", new Error("It is no longer on disk."));
          },
          (revealError: unknown) => announceError("Couldn't reveal it", revealError),
        );
      },
      disabledReason: isDesktopApp() ? undefined : "Open CMM in its desktop app to reveal files.",
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
          className="z-[70] min-w-56 rounded-md border border-line-strong bg-surface-strong p-1 text-sm shadow-overlay"
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
