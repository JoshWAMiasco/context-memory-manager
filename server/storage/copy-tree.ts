import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, readdir, readlink, rm, stat, symlink, utimes } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import { isHiddenCcmName } from "@/server/security/path-jail";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Root-level folders a copy, zip or size walk never includes. `.ccm/` folder metadata is kept: it travels with the folder. */
const SKIPPED_TREE_NAMES = new Set([".ccm-trash", ".ccm-tmp"]);

export interface TreeEntry {
  /** Path relative to the walked folder, with `/` separators; "" for the folder itself. */
  relativePath: string;
  absolutePath: string;
  type: "file" | "directory" | "symlink";
  size: number;
  mtimeMs: number;
  mode: number;
  device: number;
  /** A socket, FIFO or device node: listed as a "file", but never something to copy. */
  isSpecial: boolean;
}

export interface WalkOptions {
  /** Also skip `.ccm/`, `.git` and the operating system's metadata files (zip downloads). */
  skipMetadata?: boolean;
  /** Also skip these entries (and everything inside them); gets the path relative to the walked folder. */
  skip?: (relativePath: string) => boolean;
  signal?: AbortSignal;
}

/** A folder's protection files: a copy is a new, unprotected folder, so they never travel with it. */
const PROTECTION_FILE_PATTERN = /^protection(-modes(\.\d+)?)?\.json$/;

function shouldSkip(entryName: string, skipMetadata: boolean, parentName: string): boolean {
  if (SKIPPED_TREE_NAMES.has(entryName.toLowerCase())) return true;
  if (parentName === ".ccm" && PROTECTION_FILE_PATTERN.test(entryName)) return true;
  return skipMetadata && (isHiddenCcmName(entryName) || entryName === ".git" || isSystemMetadataName(entryName));
}

/**
 * Walks a file or folder without following symlinks, parents before children, names sorted (a
 * folder's `.ccm/` first), so a resumed job sees the same order. Protection files in `.ccm/` are
 * never included.
 */
export async function* walkTree(rootAbsolutePath: string, options: WalkOptions = {}): AsyncGenerator<TreeEntry> {
  const pendingPaths = [""];
  while (pendingPaths.length > 0) {
    options.signal?.throwIfAborted();
    const relativePath = pendingPaths.shift() ?? "";
    const absolutePath =
      relativePath === "" ? rootAbsolutePath : joinStoragePath(rootAbsolutePath, ...relativePath.split("/"));
    const entryStats = await lstat(absolutePath);
    const type = entryStats.isSymbolicLink() ? "symlink" : entryStats.isDirectory() ? "directory" : "file";
    yield {
      relativePath,
      absolutePath,
      type,
      size: type === "file" ? entryStats.size : 0,
      mtimeMs: entryStats.mtimeMs,
      mode: entryStats.mode,
      device: entryStats.dev,
      isSpecial: type === "file" && !entryStats.isFile(),
    };
    if (type !== "directory") continue;
    // `.ccm/` comes first, so a copied folder is an encrypted folder before its files arrive.
    const childNames = (await readdir(absolutePath)).toSorted((first, second) =>
      first === ".ccm" ? -1 : second === ".ccm" ? 1 : first < second ? -1 : first > second ? 1 : 0,
    );
    const childPaths = childNames
      .filter(
        (childName) => !shouldSkip(childName, Boolean(options.skipMetadata), relativePath.split("/").at(-1) ?? ""),
      )
      .map((childName) => (relativePath === "" ? childName : `${relativePath}/${childName}`))
      .filter((childPath) => !options.skip?.(childPath));
    pendingPaths.unshift(...childPaths);
  }
}

/** Total bytes and entry count of a file or folder; also reports whether a mount point sits inside it. */
export async function measureTree(
  rootAbsolutePath: string,
  signal?: AbortSignal,
): Promise<{ size: number; entryCount: number; containsMountPoint: boolean }> {
  let size = 0;
  let entryCount = 0;
  let rootDevice: number | undefined;
  let containsMountPoint = false;
  for await (const treeEntry of walkTree(rootAbsolutePath, { signal })) {
    rootDevice ??= treeEntry.device;
    if (treeEntry.device !== rootDevice) containsMountPoint = true;
    size += treeEntry.size;
    entryCount += 1;
  }
  return { size, entryCount, containsMountPoint };
}

async function existsWithoutFollowing(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/** Splits "report.final.md" into "report.final" and ".md"; folders and dotfiles keep their whole name. */
function splitName(entryName: string, isDirectory: boolean): [string, string] {
  const dotIndex = entryName.lastIndexOf(".");
  if (isDirectory || dotIndex <= 0) return [entryName, ""];
  return [entryName.slice(0, dotIndex), entryName.slice(dotIndex)];
}

/**
 * The first free name in `directoryPath`: `entryName` itself, then "name (word).ext",
 * "name (word 2).ext", and so on.
 *
 * @example
 * await findAvailableName("/data/docs", "report.md", "restored", false); // "report (restored).md" when "report.md" exists
 */
export async function findAvailableName(
  directoryPath: string,
  entryName: string,
  word: string,
  isDirectory: boolean,
): Promise<string> {
  if (!(await existsWithoutFollowing(joinStoragePath(directoryPath, entryName)))) return entryName;
  const [baseName, extension] = splitName(entryName, isDirectory);
  for (let attempt = 1; ; attempt += 1) {
    const candidateName = `${baseName} (${word}${attempt === 1 ? "" : ` ${attempt}`})${extension}`;
    if (!(await existsWithoutFollowing(joinStoragePath(directoryPath, candidateName)))) return candidateName;
  }
}

/** Counts bytes passing through, for progress. */
export function createByteCounter(onBytes: (byteCount: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length);
      callback(null, chunk);
    },
  });
}

export interface CopyFileOptions {
  signal?: AbortSignal;
  onBytes?: (byteCount: number) => void;
  /** Read transforms then write transforms from the FS pipeline. */
  transforms?: Transform[];
  /** Fail when the target exists (default true). */
  exclusive?: boolean;
}

/**
 * Streams one file to `targetPath`, keeping its mode (plus the owner's write bit, so a copy out of
 * a protected folder isn't read-only) and modification time. A failed or cancelled copy removes
 * the partial target.
 */
export async function copyFileContents(
  sourcePath: string,
  targetPath: string,
  { signal, onBytes, transforms = [], exclusive = true }: CopyFileOptions = {},
): Promise<void> {
  const sourceStats = await stat(sourcePath);
  const streams: (NodeJS.ReadableStream | NodeJS.ReadWriteStream | NodeJS.WritableStream)[] = [
    createReadStream(sourcePath),
    ...transforms,
  ];
  if (onBytes) streams.push(createByteCounter(onBytes));
  const targetMode = (sourceStats.mode & 0o777) | 0o200;
  const targetStream = createWriteStream(targetPath, { flags: exclusive ? "wx" : "w", mode: targetMode });
  try {
    await pipeline([...streams, targetStream], { signal });
  } catch (copyError) {
    if ((copyError as NodeJS.ErrnoException).code !== "EEXIST") await rm(targetPath, { force: true });
    throw copyError;
  }
  await chmod(targetPath, (sourceStats.mode & 0o7777) | 0o200).catch(() => undefined);
  await utimes(targetPath, sourceStats.atime, sourceStats.mtime).catch(() => undefined);
}

/** Recreates a symlink with the same target text. Systems that refuse symlinks (Windows without the right) skip it. */
export async function copySymlink(sourcePath: string, targetPath: string): Promise<void> {
  const linkTarget = await readlink(sourcePath);
  try {
    await symlink(linkTarget, targetPath);
  } catch (linkError) {
    if ((linkError as NodeJS.ErrnoException).code === "EPERM") return;
    throw linkError;
  }
}

/**
 * Creates a folder with the source folder's mode plus the owner's write bit (a copy out of a
 * protected folder must stay writable). Existing folders are fine (a resumed copy).
 */
export async function copyDirectoryShell(sourceMode: number, targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true, mode: (sourceMode & 0o777) | 0o200 });
}
