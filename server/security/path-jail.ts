import "server-only";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isLegacyHiddenName } from "@/lib/fs/legacy-names";
import { findNameProblem, RESERVED_CMM_NAMES } from "@/lib/fs/validate-name";
import { ApiRouteError, notFound } from "@/server/http/api-error";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Folder names CMM keeps for itself inside a storage; only internal services may address them. */
export const RESERVED_NAMES = RESERVED_CMM_NAMES;

const DRIVE_LETTER_PATTERN = /^[a-z]:/i;
const WINDOWS_INVALID_CHARACTER_PATTERN = /[<>:"|?*]/;

export interface JailedStorage {
  id: string;
  rootPath: string;
}

export interface ResolveOptions {
  /** The target may be missing (create, upload, rename target). Otherwise a missing target is 404. */
  forCreate?: boolean;
  /** Lets internal services reach `.cmm`, `.cmm-trash` and `.cmm-tmp`. */
  allowReserved?: boolean;
}

export interface ResolvedPath {
  /** Absolute path of the target, under the real root path, without following a final symlink. */
  absolutePath: string;
  /** Normalized POSIX path relative to the root; "" is the root itself. */
  relativePath: string;
  /** The root path with every symlink resolved. */
  rootPath: string;
  /** The target with every symlink resolved (inside the root), when it exists. Writes go here, so editing a linked file keeps the link. */
  realPath?: string;
}

export const outsideStorage = (message = "That path is outside the storage.") =>
  new ApiRouteError(403, "PATH_OUTSIDE_STORAGE", message);

const isCaseInsensitivePlatform = process.platform === "darwin" || process.platform === "win32";

/** Whether `candidatePath` is `rootPath` or inside it. Case-insensitive on macOS and Windows. */
export function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const comparableRoot = isCaseInsensitivePlatform ? rootPath.toLowerCase() : rootPath;
  const comparableCandidate = isCaseInsensitivePlatform ? candidatePath.toLowerCase() : candidatePath;
  if (comparableCandidate === comparableRoot) return true;
  const rootWithSeparator = comparableRoot.endsWith(path.sep) ? comparableRoot : comparableRoot + path.sep;
  return comparableCandidate.startsWith(rootWithSeparator);
}

/** Whether a single path segment is one of CMM's own folders (`.cmm`, `.cmm-trash`, `.cmm-tmp`, or their old `.ccm` names). */
export function isReservedName(segment: string): boolean {
  return (RESERVED_NAMES as readonly string[]).includes(segment.toLowerCase());
}

/** Whether `segment` is a hidden CMM folder, which listings, watchers and zips skip (`.cmm*`, and the old `.ccm*`). */
export function isHiddenCmmName(segment: string): boolean {
  return segment.toLowerCase().startsWith(".cmm") || isLegacyHiddenName(segment);
}

/**
 * Checks one file or folder name: not empty, no separators, no `..`, not a Windows reserved name,
 * no trailing dot or space, no control characters (and none of `<>:"|?*` on Windows). Throws
 * `PATH_OUTSIDE_STORAGE`.
 */
export function assertValidName(segment: string, { allowReserved = false } = {}): void {
  const nameProblem = findNameProblem(segment, { allowReserved });
  if (nameProblem) throw outsideStorage(nameProblem);
  if (process.platform === "win32" && WINDOWS_INVALID_CHARACTER_PATTERN.test(segment)) {
    throw outsideStorage("A name can't contain < > : \" | ? or *.");
  }
}

/**
 * Turns client input into normalized path segments. Backslashes count as separators, the input is
 * NFC-normalized, and NUL, absolute paths, drive letters and any `..` left after normalization
 * are rejected.
 */
export function normalizeRelativePath(relativeInput: string, { allowReserved = false } = {}): string[] {
  if (typeof relativeInput !== "string") throw outsideStorage();
  if (relativeInput.includes("\u0000")) throw outsideStorage("A path can't contain NUL.");
  const slashedInput = relativeInput.normalize("NFC").replaceAll("\\", "/");
  if (slashedInput.startsWith("/") || DRIVE_LETTER_PATTERN.test(slashedInput)) {
    throw outsideStorage("Paths are relative to the storage root.");
  }
  const normalizedPath = path.posix.normalize(slashedInput === "" ? "." : slashedInput);
  if (normalizedPath === ".") return [];
  const segments = normalizedPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  for (const segment of segments) {
    if (segment === "..") throw outsideStorage();
    assertValidName(segment, { allowReserved });
  }
  return segments;
}

const insideReservedFolder = () => outsideStorage("That path leads into CMM's own folders.");

/**
 * Whether a resolved real path lies in one of CMM's own folders, which a symlink inside the
 * storage could otherwise lead to even though the names in the request are fine.
 */
function reachesReservedFolder(rootPath: string, realTargetPath: string): boolean {
  return path
    .relative(rootPath, realTargetPath)
    .split(path.sep)
    .some((segment) => isReservedName(segment));
}

async function existsWithoutFollowing(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function realpathIfPresent(targetPath: string): Promise<string | undefined> {
  try {
    return await realpath(targetPath);
  } catch (realpathError) {
    const errorCode = (realpathError as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT" || errorCode === "ENOTDIR") return undefined;
    throw realpathError;
  }
}

/** The real path of a storage root, or 404 when it is missing (an unplugged drive, a deleted folder). */
export async function resolveRootPath(storage: JailedStorage): Promise<string> {
  const realRootPath = await realpathIfPresent(storage.rootPath);
  if (!realRootPath) throw notFound("This storage is not available right now.");
  return realRootPath;
}

/**
 * Resolves `relativeInput` inside `storage`. After the input checks, the nearest existing
 * ancestor is `realpath`-resolved and must still be inside the real root, so a symlink can't lead
 * out. A final symlink is followed for the check but not in the returned path, so rename and
 * delete act on the link itself. A broken final link counts as existing (creating over it fails
 * with EEXIST; atomic writes replace the link instead of following it); a broken link earlier in
 * the path is rejected. Throws `PATH_OUTSIDE_STORAGE`, or `NOT_FOUND` for a missing target unless
 * `forCreate` is set.
 */
export async function resolveInStorage(
  storage: JailedStorage,
  relativeInput: string,
  { forCreate = false, allowReserved = false }: ResolveOptions = {},
): Promise<ResolvedPath> {
  const segments = normalizeRelativePath(relativeInput, { allowReserved });
  const rootPath = await resolveRootPath(storage);
  const absolutePath = joinStoragePath(rootPath, ...segments);

  const missingSegments: string[] = [];
  let existingPath = absolutePath;
  let realExistingPath = await realpathIfPresent(existingPath);
  while (realExistingPath === undefined) {
    if (existingPath === rootPath) throw notFound("This storage is not available right now.");
    if (await existsWithoutFollowing(existingPath)) {
      if (existingPath !== absolutePath) throw outsideStorage("A link in that path is broken.");
      const realParentPath = await realpathIfPresent(path.dirname(existingPath));
      if (!realParentPath || !isInsideRoot(rootPath, realParentPath)) throw outsideStorage();
      if (!allowReserved && reachesReservedFolder(rootPath, realParentPath)) throw insideReservedFolder();
      return { absolutePath, relativePath: segments.join("/"), rootPath };
    }
    missingSegments.unshift(path.basename(existingPath));
    existingPath = path.dirname(existingPath);
    realExistingPath = await realpathIfPresent(existingPath);
  }
  if (!isInsideRoot(rootPath, realExistingPath)) throw outsideStorage();
  if (!allowReserved && reachesReservedFolder(rootPath, realExistingPath)) throw insideReservedFolder();
  if (missingSegments.length > 0 && !forCreate) throw notFound("That file or folder does not exist.");
  if (missingSegments.length > 0 && !isInsideRoot(rootPath, joinStoragePath(realExistingPath, ...missingSegments))) {
    throw outsideStorage();
  }
  return {
    absolutePath,
    relativePath: segments.join("/"),
    rootPath,
    realPath: missingSegments.length === 0 ? realExistingPath : undefined,
  };
}

/** Joins a parent path and a child name into a storage-relative POSIX path. */
export function joinRelativePath(parentPath: string, childName: string): string {
  return parentPath === "" ? childName : `${parentPath}/${childName}`;
}

/** The parent of a storage-relative path ("" for top-level entries). */
export function parentRelativePath(relativePath: string): string {
  const slashIndex = relativePath.lastIndexOf("/");
  return slashIndex === -1 ? "" : relativePath.slice(0, slashIndex);
}
