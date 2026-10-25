"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { announce, announceError } from "@/components/explorer/explorer-context";
import { useServerEvent } from "@/hooks/use-server-events";
import type { FileStat, LineEnding, TextFileResponse } from "@/lib/api-types";
import { ApiError, requestJson } from "@/lib/client/api";
import { getServerEventsClient } from "@/lib/client/events";
import { fetchWithProgress, sendJsonWithProgress, type TransferProgress } from "@/lib/client/fetch-with-progress";
import { buildRawUrl, buildTextUrl } from "@/lib/client/fs";
import { QUERY_KEYS, readBaseName, readParentPath } from "@/lib/client/query-keys";
import { registerUnsavedDocument } from "@/lib/client/unsaved-changes";

/** Text files larger than this aren't loaded at all; they show the placeholder with Download. */
export const MAX_TEXT_VIEW_BYTES = 100 * 1024 * 1024;

/** Saves larger than this go through `XMLHttpRequest`, so the Save button can show progress. */
const LARGE_SAVE_BYTES = 1024 * 1024;

/** Unsaved edits of an encrypted file survive a folder lock this long, in memory only. */
export const LOCKED_DRAFT_MILLISECONDS = 10 * 60 * 1000;

export interface ConflictState {
  /** "stale-save": the server answered 412. "external-change": the user asked to compare after a change on disk. */
  reason: "stale-save" | "external-change";
}

export interface FileDocument {
  status: "loading" | "ready" | "error";
  progress?: TransferProgress;
  loadError?: unknown;
  /** The text being edited, with `\n` line breaks. */
  content: string;
  isDirty: boolean;
  /** False for files over the edit limit or not in UTF-8: they open view-only. */
  isEditable: boolean;
  readOnlyReason?: string;
  lineEnding: LineEnding;
  isSaving: boolean;
  saveProgress?: TransferProgress;
  conflict?: ConflictState;
  externalChange?: "changed" | "removed";
  /** The folder locked while there were unsaved edits; they wait in memory for an unlock. */
  hasLockedDraft: boolean;
  setContent: (content: string) => void;
  /**
   * Saves with `If-Match`; resolves false on a conflict or error (the conflict dialog opens on 412).
   * Does nothing (and resolves true) when there are no changes.
   */
  save: () => Promise<boolean>;
  /** Saves over whatever is on disk now. */
  overwrite: () => Promise<boolean>;
  /** Saves under a new name in the same folder; resolves the new path, or undefined when it failed. */
  saveAs: (newName: string) => Promise<string | undefined>;
  /** Loads the file again, dropping unsaved changes. `isSilent` keeps the current text shown until the new one arrives. */
  reload: (options?: { isSilent?: boolean }) => void;
  cancelLoad: () => void;
  discard: () => void;
  /** Reads what is on disk now, for the compare view. */
  readDiskVersion: () => Promise<TextFileResponse>;
  /** Saves the merged text from the compare view over the disk version that was compared. */
  saveMerge: (mergedContent: string, diskEtag: string) => Promise<boolean>;
  openConflict: (conflict: ConflictState | undefined) => void;
  dismissExternalChange: () => void;
}

export interface FileDocumentSource {
  storageId: string;
  path: string;
  size: number;
  etag: string;
  /** From the stat sniff: false means not UTF-8, so the file opens view-only. */
  isUtf8: boolean;
  maxEditBytes: number;
  isEnabled: boolean;
  /** The file is encrypted on disk: saves say "Saved (encrypted)". */
  isEncrypted?: boolean;
  /**
   * Its encrypted folder is locked for this session. The decrypted text is dropped from memory;
   * unsaved edits are kept for 10 minutes, then dropped too.
   */
  isLocked?: boolean;
}

interface LoadedText {
  content: string;
  etag?: string;
  lineEnding: LineEnding;
  encoding: TextFileResponse["encoding"];
  readOnlyReason?: string;
}

function formatMegabytes(bytes: number): string {
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** Loads editor text, or falls back to the raw bytes view-only when the file is too large or not UTF-8. */
async function loadText(
  { storageId, path, size, isUtf8, maxEditBytes }: FileDocumentSource,
  signal: AbortSignal,
  onProgress: (progress: TransferProgress) => void,
): Promise<LoadedText> {
  let readOnlyReason: string | undefined;
  if (!isUtf8) readOnlyReason = "Encoding not supported for editing.";
  else if (size > maxEditBytes) readOnlyReason = `Files over ${formatMegabytes(maxEditBytes)} open view-only.`;
  if (readOnlyReason === undefined) {
    try {
      const { bytes } = await fetchWithProgress(buildTextUrl(storageId, path), {
        signal,
        onProgress,
        expectedBytes: size,
      });
      return JSON.parse(decodeText(bytes)) as TextFileResponse;
    } catch (loadError) {
      if (!(loadError instanceof ApiError) || (loadError.status !== 413 && loadError.status !== 415)) throw loadError;
      readOnlyReason =
        loadError.status === 413 ? "This file is too large to edit." : "Encoding not supported for editing.";
    }
  }
  const { bytes, etag } = await fetchWithProgress(buildRawUrl(storageId, path), {
    signal,
    onProgress,
    expectedBytes: size,
  });
  return {
    content: decodeText(bytes).replaceAll("\r\n", "\n"),
    etag,
    lineEnding: "lf",
    encoding: "utf-8",
    readOnlyReason,
  };
}

/**
 * The open text file: loads it with progress, tracks unsaved changes, saves with
 * `If-Match` in the file's own line endings and encoding, and notices changes made on disk
 *: a clean document reloads quietly, a dirty one gets `externalChange` for the banner.
 * A 412 on save sets `conflict` for the conflict dialog.
 *
 * @example
 * const fileDocument = useFileDocument({ storageId, path, size, etag, isUtf8, maxEditBytes, isEnabled: true });
 */
export function useFileDocument(source: FileDocumentSource): FileDocument {
  const { storageId, path, isEnabled, isLocked = false } = source;
  const queryClient = useQueryClient();
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [status, setStatus] = useState<FileDocument["status"]>("loading");
  const [progress, setProgress] = useState<TransferProgress>();
  const [loadError, setLoadError] = useState<unknown>();
  const [content, setContentState] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [format, setFormat] = useState<Pick<LoadedText, "lineEnding" | "encoding" | "readOnlyReason">>({
    lineEnding: "lf",
    encoding: "utf-8",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<TransferProgress>();
  const [conflict, setConflict] = useState<ConflictState>();
  const [externalChange, setExternalChange] = useState<FileDocument["externalChange"]>();
  const [hasLockedDraft, setHasLockedDraft] = useState(false);
  const keepsLockedDraftRef = useRef(false);
  const draftRef = useRef("");
  const originalRef = useRef("");
  const etagRef = useRef<string | undefined>(source.etag);
  const isSavingRef = useRef(false);
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  const sourceRef = useRef(source);

  useEffect(() => {
    sourceRef.current = source;
  });

  useEffect(() => {
    if (!isEnabled || isLocked) return;
    if (keepsLockedDraftRef.current) {
      // Unlocked again with edits waiting: keep them (and the ETag they were made against).
      keepsLockedDraftRef.current = false;
      setHasLockedDraft(false);
      return;
    }
    const controller = new AbortController();
    loadControllerRef.current = controller;
    let reportedBytes = -1;
    loadText(sourceRef.current, controller.signal, (nextProgress) => {
      const step = Math.max((nextProgress.total ?? 0) / 100, 256 * 1024);
      if (nextProgress.loaded - reportedBytes < step && nextProgress.loaded !== nextProgress.total) return;
      reportedBytes = nextProgress.loaded;
      setProgress(nextProgress);
    }).then(
      (loadedText) => {
        if (controller.signal.aborted) return;
        draftRef.current = loadedText.content;
        originalRef.current = loadedText.content;
        etagRef.current = loadedText.etag ?? sourceRef.current.etag;
        setContentState(loadedText.content);
        setOriginalContent(loadedText.content);
        setFormat({
          lineEnding: loadedText.lineEnding,
          encoding: loadedText.encoding,
          readOnlyReason: loadedText.readOnlyReason,
        });
        setLoadError(undefined);
        setStatus("ready");
      },
      (error: unknown) => {
        if (controller.signal.aborted && loadControllerRef.current !== controller) return;
        setLoadError(error);
        setStatus("error");
      },
    );
    return () => {
      if (loadControllerRef.current === controller) loadControllerRef.current = undefined;
      controller.abort();
    };
  }, [isEnabled, isLocked, loadGeneration, storageId, path]);

  useEffect(() => {
    if (!isLocked) return;
    const forgetText = () => {
      draftRef.current = "";
      originalRef.current = "";
      keepsLockedDraftRef.current = false;
      setContentState("");
      setOriginalContent("");
      setHasLockedDraft(false);
      setStatus("loading");
    };
    if (draftRef.current === originalRef.current) {
      forgetText();
      return;
    }
    keepsLockedDraftRef.current = true;
    setHasLockedDraft(true);
    const timer = setTimeout(forgetText, LOCKED_DRAFT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [isLocked]);

  const isDirty = content !== originalContent;
  const isEditable = format.readOnlyReason === undefined;

  const setContent = useCallback((nextContent: string) => {
    draftRef.current = nextContent;
    setContentState(nextContent);
  }, []);

  const reload = useCallback(({ isSilent = false }: { isSilent?: boolean } = {}) => {
    if (!isSilent) {
      setStatus("loading");
      setProgress(undefined);
    }
    setExternalChange(undefined);
    setConflict(undefined);
    setLoadGeneration((generation) => generation + 1);
  }, []);

  const cancelLoad = useCallback(() => {
    const controller = loadControllerRef.current;
    if (!controller) return;
    controller.abort();
    setLoadError(new DOMException("Loading was cancelled.", "AbortError"));
    setStatus("error");
  }, []);

  const discard = useCallback(() => {
    draftRef.current = originalRef.current;
    setContentState(originalRef.current);
  }, []);

  const writeContent = useCallback(
    async (targetPath: string, ifMatch: string | undefined): Promise<FileStat> => {
      const savedContent = draftRef.current;
      const body = {
        storageId,
        path: targetPath,
        content: savedContent,
        lineEnding: format.lineEnding,
        encoding: format.encoding,
      };
      const headers: Record<string, string> = ifMatch ? { "if-match": ifMatch } : {};
      const textUrl = buildTextUrl(storageId, targetPath);
      return savedContent.length > LARGE_SAVE_BYTES
        ? sendJsonWithProgress<FileStat>(textUrl, { method: "PUT", body, headers, onUploadProgress: setSaveProgress })
        : requestJson<FileStat>(textUrl, { method: "PUT", body, headers });
    },
    [format.encoding, format.lineEnding, storageId],
  );

  const saveWith = useCallback(
    async (ifMatch: string | undefined): Promise<boolean> => {
      if (!isEditable || isSavingRef.current) return false;
      const savedContent = draftRef.current;
      isSavingRef.current = true;
      setIsSaving(true);
      try {
        const fileStat = await writeContent(path, ifMatch);
        originalRef.current = savedContent;
        etagRef.current = fileStat.etag;
        setOriginalContent(savedContent);
        setConflict(undefined);
        setExternalChange(undefined);
        queryClient.setQueryData<FileStat>(QUERY_KEYS.stat(storageId, path), (cachedStat) =>
          cachedStat ? { ...cachedStat, ...fileStat } : cachedStat,
        );
        announce(sourceRef.current.isEncrypted ? "Saved (encrypted)" : "Saved", readBaseName(path));
        return true;
      } catch (saveError) {
        if (saveError instanceof ApiError && saveError.status === 412) {
          setConflict({ reason: "stale-save" });
          return false;
        }
        announceError("Couldn't save", saveError);
        return false;
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
        setSaveProgress(undefined);
      }
    },
    [isEditable, path, queryClient, storageId, writeContent],
  );

  const save = useCallback(
    async () => draftRef.current === originalRef.current || saveWith(etagRef.current),
    [saveWith],
  );

  const overwrite = useCallback(async () => {
    try {
      const fileStat = await requestJson<FileStat>(
        `/api/fs/stat?${new URLSearchParams({ storageId, path }).toString()}`,
      );
      return await saveWith(fileStat.etag);
    } catch (statError) {
      if (statError instanceof ApiError && statError.status === 404) return saveWith(undefined);
      announceError("Couldn't save", statError);
      return false;
    }
  }, [path, saveWith, storageId]);

  const saveAs = useCallback(
    async (newName: string) => {
      const newPath = readParentPath(path) === "" ? newName : `${readParentPath(path)}/${newName}`;
      try {
        await requestJson("/api/fs/create", { method: "POST", body: { storageId, path: newPath } });
        await writeContent(newPath, undefined);
        originalRef.current = draftRef.current;
        setOriginalContent(draftRef.current);
        setExternalChange(undefined);
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(storageId, readParentPath(path)) });
        announce("Saved", newName);
        return newPath;
      } catch (saveError) {
        announceError("Couldn't save", saveError);
        return undefined;
      }
    },
    [path, queryClient, storageId, writeContent],
  );

  const readDiskVersion = useCallback(
    () => requestJson<TextFileResponse>(buildTextUrl(storageId, path)),
    [path, storageId],
  );

  const saveMerge = useCallback(
    (mergedContent: string, diskEtag: string) => {
      draftRef.current = mergedContent;
      setContentState(mergedContent);
      return saveWith(diskEtag);
    },
    [saveWith],
  );

  useEffect(() => {
    if (!isEnabled) return;
    return getServerEventsClient().watch(storageId, readParentPath(path));
  }, [isEnabled, path, storageId]);

  const handleFileChanged = useCallback(
    ({ storageId: changedStorageId, path: changedPath }: { storageId: string; path: string }) => {
      if (!isEnabled || changedStorageId !== storageId || changedPath !== path || isSavingRef.current) return;
      requestJson<FileStat>(`/api/fs/stat?${new URLSearchParams({ storageId, path }).toString()}`).then(
        (fileStat) => {
          if (isSavingRef.current || fileStat.etag === etagRef.current) return;
          if (draftRef.current === originalRef.current) {
            reload({ isSilent: true });
            announce("Updated from disk", readBaseName(path));
          } else {
            setExternalChange("changed");
          }
        },
        (statError: unknown) => {
          if (statError instanceof ApiError && statError.status === 404) setExternalChange("removed");
        },
      );
    },
    [isEnabled, path, reload, storageId],
  );
  useServerEvent("fs.changed", handleFileChanged);

  useEffect(() => {
    if (!isEnabled) return;
    return registerUnsavedDocument({
      fileName: readBaseName(path),
      isEncrypted: sourceRef.current.isEncrypted === true,
      isDirty: () => draftRef.current !== originalRef.current,
      save,
      discard,
    });
  }, [discard, isEnabled, path, save]);

  return {
    status,
    progress,
    loadError,
    content,
    isDirty,
    isEditable,
    readOnlyReason: format.readOnlyReason,
    lineEnding: format.lineEnding,
    isSaving,
    saveProgress,
    conflict,
    externalChange,
    hasLockedDraft,
    setContent,
    save,
    overwrite,
    saveAs,
    reload,
    cancelLoad,
    discard,
    readDiskVersion,
    saveMerge,
    openConflict: setConflict,
    dismissExternalChange: () => setExternalChange(undefined),
  };
}
