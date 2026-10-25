import "server-only";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import picomatch from "picomatch";
import type { BackupCompare, BackupMode, BackupWarning } from "@/lib/api-types";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import { hashFile, PART_SUFFIX } from "@/server/backup/copy";
import { walkTree, type TreeEntry } from "@/server/storage/copy-tree";

/** FAT and exFAT keep modification times to 2 seconds, so closer than that counts as equal. */
export const MTIME_TOLERANCE_MILLISECONDS = 2000;

/** FAT32 can't hold a file of 4 GiB or more. */
export const FAT32_FILE_LIMIT_BYTES = 4 * 1024 ** 3 - 1;

/** Snapshot folders: `2026-10-24_14-05-09`, or `…_14-05-09-2` when two runs start in the same second. */
export const SNAPSHOT_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/;

const FAT_FILE_SYSTEMS = new Set(["vfat", "fat", "fat12", "fat16", "fat32", "msdos"]);
const RESTRICTED_NAME_FILE_SYSTEMS = new Set([...FAT_FILE_SYSTEMS, "exfat", "ntfs", "fuseblk"]);
const CASE_SENSITIVE_FILE_SYSTEMS = new Set(["ext2", "ext3", "ext4", "btrfs", "xfs", "zfs", "f2fs", "jfs", "reiserfs"]);
const CASE_INSENSITIVE_FILE_SYSTEMS = new Set([...RESTRICTED_NAME_FILE_SYSTEMS, "hfs", "hfs+", "apfs"]);

// Control characters are illegal in names on FAT, exFAT and NTFS.
const ILLEGAL_NAME_CHARACTERS = /[:*?"<>|\\\u0000-\u001F]/g;
const TRAILING_DOTS_AND_SPACES = /[. ]+$/;

export interface PlanEntry {
  /** Path inside the source folder, `/`-separated. */
  sourcePath: string;
  /** Path inside the target folder: the same, unless a name had to change for the destination. */
  targetPath: string;
  type: "file" | "directory" | "symlink";
  size: number;
  mtimeMs: number;
  mode: number;
  /** Bytes of the destination file this one replaces (they are freed by the copy). */
  replacesBytes: number;
}

export interface PlanDeletion {
  targetPath: string;
  isDirectory: boolean;
}

export interface BackupPlan {
  /** Folders to create, then files and links to copy, parents first. */
  copy: PlanEntry[];
  /** Files that are already the same on the destination. */
  skip: number;
  /** Mirror only: destination entries the source doesn't have, moved to the destination's trash. */
  delete: PlanDeletion[];
  /** Mirror only: destination entries in the way of a source entry of another type (a file where a folder goes), moved to the trash before copying. */
  replace: PlanDeletion[];
  /** Leftover `.ccm-part` files from an interrupted copy, removed before copying. */
  staleParts: string[];
  /** Bytes to copy. */
  bytesTotal: number;
  /** Files to copy. */
  filesTotal: number;
  warnings: BackupWarning[];
  /** Free space the copy needs: the bytes to copy minus the bytes they replace. */
  requiredBytes: number;
  freeBytes: number;
  insufficientSpace: boolean;
  /** Identifies the plan, so a resumed job can tell whether it may continue at its saved index. */
  hash: string;
}

export interface BuildPlanInput {
  source: { absolutePath: string };
  /** The folder the files go into (it may not exist yet), and its volume. */
  dest: { absolutePath: string; fsType: string; freeBytes: number };
  mode: BackupMode;
  options: { includeGit: boolean; excludes: readonly string[]; compare: BackupCompare };
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  /** Entries looked at so far, for "Scanning…" progress. */
  onScan?: (entryCount: number) => void;
}

interface DestinationEntry {
  targetPath: string;
  type: TreeEntry["type"];
  size: number;
  mtimeMs: number;
  absolutePath: string;
}

export function isFatFileSystem(fsType: string): boolean {
  return FAT_FILE_SYSTEMS.has(fsType.toLowerCase());
}

/** Whether names on this file system can't hold `: * ? " < > |` or end in a dot or space. */
export function hasRestrictedNames(fsType: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" || RESTRICTED_NAME_FILE_SYSTEMS.has(fsType.toLowerCase());
}

/** Whether `Notes.md` and `notes.md` are the same file there (macOS and Windows defaults for unknown types). */
export function isCaseInsensitiveFileSystem(fsType: string, platform: NodeJS.Platform = process.platform): boolean {
  const normalizedType = fsType.toLowerCase();
  if (CASE_INSENSITIVE_FILE_SYSTEMS.has(normalizedType)) return true;
  if (CASE_SENSITIVE_FILE_SYSTEMS.has(normalizedType)) return false;
  return platform === "darwin" || platform === "win32";
}

/**
 * A name the destination accepts: `: * ? " < > |`, backslashes and control characters become
 * `_`, and so do trailing dots and spaces.
 *
 * @example
 * sanitizeName("notes: draft?.md"); // "notes_ draft_.md"
 */
export function sanitizeName(name: string): string {
  const replaced = name.replaceAll(ILLEGAL_NAME_CHARACTERS, "_");
  return replaced.replace(TRAILING_DOTS_AND_SPACES, (trailing) => "_".repeat(trailing.length));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A snapshot folder name for `date`, in local time.
 *
 * @example
 * formatSnapshotName(new Date(2026, 9, 24, 14, 5, 9)); // "2026-10-24_14-05-09"
 */
export function formatSnapshotName(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Where a backup writes inside the chosen destination folder: `<dest>/<sourceName>` for copy and
 * mirror, `<dest>/<sourceName>/<YYYY-MM-DD_HH-mm-ss>` for a snapshot. Paths are relative to the
 * destination storage.
 *
 * @example
 * resolveTargetPath("Backups", "notes", "snapshot", "2026-10-24_14-05-09"); // "Backups/notes/2026-10-24_14-05-09"
 */
export function resolveTargetPath(
  destinationPath: string,
  sourceName: string,
  mode: BackupMode,
  snapshotName?: string,
): string {
  const segments = [destinationPath, sanitizeName(sourceName)];
  if (mode === "snapshot") segments.push(snapshotName ?? formatSnapshotName(new Date()));
  return segments.filter((segment) => segment !== "").join("/");
}

/**
 * Whether a path inside the source is left out: the operating system's metadata (`._name`,
 * `.DS_Store`: `isSystemMetadataName`), `.git` when `includeGit` is off, and anything an exclude
 * glob matches. A pattern without a slash matches a name anywhere (`*.log`, `node_modules`); a
 * trailing slash is ignored. Left-out paths on the destination are never mirror-deleted either.
 *
 * @example
 * createExcludeMatcher(["*.log"], true)("logs/today.log"); // true
 * createExcludeMatcher([], true)("notes/._today.md"); // true
 */
export function createExcludeMatcher(
  excludes: readonly string[],
  includeGit: boolean,
): (relativePath: string) => boolean {
  const patterns = excludes.map((pattern) => pattern.trim().replace(/\/+$/, "")).filter((pattern) => pattern !== "");
  if (!includeGit) patterns.push(".git");
  const namePatterns = patterns.filter((pattern) => !pattern.includes("/"));
  const pathPatterns = patterns.filter((pattern) => pattern.includes("/"));
  const matchers = [
    ...(namePatterns.length > 0 ? [picomatch(namePatterns, { dot: true, basename: true })] : []),
    ...(pathPatterns.length > 0 ? [picomatch(pathPatterns, { dot: true })] : []),
  ];
  return (relativePath) =>
    isSystemMetadataName(readName(relativePath)) || matchers.some((matches) => matches(relativePath));
}

function readName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

function readParent(relativePath: string): string {
  const slashIndex = relativePath.lastIndexOf("/");
  return slashIndex === -1 ? "" : relativePath.slice(0, slashIndex);
}

function isUnder(relativePath: string, prefixes: ReadonlySet<string>): boolean {
  for (let parent = readParent(relativePath); ; parent = readParent(parent)) {
    if (prefixes.has(parent)) return true;
    if (parent === "") return false;
  }
}

async function readDestination(
  targetAbsolutePath: string,
  { signal, foldCase }: { signal?: AbortSignal; foldCase: boolean },
): Promise<{ entries: Map<string, DestinationEntry>; staleParts: string[] }> {
  const entries = new Map<string, DestinationEntry>();
  const staleParts: string[] = [];
  const targetStats = await lstat(targetAbsolutePath).catch(() => undefined);
  if (!targetStats?.isDirectory()) return { entries, staleParts };
  for await (const treeEntry of walkTree(targetAbsolutePath, { signal })) {
    if (treeEntry.relativePath === "") continue;
    if (treeEntry.type === "file" && treeEntry.relativePath.endsWith(PART_SUFFIX)) {
      staleParts.push(treeEntry.relativePath);
      continue;
    }
    entries.set(foldCase ? treeEntry.relativePath.toLowerCase() : treeEntry.relativePath, {
      targetPath: treeEntry.relativePath,
      type: treeEntry.type,
      size: treeEntry.size,
      mtimeMs: treeEntry.mtimeMs,
      absolutePath: treeEntry.absolutePath,
    });
  }
  return { entries, staleParts };
}

async function hasSameContent(
  sourceEntry: TreeEntry,
  destinationEntry: DestinationEntry,
  compare: BackupCompare,
  signal?: AbortSignal,
): Promise<boolean> {
  if (destinationEntry.type !== "file" || destinationEntry.size !== sourceEntry.size) return false;
  if (compare === "checksum") {
    return (
      (await hashFile(sourceEntry.absolutePath, { signal })) ===
      (await hashFile(destinationEntry.absolutePath, { signal }))
    );
  }
  return Math.abs(destinationEntry.mtimeMs - sourceEntry.mtimeMs) <= MTIME_TOLERANCE_MILLISECONDS;
}

function hashPlan(mode: BackupMode, copy: readonly PlanEntry[], deletions: readonly PlanDeletion[]): string {
  const hash = createHash("sha256").update(mode);
  for (const entry of copy) hash.update(`\0${entry.type}\0${entry.targetPath}\0${entry.size}\0${entry.mtimeMs}`);
  for (const deletion of deletions) hash.update(`\0delete\0${deletion.targetPath}`);
  return hash.digest("hex");
}

/**
 * Works out what a backup run copies, skips and (mirror) deletes, without writing.
 *
 * - The source is walked without `.ccm-trash/` and `.ccm-tmp/`, `.git/` when `includeGit` is off,
 *   and whatever the exclude globs match.
 * - A file is unchanged when the destination has the same size and a modification time within
 *   2 s (FAT/exFAT precision), or the same sha256 with `compare: "checksum"`.
 * - Mirror lists destination entries the source doesn't have (excluded paths are left alone).
 * - The destination's file system decides the rest: names it can't hold are changed (and
 *   reported), names that differ only in case collide on case-insensitive drives (the second one
 *   is skipped and reported), and FAT32 skips files of 4 GiB or more.
 * - Free space must cover the bytes to copy minus the bytes they replace.
 *
 * @example
 * const plan = await buildPlan({ source: { absolutePath }, dest: { absolutePath, fsType: "exfat", freeBytes }, mode: "copy", options });
 */
export async function buildPlan({
  source,
  dest,
  mode,
  options,
  platform = process.platform,
  signal,
  onScan,
}: BuildPlanInput): Promise<BackupPlan> {
  const foldCase = isCaseInsensitiveFileSystem(dest.fsType, platform);
  const restrictNames = hasRestrictedNames(dest.fsType, platform);
  const isFat = isFatFileSystem(dest.fsType);
  const toKey = (targetPath: string) => (foldCase ? targetPath.toLowerCase() : targetPath);
  const isExcluded = createExcludeMatcher(options.excludes, options.includeGit);

  const destination = await readDestination(dest.absolutePath, { signal, foldCase });
  const copy: PlanEntry[] = [];
  const deletions: PlanDeletion[] = [];
  const replacements: PlanDeletion[] = [];
  const warnings: BackupWarning[] = [];
  /** Where each source folder goes on the destination (its name may have changed). */
  const targetFolders = new Map<string, string>([["", ""]]);
  /** Source folders whose contents are skipped (a collision or a file in the way). */
  const skippedFolders = new Set<string>();
  /** Destination paths the source accounts for: never deleted by a mirror. */
  const claimedKeys = new Set<string>();
  let skip = 0;
  let scanned = 0;

  for await (const sourceEntry of walkTree(source.absolutePath, { signal, skip: isExcluded })) {
    scanned += 1;
    if (scanned % 500 === 0) onScan?.(scanned);
    if (sourceEntry.relativePath === "") continue;
    if (isUnder(sourceEntry.relativePath, skippedFolders)) {
      if (sourceEntry.type === "directory") skippedFolders.add(sourceEntry.relativePath);
      continue;
    }
    const sourcePath = sourceEntry.relativePath;
    const name = readName(sourcePath);
    const targetName = restrictNames ? sanitizeName(name) : name;
    const targetParent = targetFolders.get(readParent(sourcePath)) ?? readParent(sourcePath);
    const targetPath = targetParent === "" ? targetName : `${targetParent}/${targetName}`;
    const isDirectory = sourceEntry.type === "directory";
    if (targetName !== name) {
      warnings.push({
        kind: "renamed",
        path: sourcePath,
        targetPath,
        message: `"${name}" isn't a valid name on this drive, so it's saved as "${targetName}".`,
      });
    }
    if (sourceEntry.isSpecial) {
      warnings.push({ kind: "special-file", path: sourcePath, message: "Sockets, pipes and devices aren't copied." });
      continue;
    }
    const key = toKey(targetPath);
    if (claimedKeys.has(key)) {
      warnings.push({
        kind: "case-collision",
        path: sourcePath,
        message: `Another item has the same name apart from upper and lower case, and this drive doesn't tell them apart. "${sourcePath}" is skipped.`,
      });
      if (isDirectory) skippedFolders.add(sourcePath);
      continue;
    }
    claimedKeys.add(key);
    const existing = destination.entries.get(key);
    const typeConflict = existing !== undefined && (existing.type === "directory") !== isDirectory;
    if (typeConflict) {
      if (mode !== "mirror") {
        warnings.push({
          kind: "type-conflict",
          path: sourcePath,
          message: `The destination has a ${existing.type === "directory" ? "folder" : "file"} named "${existing.targetPath}" where the source has a ${isDirectory ? "folder" : "file"}, so it's skipped.`,
        });
        if (isDirectory) skippedFolders.add(sourcePath);
        continue;
      }
      replacements.push({ targetPath: existing.targetPath, isDirectory: existing.type === "directory" });
    }
    const usable = typeConflict ? undefined : existing;
    if (isDirectory) {
      targetFolders.set(sourcePath, usable?.targetPath ?? targetPath);
      if (!usable) copy.push(toPlanEntry(sourceEntry, targetPath, 0));
      continue;
    }
    if (sourceEntry.type === "symlink") {
      if (!usable) copy.push(toPlanEntry(sourceEntry, targetPath, 0));
      continue;
    }
    if (isFat && sourceEntry.size > FAT32_FILE_LIMIT_BYTES) {
      warnings.push({
        kind: "too-large",
        path: sourcePath,
        message: "FAT32 drives can't hold files of 4 GB or more, so this file is skipped.",
      });
      continue;
    }
    if (usable && (await hasSameContent(sourceEntry, usable, options.compare, signal))) {
      skip += 1;
      continue;
    }
    copy.push(toPlanEntry(sourceEntry, usable?.targetPath ?? targetPath, usable?.type === "file" ? usable.size : 0));
  }
  onScan?.(scanned);

  if (mode === "mirror") {
    const deletedFolders = new Set(
      replacements.filter((replacement) => replacement.isDirectory).map((replacement) => replacement.targetPath),
    );
    for (const [key, destinationEntry] of destination.entries) {
      if (claimedKeys.has(key) || isExcluded(destinationEntry.targetPath)) continue;
      if (
        isUnder(destinationEntry.targetPath, deletedFolders) ||
        isUnderExcluded(destinationEntry.targetPath, isExcluded)
      )
        continue;
      deletions.push({ targetPath: destinationEntry.targetPath, isDirectory: destinationEntry.type === "directory" });
      if (destinationEntry.type === "directory") deletedFolders.add(destinationEntry.targetPath);
    }
  }

  let bytesTotal = 0;
  let replacedBytes = 0;
  let filesTotal = 0;
  for (const entry of copy) {
    if (entry.type !== "file") continue;
    bytesTotal += entry.size;
    replacedBytes += entry.replacesBytes;
    filesTotal += 1;
  }
  const requiredBytes = Math.max(0, bytesTotal - replacedBytes);
  return {
    copy,
    skip,
    delete: deletions,
    replace: replacements,
    staleParts: destination.staleParts,
    bytesTotal,
    filesTotal,
    warnings,
    requiredBytes,
    freeBytes: dest.freeBytes,
    insufficientSpace: requiredBytes > dest.freeBytes,
    hash: hashPlan(mode, copy, [...replacements, ...deletions]),
  };
}

function isUnderExcluded(targetPath: string, isExcluded: (relativePath: string) => boolean): boolean {
  for (let parent = readParent(targetPath); parent !== ""; parent = readParent(parent)) {
    if (isExcluded(parent)) return true;
  }
  return false;
}

function toPlanEntry(sourceEntry: TreeEntry, targetPath: string, replacesBytes: number): PlanEntry {
  return {
    sourcePath: sourceEntry.relativePath,
    targetPath,
    type: sourceEntry.type,
    size: sourceEntry.size,
    mtimeMs: sourceEntry.mtimeMs,
    mode: sourceEntry.mode,
    replacesBytes,
  };
}
