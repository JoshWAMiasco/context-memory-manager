"use client";

import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  DirectoryListing,
  FileEntry,
  FileStat,
  JobSummary,
  SearchResults,
  StorageSummary,
  TrashItem,
} from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { joinEntryPath, QUERY_KEYS, readBaseName, readParentPath } from "@/lib/client/query-keys";
import { getStepUpDownloadUrl } from "@/lib/client/step-up";
import { describeFileKind } from "@/lib/file-kinds";

export interface StoragePath {
  storageId: string;
  path: string;
}

export interface TransferResult {
  paths: string[];
  job?: JobSummary;
}

function buildQuery(parameters: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [parameterName, parameterValue] of Object.entries(parameters)) {
    if (parameterValue !== undefined) searchParams.set(parameterName, parameterValue);
  }
  return searchParams.toString();
}

/**
 * The URL of a file's content for previews (`/api/fs/raw`), served sandboxed.
 *
 * @example
 * <img src={buildRawUrl(storageId, "images/chart.png")} alt="" />
 */
export function buildRawUrl(storageId: string, entryPath: string): string {
  return `/api/fs/raw?${buildQuery({ storageId, path: entryPath })}`;
}

/**
 * The URL that reads and saves a file as editor text (`/api/fs/text`).
 *
 * @example
 * await requestJson<TextFileResponse>(buildTextUrl(storageId, "notes.md"));
 */
export function buildTextUrl(storageId: string, entryPath: string): string {
  return `/api/fs/text?${buildQuery({ storageId, path: entryPath })}`;
}

/**
 * The storages the signed-in user can open, kept fresh by drive events.
 *
 * @example
 * const { data: storages = [] } = useStorages();
 */
export function useStorages() {
  return useQuery({
    queryKey: QUERY_KEYS.storages(),
    queryFn: async () => (await requestJson<{ storages: StorageSummary[] }>("/api/storages")).storages,
  });
}

/**
 * The query for a folder's listing. The cache holds every entry loaded so far; `nextCursor` is
 * set while a very large folder has more (see `loadMoreEntries`).
 *
 * @example
 * const results = useQueries({ queries: expandedPaths.map((path) => directoryQueryOptions(storageId, path)) });
 */
export function directoryQueryOptions(storageId: string, directoryPath: string) {
  return queryOptions({
    queryKey: QUERY_KEYS.directory(storageId, directoryPath),
    queryFn: ({ signal }) =>
      requestJson<DirectoryListing>(`/api/fs/list?${buildQuery({ storageId, path: directoryPath })}`, { signal }),
  });
}

/**
 * A folder's entries, folders first.
 *
 * @example
 * const { data: listing } = useDirectory(storageId, "notes");
 */
export function useDirectory(storageId: string, directoryPath: string, isEnabled = true) {
  return useQuery({ ...directoryQueryOptions(storageId, directoryPath), enabled: isEnabled });
}

/** Loads the next page of a folder with more than 5,000 entries into its cached listing. */
export async function loadMoreEntries(
  queryClient: QueryClient,
  storageId: string,
  directoryPath: string,
): Promise<void> {
  const queryKey = QUERY_KEYS.directory(storageId, directoryPath);
  const cachedListing = queryClient.getQueryData<DirectoryListing>(queryKey);
  if (!cachedListing?.nextCursor) return;
  const nextPage = await requestJson<DirectoryListing>(
    `/api/fs/list?${buildQuery({ storageId, path: directoryPath, cursor: cachedListing.nextCursor })}`,
  );
  queryClient.setQueryData<DirectoryListing>(queryKey, (currentListing) =>
    currentListing
      ? {
          ...currentListing,
          entries: [...currentListing.entries, ...nextPage.entries],
          nextCursor: nextPage.nextCursor,
        }
      : currentListing,
  );
}

/**
 * One entry with its ETag and permissions.
 *
 * @example
 * const { data: fileStat } = useStat(storageId, "notes/today.md");
 */
export function useStat(storageId: string, entryPath: string, isEnabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.stat(storageId, entryPath),
    queryFn: ({ signal }) =>
      requestJson<FileStat>(`/api/fs/stat?${buildQuery({ storageId, path: entryPath })}`, { signal }),
    enabled: isEnabled,
  });
}

/** Quick search starts at this many characters. */
export const MINIMUM_SEARCH_LENGTH = 2;

/**
 * Files and folders in a storage whose name contains `query` (quick search). Waits for at least
 * two characters and keeps the previous results while the next ones load.
 *
 * @example
 * const { data: results } = useStorageSearch(storageId, "meeting");
 */
export function useStorageSearch(storageId: string | undefined, query: string) {
  const trimmedQuery = query.trim();
  return useQuery({
    queryKey: QUERY_KEYS.search(storageId ?? "", trimmedQuery),
    queryFn: ({ signal }) =>
      requestJson<SearchResults>(`/api/fs/search?${buildQuery({ storageId, query: trimmedQuery })}`, { signal }),
    enabled: storageId !== undefined && trimmedQuery.length >= MINIMUM_SEARCH_LENGTH,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** Reads a folder's cached entries, or undefined when it isn't loaded. */
export function readCachedEntries(
  queryClient: QueryClient,
  storageId: string,
  directoryPath: string,
): FileEntry[] | undefined {
  return queryClient.getQueryData<DirectoryListing>(QUERY_KEYS.directory(storageId, directoryPath))?.entries;
}

function updateCachedEntries(
  queryClient: QueryClient,
  storageId: string,
  directoryPath: string,
  updateEntries: (entries: FileEntry[]) => FileEntry[],
): void {
  queryClient.setQueryData<DirectoryListing>(QUERY_KEYS.directory(storageId, directoryPath), (cachedListing) =>
    cachedListing ? { ...cachedListing, entries: updateEntries(cachedListing.entries) } : cachedListing,
  );
}

function compareEntries(first: FileEntry, second: FileEntry): number {
  if (first.type !== second.type) return first.type === "directory" ? -1 : 1;
  return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
}

/** A stand-in entry shown until the server answers. */
function buildPlaceholderEntry(entryPath: string, type: FileEntry["type"]): FileEntry {
  const name = readBaseName(entryPath);
  return {
    name,
    path: entryPath,
    type,
    size: 0,
    mtimeMs: Date.now(),
    createdMs: Date.now(),
    kind: type === "directory" ? "folder" : describeFileKind(name).kind,
    hasChildren: false,
    badges: { isMemory: false, protection: "none", encrypted: false, versioned: false },
  };
}

interface Snapshot {
  queryKey: readonly unknown[];
  data: unknown;
}

async function takeSnapshots(queryClient: QueryClient, keys: (readonly unknown[])[]): Promise<Snapshot[]> {
  await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  return keys.map((queryKey) => ({ queryKey, data: queryClient.getQueryData(queryKey) }));
}

function restoreSnapshots(queryClient: QueryClient, snapshots: Snapshot[] | undefined): void {
  for (const snapshot of snapshots ?? []) queryClient.setQueryData(snapshot.queryKey, snapshot.data);
}

/**
 * File operations as mutations. Each one changes the cached listing right away and puts it back
 * if the server refuses; the listing is refetched either way.
 *
 * @example
 * const { renameEntry } = useFileMutations();
 * await renameEntry.mutateAsync({ storageId, path: "notes/a.md", newName: "b.md" });
 */
export function useFileMutations() {
  const queryClient = useQueryClient();
  const refreshDirectories = (directories: StoragePath[]) =>
    Promise.all(
      directories.map((directory) =>
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(directory.storageId, directory.path) }),
      ),
    );

  const createFile = useMutation({
    mutationFn: ({ storageId, path, content }: StoragePath & { content?: string }) =>
      requestJson<{ entry: FileEntry }>("/api/fs/create", { method: "POST", body: { storageId, path, content } }),
    onMutate: async ({ storageId, path }) => {
      const parentPath = readParentPath(path);
      const snapshots = await takeSnapshots(queryClient, [QUERY_KEYS.directory(storageId, parentPath)]);
      updateCachedEntries(queryClient, storageId, parentPath, (entries) =>
        [...entries, buildPlaceholderEntry(path, "file")].toSorted(compareEntries),
      );
      return snapshots;
    },
    onError: (_error, _variables, snapshots) => restoreSnapshots(queryClient, snapshots),
    onSettled: (_data, _error, { storageId, path }) => refreshDirectories([{ storageId, path: readParentPath(path) }]),
  });

  const createFolder = useMutation({
    mutationFn: ({ storageId, path }: StoragePath) =>
      requestJson<{ entry: FileEntry }>("/api/fs/mkdir", { method: "POST", body: { storageId, path } }),
    onMutate: async ({ storageId, path }) => {
      const parentPath = readParentPath(path);
      const snapshots = await takeSnapshots(queryClient, [QUERY_KEYS.directory(storageId, parentPath)]);
      updateCachedEntries(queryClient, storageId, parentPath, (entries) =>
        [...entries, buildPlaceholderEntry(path, "directory")].toSorted(compareEntries),
      );
      return snapshots;
    },
    onError: (_error, _variables, snapshots) => restoreSnapshots(queryClient, snapshots),
    onSettled: (_data, _error, { storageId, path }) => refreshDirectories([{ storageId, path: readParentPath(path) }]),
  });

  const renameEntry = useMutation({
    mutationFn: ({ storageId, path, newName }: StoragePath & { newName: string }) =>
      requestJson<{ entry: FileEntry }>("/api/fs/rename", { method: "POST", body: { storageId, path, newName } }),
    onMutate: async ({ storageId, path, newName }) => {
      const parentPath = readParentPath(path);
      const snapshots = await takeSnapshots(queryClient, [QUERY_KEYS.directory(storageId, parentPath)]);
      updateCachedEntries(queryClient, storageId, parentPath, (entries) =>
        entries
          .map((entry) =>
            entry.path === path ? { ...entry, name: newName, path: joinEntryPath(parentPath, newName) } : entry,
          )
          .toSorted(compareEntries),
      );
      return snapshots;
    },
    onError: (_error, _variables, snapshots) => restoreSnapshots(queryClient, snapshots),
    onSettled: (_data, _error, { storageId, path }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storageDirectories(storageId) });
      return refreshDirectories([{ storageId, path: readParentPath(path) }]);
    },
  });

  const removeEntries = useMutation({
    mutationFn: ({ storageId, paths }: { storageId: string; paths: string[] }) =>
      requestJson<{ items: TrashItem[] }>("/api/fs/delete", { method: "POST", body: { storageId, paths } }),
    onMutate: async ({ storageId, paths }) => {
      const parentPaths = [...new Set(paths.map(readParentPath))];
      const snapshots = await takeSnapshots(
        queryClient,
        parentPaths.map((parentPath) => QUERY_KEYS.directory(storageId, parentPath)),
      );
      for (const parentPath of parentPaths) {
        updateCachedEntries(queryClient, storageId, parentPath, (entries) =>
          entries.filter((entry) => !paths.includes(entry.path)),
        );
      }
      return snapshots;
    },
    onError: (_error, _variables, snapshots) => restoreSnapshots(queryClient, snapshots),
    onSettled: (_data, _error, { storageId, paths }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trash() });
      return refreshDirectories([...new Set(paths.map(readParentPath))].map((path) => ({ storageId, path })));
    },
  });

  const moveEntries = useMutation({
    mutationFn: ({
      sources,
      destination,
      conflict,
      confirmDecrypt,
    }: {
      sources: StoragePath[];
      destination: StoragePath;
      conflict?: "fail" | "keep-both";
      confirmDecrypt?: boolean;
    }) =>
      requestJson<TransferResult>("/api/fs/move", {
        method: "POST",
        body: { sources, destination, conflict, confirmDecrypt },
      }),
    onMutate: async ({ sources }) => {
      const sourceFolders = sources.map((source) => ({
        storageId: source.storageId,
        path: readParentPath(source.path),
      }));
      const snapshots = await takeSnapshots(
        queryClient,
        sourceFolders.map((folder) => QUERY_KEYS.directory(folder.storageId, folder.path)),
      );
      for (const sourceFolder of sourceFolders) {
        updateCachedEntries(queryClient, sourceFolder.storageId, sourceFolder.path, (entries) =>
          entries.filter(
            (entry) =>
              !sources.some((source) => source.storageId === sourceFolder.storageId && source.path === entry.path),
          ),
        );
      }
      return snapshots;
    },
    onError: (_error, _variables, snapshots) => restoreSnapshots(queryClient, snapshots),
    onSettled: (_data, _error, { sources, destination }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs() });
      return refreshDirectories([
        ...sources.map((source) => ({ storageId: source.storageId, path: readParentPath(source.path) })),
        destination,
      ]);
    },
  });

  const copyEntries = useMutation({
    mutationFn: ({
      sources,
      destination,
      conflict,
      confirmDecrypt,
    }: {
      sources: StoragePath[];
      destination: StoragePath;
      conflict?: "fail" | "keep-both";
      confirmDecrypt?: boolean;
    }) =>
      requestJson<TransferResult>("/api/fs/copy", {
        method: "POST",
        body: { sources, destination, conflict, confirmDecrypt },
      }),
    onSettled: (_data, _error, { destination }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs() });
      return refreshDirectories([destination]);
    },
  });

  return { createFile, createFolder, renameEntry, removeEntries, moveEntries, copyEntries };
}

/**
 * Downloads a file, or a folder as a zip, after the `download` step-up when the server needs it.
 * A file in an encrypted folder comes decrypted, or with `asStored` exactly as stored.
 * Resolves false when the user cancels the confirmation.
 *
 * @example
 * await downloadEntry(storageId, "notes");
 */
export async function downloadEntry(
  storageId: string,
  entryPath: string,
  { asStored = false }: { asStored?: boolean } = {},
): Promise<boolean> {
  const query = buildQuery(asStored ? { storageId, path: entryPath, raw: "1" } : { storageId, path: entryPath });
  const downloadUrl = await getStepUpDownloadUrl(`/api/fs/download?${query}`, "download", `${storageId}:${entryPath}`);
  if (!downloadUrl) return false;
  const downloadLink = document.createElement("a");
  downloadLink.href = downloadUrl;
  downloadLink.download = "";
  downloadLink.rel = "noopener";
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  return true;
}

/** Ejects or mounts a drive, refreshing the storage list afterwards. */
export function useDriveActions() {
  const queryClient = useQueryClient();
  const refreshStorages = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storages() });
  const ejectDrive = useMutation({
    mutationFn: (storageId: string) =>
      requestJson<{ ok: true }>(`/api/drives/${encodeURIComponent(storageId)}/eject`, { method: "POST" }),
    onSettled: refreshStorages,
  });
  const mountDrive = useMutation({
    mutationFn: (storageId: string) =>
      requestJson<{ ok: true }>(`/api/drives/${encodeURIComponent(storageId)}/mount`, { method: "POST" }),
    onSettled: refreshStorages,
  });
  return { ejectDrive, mountDrive };
}
