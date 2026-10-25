/** TanStack Query keys, in one place so server events and mutations invalidate the same entries. */
export const QUERY_KEYS = {
  storages: () => ["storages"] as const,
  directory: (storageId: string, directoryPath: string) => ["fs", "list", storageId, directoryPath] as const,
  storageDirectories: (storageId: string) => ["fs", "list", storageId] as const,
  stat: (storageId: string, entryPath: string) => ["fs", "stat", storageId, entryPath] as const,
  search: (storageId: string, query: string) => ["fs", "search", storageId, query] as const,
  jobs: () => ["jobs"] as const,
  /** Memory settings, stats and protection of one folder; `folderState(storageId)` covers a whole storage. */
  folderState: (storageId: string, entryPath?: string) =>
    entryPath === undefined
      ? (["folder-state", storageId] as const)
      : (["folder-state", storageId, entryPath] as const),
  memoryTemplates: () => ["memory-templates"] as const,
  /** Encryption status of one entry; `encryption()` covers every folder. */
  encryption: (storageId?: string, entryPath?: string) =>
    storageId === undefined
      ? (["encryption"] as const)
      : entryPath === undefined
        ? (["encryption", storageId] as const)
        : (["encryption", storageId, entryPath] as const),
  encryptedFolders: () => ["encryption", "folders"] as const,
  /** Versioning status, history, commits and diffs of a storage; `versioning()` covers every storage. */
  versioning: (storageId?: string, ...parts: string[]) =>
    storageId === undefined ? (["versioning"] as const) : (["versioning", storageId, ...parts] as const),
  gitStatus: () => ["git-status"] as const,
  trash: () => ["trash"] as const,
  /** Backup profiles, runs and the machine; `backup()` covers all of them. */
  backup: (...parts: string[]) => ["backup", ...parts] as const,
};

/** The parent folder of a storage-relative path ("" for top-level entries). */
export function readParentPath(entryPath: string): string {
  const slashIndex = entryPath.lastIndexOf("/");
  return slashIndex === -1 ? "" : entryPath.slice(0, slashIndex);
}

/** The last segment of a storage-relative path. */
export function readBaseName(entryPath: string): string {
  return entryPath.slice(entryPath.lastIndexOf("/") + 1);
}

/** Joins a folder path and a name into a storage-relative path. */
export function joinEntryPath(directoryPath: string, entryName: string): string {
  return directoryPath === "" ? entryName : `${directoryPath}/${entryName}`;
}
