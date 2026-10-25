import "server-only";
import { readdir } from "node:fs/promises";
import type { SearchMatch, SearchResults } from "@/lib/api-types";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import { isHiddenCcmName, resolveInStorage } from "@/server/security/path-jail";
import type { ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

/** At most this many matches come back. */
export const SEARCH_RESULT_LIMIT = 50;
/** The walk stops after this many entries or this long, so a huge drive can't stall a keystroke. */
const SEARCH_ENTRY_LIMIT = 50_000;
const SEARCH_TIME_LIMIT_MILLISECONDS = 1500;

function isSearchable(entryName: string): boolean {
  return !isHiddenCcmName(entryName) && !isSystemMetadataName(entryName) && entryName !== ".git";
}

/**
 * Finds files and folders in a storage whose name contains `query` (case-insensitive) for quick
 * search: breadth-first, so shallow matches come first, without following symlinks and skipping
 * CCM's folders, `.git` and the operating system's metadata. It stops at 50 matches, 50,000
 * entries or 1.5 s and then says the results are incomplete.
 *
 * @example
 * const { matches } = await searchStorage(storage, "meeting"); // [{ name: "meeting.md", path: "notes/meeting.md", type: "file" }]
 */
export async function searchStorage(
  storage: ActiveStorage,
  query: string,
  { limit = SEARCH_RESULT_LIMIT, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<SearchResults> {
  const needle = query.trim().toLowerCase();
  const root = await resolveInStorage(storage, "");
  const matches: SearchMatch[] = [];
  const deadline = Date.now() + SEARCH_TIME_LIMIT_MILLISECONDS;
  const pendingFolders = [""];
  let scanned = 0;
  let isComplete = true;
  while (pendingFolders.length > 0) {
    if (matches.length >= limit || scanned >= SEARCH_ENTRY_LIMIT || Date.now() > deadline || signal?.aborted) {
      isComplete = false;
      break;
    }
    const relativeFolder = pendingFolders.shift() ?? "";
    const absoluteFolder =
      relativeFolder === "" ? root.absolutePath : joinStoragePath(root.absolutePath, ...relativeFolder.split("/"));
    const children = await readdir(absoluteFolder, { withFileTypes: true }).catch(() => []);
    for (const child of children.toSorted((first, second) => first.name.localeCompare(second.name))) {
      if (!isSearchable(child.name)) continue;
      scanned += 1;
      const childPath = relativeFolder === "" ? child.name : `${relativeFolder}/${child.name}`;
      const isDirectory = child.isDirectory();
      if (isDirectory) pendingFolders.push(childPath);
      if (needle !== "" && child.name.toLowerCase().includes(needle) && matches.length < limit) {
        matches.push({ name: child.name, path: childPath, type: isDirectory ? "directory" : "file" });
      }
    }
  }
  return { storageId: storage.id, query, matches, isComplete };
}
