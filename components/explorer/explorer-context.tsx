"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { showToastNotification } from "@/components/interactive/toast-notification";
import type { DownloadMeasurement, FileEntry, FileStat, StorageSummary } from "@/lib/api-types";
import type { UserRole } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";
import { readFileClipboard, setFileClipboard } from "@/lib/client/clipboard";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import {
  downloadEntry,
  downloadSelection,
  measureDownload,
  readCachedEntries,
  useFileMutations,
  type StoragePath,
  type TransferResult,
} from "@/lib/client/fs";
import { readBusyReason, useBusyFolders } from "@/lib/client/jobs";
import { isInsideFolder, joinEntryPath, QUERY_KEYS, readBaseName, readParentPath } from "@/lib/client/query-keys";
import { buildMemoryHref, buildStorageHref, parseChangesParameter, type HistoryFocus } from "@/lib/client/routes";
import { protectionReason } from "@/lib/client/protection";
import { confirmLeave } from "@/lib/client/unsaved-changes";
import { readDroppedTree, readPickedFolder, startFolderUpload, type FolderTree } from "@/lib/client/folder-upload";
import { getUploadQueue } from "@/lib/client/upload-queue";
import { readExtension } from "@/lib/file-kinds";
import type { MemorySummary } from "@/lib/memory";

export type ApplicationMode = "desktop" | "server";

export type ExplorerDialog =
  | { kind: "delete"; paths: string[] }
  | { kind: "new-item"; type: "file" | "directory"; parentPath: string }
  | { kind: "rename"; path: string }
  | { kind: "move"; paths: string[] }
  | { kind: "properties"; path: string }
  | { kind: "new-memory"; parentPath: string }
  | { kind: "convert-memory"; path: string }
  | { kind: "folder-settings"; path: string; tab?: FolderSettingsTab }
  | { kind: "encrypt-folder"; path: string }
  | { kind: "enable-versioning"; path: string }
  | { kind: "download-encrypted"; path: string; isUnlocked: boolean }
  | { kind: "confirm-zip"; paths: string[]; measurement: DownloadMeasurement }
  | {
      kind: "confirm-decrypt";
      transfer: { kind: "move" | "copy"; sources: StoragePath[]; destination: StoragePath };
      message: string;
    };

export type FolderSettingsTab = "general" | "protection" | "encryption" | "versioning";

export interface ContextMenuState {
  x: number;
  y: number;
  /** The entry right-clicked, or undefined for the empty area (the explorer's root folder). */
  entry?: FileEntry;
}

/** The memory a memory's own explorer is rooted at. */
export interface MemoryRoot {
  /** The memory folder, relative to the storage root. */
  path: string;
  memory: MemorySummary;
}

export interface DraftItem {
  parentPath: string;
  type: "file" | "directory";
}

export interface ExplorerContextValue {
  storage: StorageSummary;
  /**
   * The folder the tree starts at: "" for the whole storage, or the memory folder in a memory's
   * own explorer. Paths stay storage-relative either way.
   */
  rootPath: string;
  /** Set in a memory's own explorer. */
  memoryRoot?: MemoryRoot;
  mode: ApplicationMode;
  /** The signed-in user's role (only admins can unlock locked items). */
  userRole: UserRole;
  canWrite: boolean;
  readOnlyReason?: string;
  selectedPath: string;
  selection: ReadonlySet<string>;
  expandedPaths: ReadonlySet<string>;
  renamingPath?: string;
  draft?: DraftItem;
  dialog?: ExplorerDialog;
  contextMenu?: ContextMenuState;
  /** The entry whose history the file pane shows instead of its content. */
  historyPath?: string;
  /** The step the history opened on: a commit, or the trash copy a replace kept. */
  historyFocus?: HistoryFocus;
  /** Selects `entryPath` and shows its history (a file's own, or a folder's), optionally on one step. */
  openHistory: (entryPath: string, focus?: HistoryFocus) => void;
  closeHistory: () => void;
  /**
   * Selects one entry (and puts it in the URL, expanding its folders), or extends the selection
   * with Ctrl/Cmd or Shift. Opening another entry while the editor has unsaved changes asks Save,
   * Discard or Cancel first.
   */
  selectPath: (entryPath: string, extend?: "toggle" | "range", visiblePaths?: readonly string[]) => void;
  /** Selects several entries without changing the URL (Ctrl/Cmd+A). */
  selectMany: (paths: readonly string[]) => void;
  setExpanded: (entryPath: string, isExpanded: boolean) => void;
  collapseAll: () => void;
  startRename: (entryPath: string) => void;
  stopRename: () => void;
  commitRename: (entryPath: string, newName: string) => Promise<boolean>;
  startDraft: (type: "file" | "directory", parentPath?: string) => void;
  stopDraft: () => void;
  commitDraft: (name: string) => Promise<boolean>;
  openDialog: (dialog: ExplorerDialog | undefined) => void;
  openContextMenu: (contextMenu: ContextMenuState | undefined) => void;
  /** The folder new items, uploads and pastes go to: the selected folder, or the selected file's folder. */
  readTargetFolder: (entryPath?: string) => string;
  /**
   * Why nothing can be changed in or at `entryPath` (storage access, a running move that keeps
   * the folder busy, or protection from the cached listing), or undefined when it can. "" is the
   * storage root.
   */
  readWriteReason: (entryPath: string) => string | undefined;
  /** The folders a running move keeps busy (its source and destination folders), storage-relative. */
  busyFolders: ReadonlySet<string>;
  /** Why `entryPath` can't be opened right now: it is in a folder a running move keeps busy. */
  readBusyReason: (entryPath: string) => string | undefined;
  findEntry: (entryPath: string) => FileEntry | undefined;
  /** The selection when it contains `entryPath`, otherwise just `entryPath`. */
  readActionPaths: (entryPath: string) => string[];
  deletePaths: (paths: readonly string[]) => Promise<void>;
  /**
   * Moves or copies entries. Leaving an encrypted folder asks first (the copy is decrypted), then
   * runs again with `confirmDecrypt`.
   */
  transfer: (
    kind: "move" | "copy",
    sources: readonly StoragePath[],
    destinationFolder: StoragePath,
    options?: { confirmDecrypt?: boolean },
  ) => Promise<TransferResult | undefined>;
  copyToClipboard: (mode: "copy" | "cut", paths: readonly string[]) => void;
  pasteInto: (folderPath: string) => Promise<void>;
  uploadFiles: (files: readonly File[], folderPath: string) => void;
  /** Opens the computer's file picker and uploads the chosen files into `folderPath`. */
  openUploadPicker: (folderPath: string) => void;
  /** Opens the computer's folder picker and uploads the chosen folder, with everything in it, into `folderPath`. */
  openFolderUploadPicker: (folderPath: string) => void;
  /**
   * Uploads what was dropped from the computer into `folderPath`: files as they are, folders with
   * everything in them (one confirmation for the whole folder, OS clutter and `.git` left out).
   */
  uploadDropped: (dropped: readonly (FileSystemEntry | File)[], folderPath: string) => void;
  /**
   * "Replace with file from computer…": opens the file picker, then uploads the chosen file over
   * `entryPath`, keeping its name. It is refused if the file changes in between.
   */
  replaceFile: (entryPath: string) => void;
  /**
   * Downloads an entry; an encrypted file first asks "Decrypted" or "Encrypted (raw)". A folder
   * comes as a zip, after a confirmation when it holds encrypted files (they are decrypted).
   */
  download: (entryPath: string, options?: { asStored?: boolean }) => Promise<void>;
  /**
   * Downloads several entries as one zip (one entry: as `download`). Asks first when the zip would
   * hold encrypted files decrypted; `isConfirmed` skips that question once it was answered.
   */
  downloadMany: (paths: readonly string[], options?: { isConfirmed?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
}

const ExplorerContext = createContext<ExplorerContextValue | null>(null);

/**
 * Explorer state and actions for components inside `ExplorerProvider`.
 *
 * @example
 * const { selectedPath, selectPath } = useExplorer();
 */
export function useExplorer(): ExplorerContextValue {
  const contextValue = useContext(ExplorerContext);
  if (!contextValue) throw new Error("useExplorer must be used inside <ExplorerProvider>.");
  return contextValue;
}

/**
 * A success toast for explorer actions.
 *
 * @example
 * announce("Moved 2 items to Trash", "You can restore them from Trash.");
 */
export function announce(title: string, description?: string): void {
  showToastNotification({ title, description, tone: "success" });
}

/**
 * An error toast for explorer actions. A cancelled step-up stays quiet: the user chose it.
 *
 * @example
 * announceError("Couldn't rename", renameError);
 */
export function announceError(title: string, requestError: unknown): void {
  if (requestError instanceof ApiError && requestError.code === "STEP_UP_REQUIRED") return;
  showToastNotification({
    title,
    description: requestError instanceof Error ? requestError.message : "Something went wrong.",
    tone: "error",
  });
}

/** The folders between `rootPath` (left out) and `entryPath` (left out), which the tree expands to show it. */
function readAncestorPaths(entryPath: string, rootPath: string): string[] {
  const segments = entryPath.split("/").filter(Boolean);
  return segments
    .slice(0, -1)
    .map((_segment, segmentIndex) => segments.slice(0, segmentIndex + 1).join("/"))
    .filter((ancestorPath) => ancestorPath !== rootPath && isInsideFolder(ancestorPath, rootPath));
}

function describeTransfer(kind: "move" | "copy", result: TransferResult): string {
  const verb = kind === "move" ? "Moved" : "Copied";
  if (result.job) return `${result.job.title} started`;
  return `${verb} ${result.paths.length} item${result.paths.length === 1 ? "" : "s"}`;
}

/**
 * Holds what the explorer shows and does for one storage: selection (mirrored in the URL),
 * expanded folders, inline rename and new-item drafts, the open dialog and context menu, and the
 * file actions behind the toolbar, keyboard, drag and drop and the context menu. With
 * `memoryRoot`, it is that memory's own explorer: the tree starts at the memory folder, and
 * selecting something outside it (after a rename or delete of the memory itself) goes back to the
 * storage's explorer.
 *
 * @example
 * <ExplorerProvider storage={storage} mode="server" initialPath="notes/today.md">…</ExplorerProvider>
 */
export function ExplorerProvider({
  storage,
  memoryRoot,
  mode,
  userRole,
  initialPath,
  initialChanges,
  children,
}: {
  storage: StorageSummary;
  memoryRoot?: MemoryRoot;
  mode: ApplicationMode;
  userRole: UserRole;
  initialPath: string;
  /** The page's `?changes=` value: open the entry's history, on this step. */
  initialChanges?: string;
  children: ReactNode;
}) {
  const rootPath = memoryRoot?.path ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();
  const mutations = useFileMutations();
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [syncedInitialPath, setSyncedInitialPath] = useState(initialPath);
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set(initialPath ? [initialPath] : []));
  const [anchorPath, setAnchorPath] = useState(initialPath);
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(
    () => new Set(readAncestorPaths(initialPath, rootPath)),
  );
  const [renamingPath, setRenamingPath] = useState<string>();
  const [draft, setDraft] = useState<DraftItem>();
  const [dialog, setDialog] = useState<ExplorerDialog>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [historyPath, setHistoryPath] = useState(() =>
    parseChangesParameter(initialChanges) ? initialPath : undefined,
  );
  const [historyFocus, setHistoryFocus] = useState(() => parseChangesParameter(initialChanges));
  const [syncedChanges, setSyncedChanges] = useState(`${initialPath}\u0000${initialChanges ?? ""}`);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<{ path: string; etag: Promise<string | undefined> }>(undefined);
  const [pendingReplace, setPendingReplace] = useState<{ file: File; path: string; expectedEtag?: string }>();

  // A link to "What changed" on the page already open (`?changes=` changed) opens that history.
  const changesKey = `${initialPath}\u0000${initialChanges ?? ""}`;
  if (changesKey !== syncedChanges) {
    setSyncedChanges(changesKey);
    const focus = parseChangesParameter(initialChanges);
    setHistoryPath(focus ? initialPath : undefined);
    setHistoryFocus(focus);
  }

  if (initialPath !== syncedInitialPath) {
    setSyncedInitialPath(initialPath);
    setSelectedPath(initialPath);
    setSelection(new Set(initialPath ? [initialPath] : []));
    setAnchorPath(initialPath);
    setExpandedPaths((previousPaths) => new Set([...previousPaths, ...readAncestorPaths(initialPath, rootPath)]));
  }

  const canWrite = storage.access === "write";
  const readOnlyReason = canWrite ? undefined : (storage.readOnlyReason ?? "You can only view files in this storage.");
  const busyFolders = useBusyFolders(storage.id);
  const readEntryBusyReason = useCallback((entryPath: string) => readBusyReason(busyFolders, entryPath), [busyFolders]);

  // A memory's own folder isn't in a loaded listing there (its parent isn't shown), so its stat stands in.
  const findEntry = useCallback(
    (entryPath: string) =>
      readCachedEntries(queryClient, storage.id, readParentPath(entryPath))?.find(
        (entry) => entry.path === entryPath,
      ) ?? queryClient.getQueryData<FileStat>(QUERY_KEYS.stat(storage.id, entryPath))?.entry,
    [queryClient, storage.id],
  );

  const showInUrl = useCallback(
    (entryPath: string) => {
      const href = memoryRoot
        ? buildMemoryHref(storage.id, memoryRoot.path, entryPath)
        : buildStorageHref(storage.id, entryPath);
      if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
    },
    [memoryRoot, storage.id],
  );

  const selectPath = useCallback(
    (entryPath: string, extend?: "toggle" | "range", visiblePaths: readonly string[] = []) => {
      if (extend === "toggle") {
        setSelection((previousSelection) => {
          const nextSelection = new Set(previousSelection);
          if (nextSelection.has(entryPath)) nextSelection.delete(entryPath);
          else nextSelection.add(entryPath);
          return nextSelection;
        });
        setAnchorPath(entryPath);
        return;
      }
      if (extend === "range") {
        const anchorIndex = visiblePaths.indexOf(anchorPath);
        const targetIndex = visiblePaths.indexOf(entryPath);
        if (anchorIndex !== -1 && targetIndex !== -1) {
          const [startIndex, endIndex] =
            anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
          setSelection(new Set(visiblePaths.slice(startIndex, endIndex + 1)));
          return;
        }
      }
      if (!isInsideFolder(entryPath, rootPath)) {
        confirmLeave(() => router.push(buildStorageHref(storage.id, entryPath)));
        return;
      }
      // A folder a move is working in stays as it was until the move ends: nothing in it opens.
      if (entryPath !== selectedPath && readEntryBusyReason(entryPath) !== undefined) return;
      const applySelection = () => {
        setSelection(new Set(entryPath ? [entryPath] : []));
        setAnchorPath(entryPath);
        setSelectedPath(entryPath);
        setExpandedPaths((previousPaths) => {
          const ancestorPaths = readAncestorPaths(entryPath, rootPath);
          return ancestorPaths.every((ancestorPath) => previousPaths.has(ancestorPath))
            ? previousPaths
            : new Set([...previousPaths, ...ancestorPaths]);
        });
        showInUrl(entryPath);
      };
      if (entryPath === selectedPath) applySelection();
      else confirmLeave(applySelection);
    },
    [anchorPath, readEntryBusyReason, rootPath, router, selectedPath, showInUrl, storage.id],
  );

  const setExpanded = useCallback((entryPath: string, isExpanded: boolean) => {
    setExpandedPaths((previousPaths) => {
      const nextPaths = new Set(previousPaths);
      if (isExpanded) nextPaths.add(entryPath);
      else
        for (const expandedPath of previousPaths)
          if (expandedPath === entryPath || expandedPath.startsWith(`${entryPath}/`)) nextPaths.delete(expandedPath);
      return nextPaths;
    });
  }, []);

  const readTargetFolder = useCallback(
    (entryPath = selectedPath) => {
      if (entryPath === rootPath) return rootPath;
      const entry = findEntry(entryPath);
      return entry?.type === "directory" ? entryPath : readParentPath(entryPath);
    },
    [findEntry, rootPath, selectedPath],
  );

  const readWriteReason = useCallback(
    (entryPath: string) =>
      readOnlyReason ??
      readEntryBusyReason(entryPath) ??
      (entryPath === "" ? undefined : protectionReason(findEntry(entryPath))),
    [findEntry, readEntryBusyReason, readOnlyReason],
  );

  const readActionPaths = useCallback(
    (entryPath: string) => (selection.has(entryPath) ? [...selection] : [entryPath]),
    [selection],
  );

  const commitRename = useCallback(
    async (entryPath: string, newName: string) => {
      setRenamingPath(undefined);
      if (newName === readBaseName(entryPath)) return true;
      try {
        await mutations.renameEntry.mutateAsync({ storageId: storage.id, path: entryPath, newName });
        const renamedPath = joinEntryPath(readParentPath(entryPath), newName);
        if (memoryRoot && entryPath === memoryRoot.path) router.replace(buildMemoryHref(storage.id, renamedPath));
        else if (selectedPath === entryPath) selectPath(renamedPath);
        return true;
      } catch (renameError) {
        announceError("Couldn't rename", renameError);
        return false;
      }
    },
    [memoryRoot, mutations.renameEntry, router, selectPath, selectedPath, storage.id],
  );

  const startDraft = useCallback(
    (type: "file" | "directory", parentPath?: string) => {
      const folderPath = parentPath ?? readTargetFolder();
      if (folderPath !== rootPath) setExpanded(folderPath, true);
      setDraft({ parentPath: folderPath, type });
    },
    [readTargetFolder, rootPath, setExpanded],
  );

  const commitDraft = useCallback(
    async (name: string) => {
      if (!draft) return false;
      const entryPath = joinEntryPath(draft.parentPath, name);
      setDraft(undefined);
      try {
        if (draft.type === "file") await mutations.createFile.mutateAsync({ storageId: storage.id, path: entryPath });
        else await mutations.createFolder.mutateAsync({ storageId: storage.id, path: entryPath });
        selectPath(entryPath);
        return true;
      } catch (createError) {
        announceError(draft.type === "file" ? "Couldn't create the file" : "Couldn't create the folder", createError);
        return false;
      }
    },
    [draft, mutations.createFile, mutations.createFolder, selectPath, storage.id],
  );

  const deletePaths = useCallback(
    async (paths: readonly string[]) => {
      await mutations.removeEntries.mutateAsync({ storageId: storage.id, paths: [...paths] });
      setSelection(new Set());
      if (paths.some((deletedPath) => selectedPath === deletedPath || selectedPath.startsWith(`${deletedPath}/`))) {
        selectPath(readParentPath(paths[0] ?? ""));
      }
      announce(
        `Moved ${paths.length} item${paths.length === 1 ? "" : "s"} to Trash`,
        "You can restore them from Trash.",
      );
    },
    [mutations.removeEntries, selectPath, selectedPath, storage.id],
  );

  const transfer = useCallback(
    async (
      kind: "move" | "copy",
      sources: readonly StoragePath[],
      destinationFolder: StoragePath,
      { confirmDecrypt }: { confirmDecrypt?: boolean } = {},
    ) => {
      const isSameFolder = sources.every(
        (source) =>
          source.storageId === destinationFolder.storageId && readParentPath(source.path) === destinationFolder.path,
      );
      if (kind === "move" && isSameFolder) return undefined;
      try {
        const variables = {
          sources: [...sources],
          destination: destinationFolder,
          conflict: "keep-both" as const,
          confirmDecrypt,
        };
        const result =
          kind === "move"
            ? await mutations.moveEntries.mutateAsync(variables)
            : await mutations.copyEntries.mutateAsync(variables);
        announce(describeTransfer(kind, result));
        return result;
      } catch (transferError) {
        if (transferError instanceof ApiError && transferError.code === "DECRYPT_CONFIRM_REQUIRED") {
          setDialog({
            kind: "confirm-decrypt",
            transfer: { kind, sources: [...sources], destination: destinationFolder },
            message: transferError.message,
          });
          return undefined;
        }
        announceError(kind === "move" ? "Couldn't move" : "Couldn't copy", transferError);
        return undefined;
      }
    },
    [mutations.copyEntries, mutations.moveEntries],
  );

  const copyToClipboard = useCallback(
    (clipboardMode: "copy" | "cut", paths: readonly string[]) => {
      setFileClipboard({ mode: clipboardMode, items: paths.map((path) => ({ storageId: storage.id, path })) });
      announce(
        `${clipboardMode === "copy" ? "Copied" : "Cut"} ${paths.length} item${paths.length === 1 ? "" : "s"}`,
        "Paste them into a folder.",
      );
    },
    [storage.id],
  );

  const pasteInto = useCallback(
    async (folderPath: string) => {
      const clipboard = readFileClipboard();
      if (!clipboard) return;
      const result = await transfer(clipboard.mode === "cut" ? "move" : "copy", clipboard.items, {
        storageId: storage.id,
        path: folderPath,
      });
      if (result && clipboard.mode === "cut") setFileClipboard(undefined);
    },
    [storage.id, transfer],
  );

  const uploadFiles = useCallback(
    (files: readonly File[], folderPath: string) => {
      if (files.length === 0) return;
      getUploadQueue().add(files, storage.id, folderPath);
    },
    [storage.id],
  );

  const openUploadPicker = useCallback((folderPath: string) => {
    uploadFolderRef.current = folderPath;
    uploadInputRef.current?.click();
  }, []);

  const openFolderUploadPicker = useCallback((folderPath: string) => {
    uploadFolderRef.current = folderPath;
    folderInputRef.current?.click();
  }, []);

  // React has no prop for the folder picker attribute.
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const uploadTree = useCallback(
    async (tree: FolderTree, folderPath: string) => {
      try {
        const result = await startFolderUpload(tree, storage.id, folderPath);
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(storage.id, folderPath) });
        if (result && result.skippedCount > 0) {
          showToastNotification({
            title: `${result.skippedCount} item${result.skippedCount === 1 ? " was" : "s were"} left out`,
            tone: "info",
            description: "System files (.DS_Store, Thumbs.db, desktop.ini) and .git folders aren't uploaded.",
          });
        }
      } catch (uploadError) {
        announceError("Couldn't upload the folder", uploadError);
      }
    },
    [queryClient, storage.id],
  );

  const uploadDropped = useCallback(
    (dropped: readonly (FileSystemEntry | File)[], folderPath: string) => {
      void readDroppedTree(dropped).then(
        (tree) => {
          if (tree.directories.length === 0)
            uploadFiles(
              tree.files.map(({ file }) => file),
              folderPath,
            );
          else void uploadTree(tree, folderPath);
        },
        (readError: unknown) => announceError("Couldn't read what was dropped", readError),
      );
    },
    [uploadFiles, uploadTree],
  );

  const queueReplacement = useCallback(
    (file: File, entryPath: string, expectedEtag: string | undefined) => {
      getUploadQueue().addReplacement(
        file,
        storage.id,
        readParentPath(entryPath),
        readBaseName(entryPath),
        expectedEtag,
      );
    },
    [storage.id],
  );

  const replaceFile = useCallback(
    (entryPath: string) => {
      // The version the user is looking at now: the replace is refused if the file changes meanwhile.
      const query = new URLSearchParams({ storageId: storage.id, path: entryPath });
      const etag = requestJson<FileStat>(`/api/fs/stat?${query}`).then(
        (fileStat) => fileStat.etag,
        () => undefined,
      );
      replaceTargetRef.current = { path: entryPath, etag };
      replaceInputRef.current?.click();
    },
    [storage.id],
  );

  const handleReplacementChosen = useCallback(
    async (file: File | undefined) => {
      const target = replaceTargetRef.current;
      replaceTargetRef.current = undefined;
      if (!file || !target) return;
      const expectedEtag = await target.etag;
      if (readExtension(file.name) !== readExtension(readBaseName(target.path))) {
        setPendingReplace({ file, path: target.path, expectedEtag });
        return;
      }
      queueReplacement(file, target.path, expectedEtag);
    },
    [queueReplacement],
  );

  /** One file: an encrypted one first asks "Decrypted" or "Encrypted (raw)". */
  const downloadFile = useCallback(
    async (entryPath: string, entry: FileEntry | undefined, options?: { asStored?: boolean }) => {
      const encryption = entry?.type === "file" ? entry.badges.encryption : undefined;
      if (options === undefined && encryption && !encryption.plaintext) {
        setDialog({ kind: "download-encrypted", path: entryPath, isUnlocked: encryption.unlocked });
        return;
      }
      try {
        await downloadEntry(storage.id, entryPath, options);
      } catch (downloadError) {
        announceError("Couldn't download", downloadError);
      }
    },
    [storage.id],
  );

  const readKnownEntry = useCallback(
    (entryPath: string) =>
      findEntry(entryPath) ?? queryClient.getQueryData<FileStat>(QUERY_KEYS.stat(storage.id, entryPath))?.entry,
    [findEntry, queryClient, storage.id],
  );

  const downloadMany = useCallback(
    async (paths: readonly string[], options?: { isConfirmed?: boolean }) => {
      const firstPath = paths[0];
      if (firstPath === undefined) return;
      const firstEntry = readKnownEntry(firstPath);
      if (paths.length === 1 && firstEntry?.type === "file") {
        await downloadFile(firstPath, firstEntry);
        return;
      }
      try {
        const measurement = await measureDownload(storage.id, paths);
        if (!options?.isConfirmed && measurement.encryptedFileCount > 0) {
          setDialog({ kind: "confirm-zip", paths: [...paths], measurement });
          return;
        }
        const started =
          paths.length === 1 ? await downloadEntry(storage.id, firstPath) : await downloadSelection(storage.id, paths);
        if (started) {
          showToastNotification({
            title: "Preparing the zip",
            tone: "info",
            description: `${measurement.fileCount.toLocaleString()} file${measurement.fileCount === 1 ? "" : "s"}, ${formatFileSize(measurement.totalBytes)}. Your browser shows its progress.`,
          });
        }
      } catch (downloadError) {
        announceError("Couldn't download", downloadError);
      }
    },
    [downloadFile, readKnownEntry, storage.id],
  );

  const download = useCallback(
    async (entryPath: string, options?: { asStored?: boolean }) => {
      const entry = readKnownEntry(entryPath);
      if (entry?.type === "file" || options !== undefined) await downloadFile(entryPath, entry, options);
      else await downloadMany([entryPath]);
    },
    [downloadFile, downloadMany, readKnownEntry],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storageDirectories(storage.id) });
  }, [queryClient, storage.id]);

  const contextValue = useMemo<ExplorerContextValue>(
    () => ({
      storage,
      rootPath,
      memoryRoot,
      mode,
      userRole,
      canWrite,
      readOnlyReason,
      selectedPath,
      selection,
      expandedPaths,
      renamingPath,
      draft,
      dialog,
      contextMenu,
      historyPath,
      historyFocus,
      openHistory: (entryPath, focus) => {
        selectPath(entryPath);
        setHistoryPath(entryPath);
        setHistoryFocus(focus);
      },
      closeHistory: () => {
        setHistoryPath(undefined);
        setHistoryFocus(undefined);
      },
      selectPath,
      selectMany: (paths) => setSelection(new Set(paths)),
      setExpanded,
      collapseAll: () => setExpandedPaths(new Set()),
      startRename: (entryPath) => setRenamingPath(entryPath),
      stopRename: () => setRenamingPath(undefined),
      commitRename,
      startDraft,
      stopDraft: () => setDraft(undefined),
      commitDraft,
      openDialog: setDialog,
      openContextMenu: setContextMenu,
      readTargetFolder,
      readWriteReason,
      busyFolders,
      readBusyReason: readEntryBusyReason,
      findEntry,
      readActionPaths,
      deletePaths,
      transfer,
      copyToClipboard,
      pasteInto,
      uploadFiles,
      openUploadPicker,
      openFolderUploadPicker,
      uploadDropped,
      replaceFile,
      download,
      downloadMany,
      refresh,
    }),
    [
      storage,
      rootPath,
      memoryRoot,
      mode,
      userRole,
      canWrite,
      readOnlyReason,
      selectedPath,
      selection,
      expandedPaths,
      renamingPath,
      draft,
      dialog,
      contextMenu,
      historyPath,
      historyFocus,
      selectPath,
      setExpanded,
      commitRename,
      startDraft,
      commitDraft,
      readTargetFolder,
      readWriteReason,
      busyFolders,
      readEntryBusyReason,
      findEntry,
      readActionPaths,
      deletePaths,
      transfer,
      copyToClipboard,
      pasteInto,
      uploadFiles,
      openUploadPicker,
      openFolderUploadPicker,
      uploadDropped,
      replaceFile,
      download,
      downloadMany,
      refresh,
    ],
  );
  return (
    <ExplorerContext.Provider value={contextValue}>
      {children}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        data-testid="upload-input"
        onChange={(changeEvent) => {
          uploadFiles([...(changeEvent.target.files ?? [])], uploadFolderRef.current);
          changeEvent.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        data-testid="upload-folder-input"
        onChange={(changeEvent) => {
          const files = [...(changeEvent.target.files ?? [])];
          changeEvent.target.value = "";
          if (files.length > 0) void uploadTree(readPickedFolder(files), uploadFolderRef.current);
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        hidden
        data-testid="replace-input"
        onChange={(changeEvent) => {
          void handleReplacementChosen(changeEvent.target.files?.[0]);
          changeEvent.target.value = "";
        }}
      />
      {pendingReplace && (
        <ConfirmDialog
          isOpen
          onOpenChange={(isOpen) => !isOpen && setPendingReplace(undefined)}
          title={`Replace "${readBaseName(pendingReplace.path)}" with a .${readExtension(pendingReplace.file.name) || "?"} file?`}
          confirmLabel="Replace"
          confirmVariant="danger"
          testId="replace-type-dialog"
          onConfirm={() => queueReplacement(pendingReplace.file, pendingReplace.path, pendingReplace.expectedEtag)}
        >
          &ldquo;{pendingReplace.file.name}&rdquo; is a different kind of file. It is saved under the name &ldquo;
          {readBaseName(pendingReplace.path)}&rdquo;, which may make it open in the wrong viewer.
        </ConfirmDialog>
      )}
    </ExplorerContext.Provider>
  );
}
