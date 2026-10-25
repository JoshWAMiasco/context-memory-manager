import "server-only";
import path from "node:path";
import type { FileBadges } from "@/lib/api-types";
import { readListingBadges } from "@/server/meta/effective";
import { META_DIRECTORY } from "@/server/meta/store";

export const CCM_META_DIRECTORY = META_DIRECTORY;

export const EMPTY_BADGES: FileBadges = { isMemory: false, protection: "none", encrypted: false, versioned: false };

/**
 * The badges of one entry: memory, effective protection (inherited from parent folders
 * or set on the entry), encryption and versioning, read from `.ccm/` files. Listings use
 * `readListingBadges` to read a folder's parents once for all its entries.
 *
 * @example
 * const badges = await readEntryBadges(storage.rootPath, "notes/today.md", false);
 */
export async function readEntryBadges(
  rootPath: string,
  relativePath: string,
  isDirectory: boolean,
): Promise<FileBadges> {
  if (relativePath === "") {
    const [rootBadges] = await readListingBadges(
      path.dirname(rootPath),
      "",
      [{ name: path.basename(rootPath), isDirectory: true }],
      { includeFolder: false },
    );
    return rootBadges ?? EMPTY_BADGES;
  }
  const parentPath = path.posix.dirname(relativePath);
  const [badges] = await readListingBadges(rootPath, parentPath === "." ? "" : parentPath, [
    { name: path.posix.basename(relativePath), isDirectory },
  ]);
  return badges ?? EMPTY_BADGES;
}

/**
 * A folder's own badges without its parents (the trash records whether a deleted folder was a
 * memory).
 *
 * @example
 * const { isMemory } = await readFolderBadges("/data/notes/persona");
 */
export async function readFolderBadges(folderAbsolutePath: string): Promise<FileBadges> {
  const [badges] = await readListingBadges(
    path.dirname(folderAbsolutePath),
    "",
    [{ name: path.basename(folderAbsolutePath), isDirectory: true }],
    { includeFolder: false },
  );
  return badges ?? EMPTY_BADGES;
}
