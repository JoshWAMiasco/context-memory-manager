"use client";

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { useExplorer } from "@/components/explorer/explorer-context";
import { FileTreeNode, InlineNameInput, TREE_INDENT, TREE_ROW_HEIGHT } from "@/components/explorer/file-tree-node";
import { FileIcon } from "@/components/explorer/file-icon";
import type { DirectoryListing, FileEntry } from "@/lib/api-types";
import { useFileClipboard } from "@/lib/client/clipboard";
import { ENTRY_DRAG_TYPE, readDraggedEntries, type DraggedEntries } from "@/lib/client/entry-drag";
import { captureDroppedEntries } from "@/lib/client/folder-upload";
import { getServerEventsClient } from "@/lib/client/events";
import { directoryQueryOptions, loadMoreEntries, type StoragePath } from "@/lib/client/fs";
import { isInsideFolder, readParentPath } from "@/lib/client/query-keys";
import { mergeClassNames } from "@/utilities/merge-class-names";

const OVERSCAN_ROWS = 8;
const TYPE_AHEAD_RESET_MILLISECONDS = 600;

type TreeRow =
  | { kind: "entry"; key: string; entry: FileEntry; depth: number; isExpanded: boolean }
  | { kind: "draft"; key: string; depth: number; type: "file" | "directory" }
  | { kind: "loading"; key: string; depth: number }
  | { kind: "more"; key: string; depth: number; directoryPath: string };

function buildRows(
  rootPath: string,
  listings: ReadonlyMap<string, DirectoryListing | undefined>,
  expandedPaths: ReadonlySet<string>,
  draft: { parentPath: string; type: "file" | "directory" } | undefined,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const addFolder = (directoryPath: string, depth: number) => {
    if (draft?.parentPath === directoryPath)
      rows.push({ kind: "draft", key: `draft:${directoryPath}`, depth, type: draft.type });
    const listing = listings.get(directoryPath);
    if (!listing) {
      rows.push({ kind: "loading", key: `loading:${directoryPath}`, depth });
      return;
    }
    for (const entry of listing.entries) {
      const isExpanded = entry.type === "directory" && expandedPaths.has(entry.path);
      rows.push({ kind: "entry", key: entry.path, entry, depth, isExpanded });
      if (isExpanded) addFolder(entry.path, depth + 1);
    }
    if (listing.nextCursor) rows.push({ kind: "more", key: `more:${directoryPath}`, depth, directoryPath });
  };
  addFolder(rootPath, 0);
  return rows;
}

function useDirectoryWatches(storageId: string, directoryPaths: readonly string[]): void {
  const watchKey = directoryPaths.join("\u0000");
  useEffect(() => {
    const eventsClient = getServerEventsClient();
    const stopWatching = watchKey.split("\u0000").map((directoryPath) => eventsClient.watch(storageId, directoryPath));
    return () => {
      for (const stop of stopWatching) stop();
    };
  }, [storageId, watchKey]);
}

/**
 * The file tree, starting at the explorer's root: the storage, or a memory in its own explorer.
 * Folders load when expanded and are watched while open, so changes made outside CMM show up. Rows are virtualised at 26px. A newly selected entry (from the URL, a link
 * or the pane) is scrolled into view once its row has loaded.
 *
 * - **Keyboard:** arrows move and select (Shift extends), Right/Left expand and collapse, Enter
 *   opens, F2 renames, Delete moves to Trash, Ctrl/Cmd+C, X, V copy, cut and paste, and typing
 *   jumps to a matching name.
 * - **Drag and drop:** dropping entries moves them (Alt/Option copies); dropping files from the
 *   computer uploads them into that folder.
 *
 * @example
 * <ExplorerProvider …><FileTree /></ExplorerProvider>
 */
export function FileTree() {
  const explorer = useExplorer();
  const { storage, rootPath, memoryRoot, expandedPaths, draft, selection, selectedPath, renamingPath, canWrite } =
    explorer;
  const queryClient = useQueryClient();
  const clipboard = useFileClipboard();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [focusedPath, setFocusedPath] = useState<string>();
  const [dropTargetPath, setDropTargetPath] = useState<string>();
  const [pendingCrossCopy, setPendingCrossCopy] = useState<{ sources: StoragePath[]; destination: StoragePath }>();
  const typeAhead = useRef({ text: "", lastKeyAt: 0 });

  const loadedPaths = useMemo(
    () => [
      rootPath,
      ...[...expandedPaths]
        .filter((expandedPath) => expandedPath !== rootPath && isInsideFolder(expandedPath, rootPath))
        .toSorted(),
    ],
    [expandedPaths, rootPath],
  );
  const listingQueries = useQueries({
    queries: loadedPaths.map((directoryPath) => directoryQueryOptions(storage.id, directoryPath)),
  });
  useDirectoryWatches(storage.id, loadedPaths);
  const listings = new Map(
    loadedPaths.map((directoryPath, pathIndex) => [directoryPath, listingQueries[pathIndex]?.data]),
  );
  const rows = buildRows(rootPath, listings, expandedPaths, draft);
  const entryRows = rows.filter((row): row is Extract<TreeRow, { kind: "entry" }> => row.kind === "entry");
  const visiblePaths = entryRows.map((row) => row.entry.path);
  const rootError = listingQueries[0]?.error;
  const cutPaths = new Set(
    clipboard?.mode === "cut"
      ? clipboard.items.filter((item) => item.storageId === storage.id).map((item) => item.path)
      : [],
  );
  const activePath = focusedPath !== undefined && visiblePaths.includes(focusedPath) ? focusedPath : selectedPath;

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const resizeObserver = new ResizeObserver(() => setViewportHeight(scrollElement.clientHeight));
    resizeObserver.observe(scrollElement);
    return () => resizeObserver.disconnect();
  }, []);

  const scrollRowIntoView = (rowIndex: number) => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || rowIndex < 0) return;
    const rowTop = rowIndex * TREE_ROW_HEIGHT;
    if (rowTop < scrollElement.scrollTop) scrollElement.scrollTop = rowTop;
    else if (rowTop + TREE_ROW_HEIGHT > scrollElement.scrollTop + scrollElement.clientHeight) {
      scrollElement.scrollTop = rowTop + TREE_ROW_HEIGHT - scrollElement.clientHeight;
    }
  };

  const selectedRowIndex = rows.findIndex((row) => row.kind === "entry" && row.entry.path === selectedPath);
  const revealedPathRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedRowIndex === -1 || revealedPathRef.current === selectedPath) return;
    revealedPathRef.current = selectedPath;
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const rowTop = selectedRowIndex * TREE_ROW_HEIGHT;
    if (
      rowTop < scrollElement.scrollTop ||
      rowTop + TREE_ROW_HEIGHT > scrollElement.scrollTop + scrollElement.clientHeight
    ) {
      scrollElement.scrollTop = Math.max(0, rowTop - scrollElement.clientHeight / 2);
    }
  }, [selectedPath, selectedRowIndex]);

  /*
   * A selected entry beyond the first page of a big folder (opened from the URL or a link) isn't
   * in the tree yet: load the folder's next page, and again, until it shows.
   */
  const selectedParentPath = selectedPath ? readParentPath(selectedPath) : undefined;
  const selectedParentCursor =
    selectedParentPath === undefined ? undefined : listings.get(selectedParentPath)?.nextCursor;
  const isSelectedParentShown =
    selectedParentPath === rootPath ||
    (selectedParentPath !== undefined &&
      isInsideFolder(selectedParentPath, rootPath) &&
      expandedPaths.has(selectedParentPath));
  useEffect(() => {
    if (selectedRowIndex !== -1 || !selectedParentCursor || !isSelectedParentShown) return;
    void loadMoreEntries(queryClient, storage.id, selectedParentPath ?? "");
  }, [isSelectedParentShown, queryClient, selectedParentCursor, selectedParentPath, selectedRowIndex, storage.id]);

  const moveFocus = (entryPath: string, extendSelection: boolean) => {
    setFocusedPath(entryPath);
    explorer.selectPath(entryPath, extendSelection ? "range" : undefined, visiblePaths);
    scrollRowIntoView(rows.findIndex((row) => row.kind === "entry" && row.entry.path === entryPath));
  };

  const handleRowClick = (entry: FileEntry, mouseEvent: MouseEvent<HTMLDivElement>) => {
    if (explorer.readBusyReason(entry.path) !== undefined) return;
    setFocusedPath(entry.path);
    if (mouseEvent.metaKey || mouseEvent.ctrlKey) explorer.selectPath(entry.path, "toggle", visiblePaths);
    else if (mouseEvent.shiftKey) explorer.selectPath(entry.path, "range", visiblePaths);
    else explorer.selectPath(entry.path);
    scrollRef.current?.focus({ preventScroll: true });
  };

  const handleTypeAhead = (character: string, now: number) => {
    const typed =
      now - typeAhead.current.lastKeyAt > TYPE_AHEAD_RESET_MILLISECONDS
        ? character
        : typeAhead.current.text + character;
    typeAhead.current = { text: typed, lastKeyAt: now };
    const lowerTyped = typed.toLowerCase();
    const startIndex = typed.length === 1 ? visiblePaths.indexOf(activePath) + 1 : visiblePaths.indexOf(activePath);
    const orderedRows = [...entryRows.slice(Math.max(0, startIndex)), ...entryRows.slice(0, Math.max(0, startIndex))];
    const match = orderedRows.find((row) => row.entry.name.toLowerCase().startsWith(lowerTyped));
    if (match) moveFocus(match.entry.path, false);
  };

  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>) => {
    if (renamingPath !== undefined || draft) return;
    const currentIndex = visiblePaths.indexOf(activePath);
    const currentRow = entryRows[currentIndex];
    const isModified = keyboardEvent.metaKey || keyboardEvent.ctrlKey;
    const handled = () => {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
    };
    switch (keyboardEvent.key) {
      case "ArrowDown": {
        handled();
        const nextPath = visiblePaths[Math.min(currentIndex + 1, visiblePaths.length - 1)];
        if (nextPath !== undefined) moveFocus(nextPath, keyboardEvent.shiftKey);
        return;
      }
      case "ArrowUp": {
        handled();
        const previousPath = visiblePaths[Math.max(currentIndex - 1, 0)];
        if (previousPath !== undefined) moveFocus(previousPath, keyboardEvent.shiftKey);
        return;
      }
      case "Home": {
        handled();
        if (visiblePaths[0] !== undefined) moveFocus(visiblePaths[0], keyboardEvent.shiftKey);
        return;
      }
      case "End": {
        handled();
        const lastPath = visiblePaths.at(-1);
        if (lastPath !== undefined) moveFocus(lastPath, keyboardEvent.shiftKey);
        return;
      }
      case "ArrowRight": {
        handled();
        if (currentRow?.entry.type !== "directory") return;
        if (!currentRow.isExpanded) explorer.setExpanded(currentRow.entry.path, true);
        else if (visiblePaths[currentIndex + 1]?.startsWith(`${currentRow.entry.path}/`)) {
          moveFocus(visiblePaths[currentIndex + 1] ?? currentRow.entry.path, false);
        }
        return;
      }
      case "ArrowLeft": {
        handled();
        if (!currentRow) return;
        if (currentRow.isExpanded) explorer.setExpanded(currentRow.entry.path, false);
        else if (currentRow.depth > 0) moveFocus(readParentPath(currentRow.entry.path), false);
        return;
      }
      case "Enter": {
        handled();
        if (!currentRow) return;
        if (currentRow.entry.type === "directory") explorer.setExpanded(currentRow.entry.path, !currentRow.isExpanded);
        explorer.selectPath(currentRow.entry.path);
        return;
      }
      case "F2": {
        handled();
        if (currentRow && canWrite) explorer.startRename(currentRow.entry.path);
        return;
      }
      case "Delete":
      case "Backspace": {
        if (keyboardEvent.key === "Backspace" && !keyboardEvent.metaKey) return;
        handled();
        if (currentRow && canWrite)
          explorer.openDialog({ kind: "delete", paths: explorer.readActionPaths(currentRow.entry.path) });
        return;
      }
      case "Escape": {
        explorer.selectPath(selectedPath);
        return;
      }
      default: {
        break;
      }
    }
    if (isModified && ["c", "x", "v", "a"].includes(keyboardEvent.key.toLowerCase())) {
      handled();
      const lowerKey = keyboardEvent.key.toLowerCase();
      if (lowerKey === "a") {
        explorer.selectMany(visiblePaths);
        return;
      }
      if (lowerKey === "v") {
        if (canWrite) void explorer.pasteInto(explorer.readTargetFolder(activePath));
        return;
      }
      if (!currentRow) return;
      if (lowerKey === "x" && !canWrite) return;
      explorer.copyToClipboard(lowerKey === "c" ? "copy" : "cut", explorer.readActionPaths(currentRow.entry.path));
      return;
    }
    if (keyboardEvent.key.length === 1 && !isModified && !keyboardEvent.altKey && keyboardEvent.key !== " ") {
      handled();
      handleTypeAhead(keyboardEvent.key, keyboardEvent.timeStamp);
    }
  };

  const readDropFolder = (entry: FileEntry | undefined) =>
    entry === undefined ? rootPath : entry.type === "directory" ? entry.path : readParentPath(entry.path);

  const handleDragStart = (entry: FileEntry, dragEvent: DragEvent<HTMLDivElement>) => {
    if (explorer.readBusyReason(entry.path) !== undefined) {
      dragEvent.preventDefault();
      return;
    }
    const paths = explorer.readActionPaths(entry.path);
    dragEvent.dataTransfer.setData(
      ENTRY_DRAG_TYPE,
      JSON.stringify({ storageId: storage.id, paths } satisfies DraggedEntries),
    );
    dragEvent.dataTransfer.setData("text/plain", paths.join("\n"));
    dragEvent.dataTransfer.effectAllowed = "copyMove";
  };

  const handleDragOver = (entry: FileEntry | undefined, dragEvent: DragEvent<HTMLDivElement>) => {
    const { types } = dragEvent.dataTransfer;
    const isEntries = types.includes(ENTRY_DRAG_TYPE);
    if (!isEntries && !types.includes("Files")) return;
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    if (!canWrite) {
      dragEvent.dataTransfer.dropEffect = "none";
      return;
    }
    const folderPath = readDropFolder(entry);
    if (explorer.readBusyReason(folderPath) !== undefined) {
      dragEvent.dataTransfer.dropEffect = "none";
      return;
    }
    dragEvent.dataTransfer.dropEffect = isEntries && !dragEvent.altKey ? "move" : "copy";
    if (dropTargetPath !== folderPath) setDropTargetPath(folderPath);
  };

  const handleDrop = (entry: FileEntry | undefined, dragEvent: DragEvent<HTMLDivElement>) => {
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    setDropTargetPath(undefined);
    if (!canWrite) return;
    const folderPath = readDropFolder(entry);
    const busyReason = explorer.readBusyReason(folderPath);
    if (busyReason !== undefined) {
      showToastNotification({ title: busyReason, tone: "warning" });
      return;
    }
    const destination = { storageId: storage.id, path: folderPath };
    const draggedEntries = readDraggedEntries(dragEvent.dataTransfer);
    if (draggedEntries) {
      const sources = draggedEntries.paths.map((path) => ({ storageId: draggedEntries.storageId, path }));
      if (draggedEntries.storageId !== storage.id) {
        setPendingCrossCopy({ sources, destination });
        return;
      }
      if (sources.some((source) => folderPath === source.path || folderPath.startsWith(`${source.path}/`))) {
        showToastNotification({ title: "A folder can't be moved into itself.", tone: "warning" });
        return;
      }
      void explorer.transfer(dragEvent.altKey ? "copy" : "move", sources, destination);
      if (folderPath !== rootPath) explorer.setExpanded(folderPath, true);
      return;
    }
    explorer.uploadDropped(captureDroppedEntries(dragEvent.dataTransfer), folderPath);
  };

  const firstVisibleIndex = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastVisibleIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / TREE_ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const activeRowId = activePath ? `tree-row-${encodeURIComponent(activePath)}` : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        role="tree"
        aria-label={`Files in ${memoryRoot?.memory.name ?? storage.label}`}
        aria-multiselectable="true"
        aria-activedescendant={activeRowId && visiblePaths.includes(activePath) ? activeRowId : undefined}
        tabIndex={0}
        data-testid="file-tree"
        onKeyDown={handleKeyDown}
        onScroll={(scrollEvent) => setScrollTop(scrollEvent.currentTarget.scrollTop)}
        onContextMenu={(mouseEvent) => {
          mouseEvent.preventDefault();
          explorer.openContextMenu({ x: mouseEvent.clientX, y: mouseEvent.clientY });
        }}
        onDragOver={(dragEvent) => handleDragOver(undefined, dragEvent)}
        onDragLeave={(dragEvent) => {
          if (!dragEvent.currentTarget.contains(dragEvent.relatedTarget as Node | null)) setDropTargetPath(undefined);
        }}
        onDrop={(dragEvent) => handleDrop(undefined, dragEvent)}
        className={mergeClassNames(
          "relative min-h-0 flex-1 overflow-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-brand/50",
          dropTargetPath === rootPath && "bg-brand/10",
        )}
      >
        {rootError ? (
          <p className="px-3 py-4 text-sm text-danger">{rootError.message}</p>
        ) : (
          <div style={{ height: rows.length * TREE_ROW_HEIGHT, position: "relative" }}>
            <div style={{ transform: `translateY(${firstVisibleIndex * TREE_ROW_HEIGHT}px)` }}>
              {rows.slice(firstVisibleIndex, lastVisibleIndex).map((row) => {
                if (row.kind === "loading") {
                  return (
                    <div
                      key={row.key}
                      style={{ height: TREE_ROW_HEIGHT, paddingLeft: 26 + row.depth * TREE_INDENT }}
                      className="flex items-center text-xs text-foreground-subtle"
                    >
                      Loading…
                    </div>
                  );
                }
                if (row.kind === "more") {
                  return (
                    <div
                      key={row.key}
                      style={{ height: TREE_ROW_HEIGHT, paddingLeft: 26 + row.depth * TREE_INDENT }}
                      className="flex items-center"
                    >
                      <button
                        type="button"
                        className="cursor-pointer text-xs text-brand hover:underline"
                        onClick={() => void loadMoreEntries(queryClient, storage.id, row.directoryPath)}
                      >
                        Load more
                      </button>
                    </div>
                  );
                }
                if (row.kind === "draft") {
                  return (
                    <div
                      key={row.key}
                      style={{ height: TREE_ROW_HEIGHT, paddingLeft: 6 + row.depth * TREE_INDENT }}
                      className="flex items-center gap-1.5 pr-2"
                    >
                      <span className="w-4 flex-none" />
                      <FileIcon
                        entry={{
                          name: row.type === "file" ? "new" : "folder",
                          type: row.type,
                          badges: { isMemory: false, protection: "none", encrypted: false, versioned: false },
                        }}
                      />
                      <InlineNameInput
                        initialName=""
                        label={row.type === "file" ? "New file name" : "New folder name"}
                        onCommit={(name) => void explorer.commitDraft(name)}
                        onCancel={explorer.stopDraft}
                      />
                    </div>
                  );
                }
                const { entry } = row;
                return (
                  <FileTreeNode
                    key={row.key}
                    entry={entry}
                    depth={row.depth}
                    rowId={`tree-row-${encodeURIComponent(entry.path)}`}
                    isExpanded={row.isExpanded}
                    isSelected={selection.has(entry.path)}
                    isFocused={activePath === entry.path}
                    isDropTarget={dropTargetPath !== undefined && dropTargetPath === entry.path}
                    isRenaming={renamingPath === entry.path}
                    isCut={cutPaths.has(entry.path)}
                    isBusy={explorer.readBusyReason(entry.path) !== undefined}
                    onClick={(mouseEvent) => handleRowClick(entry, mouseEvent)}
                    onToggle={() => explorer.setExpanded(entry.path, !row.isExpanded)}
                    onContextMenu={(mouseEvent) => {
                      mouseEvent.preventDefault();
                      mouseEvent.stopPropagation();
                      setFocusedPath(entry.path);
                      if (!selection.has(entry.path)) explorer.selectPath(entry.path);
                      explorer.openContextMenu({ x: mouseEvent.clientX, y: mouseEvent.clientY, entry });
                    }}
                    onDragStart={(dragEvent) => handleDragStart(entry, dragEvent)}
                    onDragOver={(dragEvent) => handleDragOver(entry, dragEvent)}
                    onDrop={(dragEvent) => handleDrop(entry, dragEvent)}
                    onRenameCommit={(newName) => void explorer.commitRename(entry.path, newName)}
                    onRenameCancel={explorer.stopRename}
                  />
                );
              })}
            </div>
          </div>
        )}
        {listingQueries[0]?.data?.entries.length === 0 && !draft && (
          <p className="px-4 py-3 text-sm text-foreground-subtle">
            {memoryRoot ? "This memory is empty." : "This storage is empty."}
          </p>
        )}
      </div>
      <ConfirmDialog
        isOpen={pendingCrossCopy !== undefined}
        onOpenChange={(isOpen) => !isOpen && setPendingCrossCopy(undefined)}
        title="Copy to another storage?"
        confirmLabel="Copy"
        onConfirm={async () => {
          if (pendingCrossCopy) await explorer.transfer("copy", pendingCrossCopy.sources, pendingCrossCopy.destination);
        }}
      >
        Items dragged from another storage are copied, never moved. The originals stay where they are.
      </ConfirmDialog>
    </div>
  );
}
