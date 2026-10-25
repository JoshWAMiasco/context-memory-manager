/**
 * The page URL of a storage, or of a file or folder inside it: `/storage/<id>/<path segments>`,
 * each segment URL-encoded.
 *
 * @example
 * buildStorageHref("home", "notes/today.md"); // "/storage/home/notes/today.md"
 */
export function buildStorageHref(storageId: string, entryPath = ""): string {
  const encodedPath = entryPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/storage/${encodeURIComponent(storageId)}${encodedPath ? `/${encodedPath}` : ""}`;
}

/** The search parameter that opens the storage page as a memory's own explorer, rooted at that folder. */
export const MEMORY_ROOT_PARAMETER = "memory";

/**
 * The page URL of a memory's own explorer, whose file tree starts at the memory folder:
 * `/storage/<id>/<entry path>?memory=<memory path>`. The entry is the memory itself unless given.
 *
 * @example
 * buildMemoryHref("home", "persona"); // "/storage/home/persona?memory=persona"
 * buildMemoryHref("home", "persona", "persona/notes.md"); // "/storage/home/persona/notes.md?memory=persona"
 */
export function buildMemoryHref(storageId: string, memoryPath: string, entryPath = memoryPath): string {
  return `${buildStorageHref(storageId, entryPath)}?${new URLSearchParams({ [MEMORY_ROOT_PARAMETER]: memoryPath })}`;
}

/** Reads `{ storageId, path }` back from a storage page pathname, or undefined for other pages. */
export function parseStorageHref(pathname: string): { storageId: string; path: string } | undefined {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (pathSegments[0] !== "storage" || !pathSegments[1]) return undefined;
  const decode = (segment: string) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };
  return { storageId: decode(pathSegments[1]), path: pathSegments.slice(2).map(decode).join("/") };
}

/** The search parameters that open the Backup page's editor on a new memory backup of some folders. */
export const BACKUP_STORAGE_PARAMETER = "storage";
export const BACKUP_FOLDER_PARAMETER = "folder";

/**
 * The Backup page, opening the editor on a new memory backup of these folders of one storage:
 * `/backup?storage=<id>&folder=<path>&folder=<path>`.
 *
 * @example
 * buildMemoryBackupHref("home", ["notes", "persona"]); // "/backup?storage=home&folder=notes&folder=persona"
 */
export function buildMemoryBackupHref(storageId: string, folderPaths: readonly string[]): string {
  const searchParameters = new URLSearchParams({ [BACKUP_STORAGE_PARAMETER]: storageId });
  for (const folderPath of folderPaths) searchParameters.append(BACKUP_FOLDER_PARAMETER, folderPath);
  return `/backup?${searchParameters}`;
}

/** Reads `{ storageId, paths }` back from the Backup page's search parameters, or undefined when there are none. */
export function parseMemoryBackupSearch(
  searchParameters: Record<string, string | string[] | undefined>,
): { storageId: string; paths: string[] } | undefined {
  const storageId = searchParameters[BACKUP_STORAGE_PARAMETER];
  const folderParameter = searchParameters[BACKUP_FOLDER_PARAMETER];
  const paths = (Array.isArray(folderParameter) ? folderParameter : [folderParameter]).filter(
    (folderPath): folderPath is string => typeof folderPath === "string",
  );
  if (typeof storageId !== "string" || storageId === "" || paths.length === 0) return undefined;
  return { storageId, paths: [...new Set(paths)] };
}
