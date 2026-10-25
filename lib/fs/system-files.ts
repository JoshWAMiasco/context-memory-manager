/*
 * Files the operating system writes next to the user's own: macOS keeps extended attributes in
 * "._name" (AppleDouble) files on FAT and exFAT drives, plus Finder and Spotlight state; Windows
 * keeps its own folders at a drive's root. CCM hides them from listings and backups never copy or
 * mirror-delete them. Isomorphic: no server-only imports here.
 */

const APPLE_DOUBLE_PREFIX = "._";

const SYSTEM_METADATA_NAMES: ReadonlySet<string> = new Set([
  ".ds_store",
  ".spotlight-v100",
  ".fseventsd",
  ".trashes",
  ".temporaryitems",
  ".documentrevisions-v100",
  "system volume information",
  "$recycle.bin",
  "thumbs.db",
]);

/**
 * Whether `entryName` is an operating-system metadata file or folder rather than the user's data.
 *
 * @example
 * isSystemMetadataName("._notes.md"); // true: macOS AppleDouble on a FAT/exFAT drive
 * isSystemMetadataName(".DS_Store"); // true
 * isSystemMetadataName("notes.md"); // false
 */
export function isSystemMetadataName(entryName: string): boolean {
  return entryName.startsWith(APPLE_DOUBLE_PREFIX) || SYSTEM_METADATA_NAMES.has(entryName.toLowerCase());
}
