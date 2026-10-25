import "server-only";
import { randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream, type Stats } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, opendir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline as connectStreams, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  DirectoryListing,
  FileBadges,
  FileEntry,
  FileStat,
  JobSummary,
  LineEnding,
  TextFileResponse,
  TrashItem,
} from "@/lib/api-types";
import { describeFileKind, type FileKindInfo } from "@/lib/file-kinds";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import { plaintextSize, readFileHeader } from "@/server/crypto/format";
import { readUnlockExpiry } from "@/server/crypto/keyring";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { parseByteRange } from "@/server/http/byte-range";
import { ensureFileCopyJobType, type StoragePathReference } from "@/server/jobs/fs-copy";
import { getJobQueue } from "@/server/jobs/queue";
import {
  assertValidName,
  isHiddenCcmName,
  joinRelativePath,
  parentRelativePath,
  resolveInStorage,
  type ResolvedPath,
} from "@/server/security/path-jail";
import { copyFileContents, copySymlink, findAvailableName } from "@/server/storage/copy-tree";
import { findEncryptionScope, readListingBadges, readVersioningEnabled } from "@/server/meta/effective";
import { readEntryBadges } from "@/server/storage/meta-badges";
import {
  collectTransferTransforms,
  collectTransforms,
  openTransformedRange,
  requiresContentCopy,
  runAfterHooks,
  runGuards,
  verifyWrittenFile,
  type FileActor,
  type FileOperation,
} from "@/server/storage/pipeline";
import { readAccessLevel, requireStorageAccess, type ActiveStorage } from "@/server/storage/roots";
import { SNIFF_BYTES, sniffBuffer, sniffFile } from "@/server/storage/sniff";
import { moveToTrash } from "@/server/trash";
import { joinStoragePath } from "@/server/storage/storage-path";
import { recordVersionedScope } from "@/server/versioning/scope";

export const LIST_PAGE_SIZE = 5000;
export const TEXT_EDIT_LIMIT_BYTES = 5 * 1024 * 1024;
export const TEMPORARY_DIRECTORY = ".ccm-tmp";
/** Inline copies stop here; anything bigger runs as a job with progress. */
export const INLINE_COPY_LIMIT_BYTES = 64 * 1024 * 1024;

const STAT_CONCURRENCY = 64;

/** The weak ETag of a file: `W/"<size>-<mtimeMs>"` (overview §8). */
export function buildEtag(fileStats: Pick<Stats, "size" | "mtimeMs">): string {
  return `W/"${fileStats.size}-${fileStats.mtimeMs}"`;
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  mapItem: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      results[itemIndex] = await mapItem(items[itemIndex] as Item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, items.length) }, worker));
  return results;
}

async function hasVisibleChildren(directoryPath: string): Promise<boolean> {
  try {
    const directoryHandle = await opendir(directoryPath);
    try {
      for await (const childEntry of directoryHandle) {
        if (!isHiddenCcmName(childEntry.name) && !isSystemMetadataName(childEntry.name)) return true;
      }
    } finally {
      await directoryHandle.close().catch(() => undefined);
    }
  } catch {
    return false;
  }
  return false;
}

/** Stats a path, following a symlink inside the storage; a broken link reads as an empty file. */
async function statFollowingLinks(absolutePath: string): Promise<Stats> {
  try {
    return await stat(absolutePath);
  } catch {
    return lstat(absolutePath);
  }
}

/**
 * The size clients see for a file: inside an encrypted folder, an encrypted file's plaintext size
 *. `isPlaintext` marks a file there that is still plaintext on disk.
 */
async function readVisibleSize(
  absolutePath: string,
  fileStats: Pick<Stats, "size">,
  isInEncryptedFolder: boolean,
): Promise<{ size: number; isPlaintext: boolean }> {
  if (!isInEncryptedFolder) return { size: fileStats.size, isPlaintext: false };
  if (!(await readFileHeader(absolutePath))) return { size: fileStats.size, isPlaintext: true };
  try {
    return { size: plaintextSize(fileStats.size), isPlaintext: false };
  } catch {
    return { size: 0, isPlaintext: false };
  }
}

/** A file's visible (plaintext) size and the ETag built from it and its mtime. */
async function readContentVersion(
  resolvedPath: ResolvedPath,
  fileStats: Stats,
): Promise<{ size: number; etag: string }> {
  const scope = await findEncryptionScope(resolvedPath.rootPath, path.dirname(resolvedPath.absolutePath));
  const { size } = await readVisibleSize(resolvedPath.absolutePath, fileStats, scope !== undefined);
  return { size, etag: buildEtag({ size, mtimeMs: fileStats.mtimeMs }) };
}

async function toFileEntry(
  rootPath: string,
  absolutePath: string,
  relativePath: string,
  { entryStats, badges, actor }: { entryStats?: Stats; badges?: FileBadges; actor?: FileActor } = {},
): Promise<FileEntry> {
  const fileStats = entryStats ?? (await statFollowingLinks(absolutePath));
  const name = relativePath === "" ? "" : path.posix.basename(relativePath);
  const isDirectory = fileStats.isDirectory();
  const entryBadges = badges ?? (await readEntryBadges(rootPath, relativePath, isDirectory));
  let size = isDirectory ? 0 : fileStats.size;
  if (entryBadges.encryption) {
    const encryption = { ...entryBadges.encryption };
    encryption.unlocked = readUnlockExpiry(actor?.sessionIdHash, encryption.folderId) !== undefined;
    if (!isDirectory) {
      const visible = await readVisibleSize(absolutePath, fileStats, true);
      size = visible.size;
      if (visible.isPlaintext) encryption.plaintext = true;
    }
    entryBadges.encryption = encryption;
  }
  return {
    name,
    path: relativePath,
    type: isDirectory ? "directory" : "file",
    size,
    mtimeMs: fileStats.mtimeMs,
    createdMs: fileStats.birthtimeMs > 0 ? fileStats.birthtimeMs : fileStats.ctimeMs,
    kind: isDirectory ? "folder" : describeFileKind(name).kind,
    hasChildren: isDirectory ? await hasVisibleChildren(absolutePath) : false,
    badges: entryBadges,
  };
}

function compareEntries(first: { name: string; isDirectory: boolean }, second: { name: string; isDirectory: boolean }) {
  if (first.isDirectory !== second.isDirectory) return first.isDirectory ? -1 : 1;
  return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" });
}

function buildOperation(
  type: FileOperation["type"],
  storage: ActiveStorage,
  resolvedPath: ResolvedPath,
  actor: FileActor,
  extra: Partial<FileOperation> = {},
): FileOperation {
  return {
    type,
    storageId: storage.id,
    path: resolvedPath.relativePath,
    absolutePath: resolvedPath.absolutePath,
    actor,
    ...extra,
  };
}

async function requireDirectory(absolutePath: string): Promise<void> {
  if (!(await stat(absolutePath)).isDirectory()) throw validationFailed("That path is not a folder.");
}

async function requireFile(resolvedPath: ResolvedPath): Promise<Stats> {
  const fileStats = await stat(resolvedPath.absolutePath);
  if (fileStats.isDirectory()) throw validationFailed("That path is a folder, not a file.");
  return fileStats;
}

function emitChange(storageId: string, relativePath: string, change: "added" | "changed" | "removed"): void {
  getEventBus().emit("fs.changed", { storageId, path: relativePath, change });
}

/**
 * Lists a folder: folders first, then files, by name with numbers in order. CCM's own
 * `.ccm*` entries are hidden, and so is the `.git` of a versioned folder, which CCM manages,
 * and the operating system's metadata (`._name`, `.DS_Store`: `isSystemMetadataName`). Folders
 * with more than 5,000 entries come in pages: pass back `nextCursor` for the next one.
 */
export async function listDirectory(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
  { cursor, limit = LIST_PAGE_SIZE }: { cursor?: string; limit?: number } = {},
): Promise<DirectoryListing> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  await requireDirectory(resolvedPath.absolutePath);
  await runGuards(buildOperation("list", storage, resolvedPath, actor, { isDirectory: true }));
  const isVersioned = await readVersioningEnabled(resolvedPath.absolutePath);
  if (isVersioned) recordVersionedScope(storage.id, resolvedPath.relativePath);
  const directoryEntries = (await readdir(resolvedPath.absolutePath, { withFileTypes: true }))
    .filter((directoryEntry) => !isHiddenCcmName(directoryEntry.name) && !isSystemMetadataName(directoryEntry.name))
    .filter((directoryEntry) => !(isVersioned && directoryEntry.name === ".git"))
    .map((directoryEntry) => ({ name: directoryEntry.name, isDirectory: directoryEntry.isDirectory() }))
    .toSorted(compareEntries);
  const offset = cursor ? Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw validationFailed("The cursor is not valid.");
  const pageEntries = directoryEntries.slice(offset, offset + limit);
  const pageBadges = await readListingBadges(resolvedPath.rootPath, resolvedPath.relativePath, pageEntries);
  for (const [entryIndex, badges] of pageBadges.entries()) {
    const pageEntry = pageEntries[entryIndex];
    if (badges.versioned && pageEntry) {
      recordVersionedScope(storage.id, joinRelativePath(resolvedPath.relativePath, pageEntry.name));
    }
  }
  const entries = await mapWithConcurrency(pageEntries, (directoryEntry) =>
    toFileEntry(
      resolvedPath.rootPath,
      joinStoragePath(resolvedPath.absolutePath, directoryEntry.name),
      joinRelativePath(resolvedPath.relativePath, directoryEntry.name),
      { badges: pageBadges[pageEntries.indexOf(directoryEntry)], actor },
    ),
  );
  const listing: DirectoryListing = { storageId: storage.id, path: resolvedPath.relativePath, entries };
  if (offset + limit < directoryEntries.length) {
    listing.nextCursor = Buffer.from(String(offset + limit), "utf8").toString("base64url");
  }
  return listing;
}

/** Why a protected entry can't be changed, for `permissions.reason` and API errors. */
export function describeProtectionReason(
  mode: "view-only" | "locked",
  isOwnSetting: boolean,
  type: FileEntry["type"],
): string {
  const label = mode === "locked" ? "locked" : "view-only";
  if (isOwnSetting) return `This ${type === "file" ? "file" : "folder"} is ${label}.`;
  return `This is inside a ${label} folder.`;
}

/** One entry with its ETag, what `actor` may do with it, and for files a sniff of the first 8 KB. */
export async function statEntry(storage: ActiveStorage, relativePath: string, actor: FileActor): Promise<FileStat> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  await runGuards(buildOperation("stat", storage, resolvedPath, actor));
  const entryStats = await statFollowingLinks(resolvedPath.absolutePath);
  const entry = await toFileEntry(resolvedPath.rootPath, resolvedPath.absolutePath, resolvedPath.relativePath, {
    entryStats,
    actor,
  });
  const permissions: FileStat["permissions"] = { read: true, write: readAccessLevel(actor, storage) === "write" };
  if (!permissions.write) {
    permissions.reason = "You can only view files in this storage.";
  } else if (entry.badges.protection !== "none") {
    permissions.write = false;
    permissions.reason = describeProtectionReason(
      entry.badges.protection,
      entry.badges.protectionSource === "self",
      entry.type,
    );
  } else if (
    !(await access(resolvedPath.absolutePath, constants.W_OK).then(
      () => true,
      () => false,
    ))
  ) {
    permissions.write = false;
    permissions.reason = "The file is read-only on disk.";
  }
  const etag = buildEtag(entry.type === "file" ? { size: entry.size, mtimeMs: entryStats.mtimeMs } : entryStats);
  const fileStat: FileStat = { entry, etag, permissions };
  if (entry.type === "file") fileStat.sniff = await sniffContent(storage, resolvedPath, entry, actor);
  return fileStat;
}

/**
 * The absolute path of an existing entry, for "Reveal in Finder / Explorer / Files" in the desktop
 * app. Goes through the path jail and the same guards as `stat`; the caller checks the mode.
 */
export async function readAbsolutePath(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
): Promise<string> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  await runGuards(buildOperation("stat", storage, resolvedPath, actor));
  return resolvedPath.absolutePath;
}

/** Sniffs a file's first bytes; an encrypted file is sniffed decrypted, and not at all while locked. */
async function sniffContent(
  storage: ActiveStorage,
  resolvedPath: ResolvedPath,
  entry: FileEntry,
  actor: FileActor,
): Promise<FileStat["sniff"]> {
  const encryption = entry.badges.encryption;
  if (!encryption || encryption.plaintext) return sniffFile(resolvedPath.absolutePath).catch(() => undefined);
  if (!encryption.unlocked) return undefined;
  try {
    const operation = buildOperation("read", storage, resolvedPath, actor);
    const stream = await openTransformedRange(operation, { start: 0, end: SNIFF_BYTES - 1 });
    return stream ? sniffBuffer(await readStreamToBuffer(stream)) : undefined;
  } catch {
    return undefined;
  }
}

async function readStreamToBuffer(readable: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/** Opens a file's content through the read transforms (decryption); ranges of transformed content too. */
async function openContentStream(
  operation: FileOperation,
  range?: { start: number; end: number },
): Promise<{ stream: Readable; isTransformed: boolean; isRangeHonored: boolean }> {
  const transforms = await collectTransforms("read", operation);
  if (transforms.length === 0) {
    return { stream: createReadStream(operation.absolutePath, range), isTransformed: false, isRangeHonored: true };
  }
  if (range) {
    const rangeStream = await openTransformedRange(operation, range);
    if (rangeStream) {
      for (const transform of transforms) transform.destroy();
      return { stream: rangeStream, isTransformed: true, isRangeHonored: true };
    }
  }
  const stream = transforms.reduce<Readable>(
    (previousStream, transform) => connectStreams(previousStream, transform, () => undefined),
    createReadStream(operation.absolutePath),
  );
  return { stream, isTransformed: true, isRangeHonored: false };
}

/**
 * Reads a text file for the editor: up to 5 MB (413 `TOO_LARGE_TO_EDIT`), UTF-8 only (415
 * `BINARY_FILE` otherwise). The content comes back with `\n` line breaks; `lineEnding` and
 * `encoding` say how to write it back.
 */
export async function readTextFile(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
  { maxBytes = TEXT_EDIT_LIMIT_BYTES }: { maxBytes?: number } = {},
): Promise<TextFileResponse> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const fileStats = await requireFile(resolvedPath);
  const operation = buildOperation("read", storage, resolvedPath, actor);
  await runGuards(operation);
  const { size: visibleSize, etag } = await readContentVersion(resolvedPath, fileStats);
  if (visibleSize > maxBytes) {
    throw new ApiRouteError(413, "TOO_LARGE_TO_EDIT", "This file is too large to edit here. Download it instead.", {
      size: visibleSize,
      limit: maxBytes,
    });
  }
  const { stream } = await openContentStream(operation);
  const contentBuffer = await readStreamToBuffer(stream);
  const sniffResult = sniffBuffer(contentBuffer);
  if (sniffResult.isBinary || !sniffResult.isUtf8) {
    throw new ApiRouteError(415, "BINARY_FILE", "This file is not UTF-8 text, so it can't be edited here.");
  }
  const text = contentBuffer.subarray(sniffResult.hasBom ? 3 : 0).toString("utf8");
  return {
    content: text.replaceAll("\r\n", "\n"),
    etag,
    lineEnding: sniffResult.lineEnding,
    encoding: sniffResult.hasBom ? "utf-8-bom" : "utf-8",
  };
}

export interface FileReadStream {
  stream: Readable;
  size: number;
  etag: string;
  kindInfo: FileKindInfo;
  fileName: string;
  /** The byte range served, when a range was asked for and honored. */
  range?: { start: number; end: number };
  /** Set when a read transform changes the content (decryption); `size` is still the length sent. */
  isTransformed: boolean;
}

/**
 * Streams a file (raw view, download): decrypted when it is encrypted, or as stored with
 * `asStored`. `rangeHeader` is an HTTP `Range` value, read against the size clients see.
 */
export async function openFileReadStream(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
  { rangeHeader, asStored = false }: { rangeHeader?: string | null; asStored?: boolean } = {},
): Promise<FileReadStream> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const fileStats = await requireFile(resolvedPath);
  const operation = buildOperation("read", storage, resolvedPath, actor, { asStored });
  await runGuards(operation);
  const fileName = path.basename(resolvedPath.absolutePath);
  const { size } = asStored ? { size: fileStats.size } : await readContentVersion(resolvedPath, fileStats);
  const contentRange = parseByteRange(rangeHeader ?? null, size);
  const { stream, isTransformed, isRangeHonored } = await openContentStream(operation, contentRange);
  return {
    stream,
    size,
    etag: buildEtag({ size, mtimeMs: fileStats.mtimeMs }),
    kindInfo: describeFileKind(fileName),
    fileName,
    range: contentRange && isRangeHonored ? contentRange : undefined,
    isTransformed,
  };
}

async function checkIfMatch(
  resolvedPath: ResolvedPath,
  currentStats: Stats | undefined,
  ifMatch: string | undefined,
): Promise<void> {
  if (ifMatch === undefined) return;
  const currentEtag = currentStats ? (await readContentVersion(resolvedPath, currentStats)).etag : undefined;
  if (currentEtag !== ifMatch.trim()) {
    throw new ApiRouteError(412, "ETAG_MISMATCH", "The file changed since you opened it.", {
      etag: currentEtag ?? null,
    });
  }
}

/**
 * Writes `content` to `targetPath` atomically: into `<root>/.ccm-tmp/<uuid>` through the write
 * transforms (encryption), with fsync and the `verifyWrite` hooks (the new ciphertext is
 * authenticated), then a rename over the target, so a crash never leaves a half-written
 * file or a mix of old and new. The target's mode is kept.
 * If the target sits on another device than the root (a drive mounted inside the storage), the
 * temporary file is staged next to the target instead.
 */
export async function writeAtomically(
  rootPath: string,
  targetPath: string,
  content: Readable | Buffer,
  operation: FileOperation,
): Promise<Stats> {
  const temporaryDirectory = joinStoragePath(rootPath, TEMPORARY_DIRECTORY);
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = joinStoragePath(temporaryDirectory, randomUUID());
  const existingStats = await stat(targetPath).catch(() => undefined);
  const transforms = await collectTransforms("write", operation);
  const source = Buffer.isBuffer(content) ? Readable.from([content]) : content;
  try {
    await pipeline([source, ...transforms, createWriteStream(temporaryPath, { flush: true, mode: 0o644 })]);
    await verifyWrittenFile(operation, temporaryPath);
    if (existingStats) await chmod(temporaryPath, existingStats.mode & 0o7777).catch(() => undefined);
    try {
      await rename(temporaryPath, targetPath);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EXDEV") throw renameError;
      const siblingPath = joinStoragePath(path.dirname(targetPath), `${TEMPORARY_DIRECTORY}-${randomUUID()}`);
      await copyFile(temporaryPath, siblingPath);
      await rename(siblingPath, targetPath);
      await rm(temporaryPath, { force: true });
    }
  } catch (writeError) {
    await rm(temporaryPath, { force: true });
    throw writeError;
  }
  return stat(targetPath);
}

export interface WriteTextOptions {
  /** The ETag the client read; a different current ETag is 412 `ETAG_MISMATCH`. */
  ifMatch?: string;
  lineEnding?: LineEnding;
  encoding?: "utf-8" | "utf-8-bom";
}

/** Saves text from the editor, converting `\n` to the file's line endings and adding the BOM back if it had one. */
export async function writeTextFile(
  storage: ActiveStorage,
  relativePath: string,
  content: string,
  actor: FileActor,
  { ifMatch, lineEnding = "lf", encoding = "utf-8" }: WriteTextOptions = {},
): Promise<FileStat> {
  const normalizedContent = content.replaceAll("\r\n", "\n");
  const lineEndedContent = lineEnding === "crlf" ? normalizedContent.replaceAll("\n", "\r\n") : normalizedContent;
  const contentBuffer = Buffer.concat([
    encoding === "utf-8-bom" ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(lineEndedContent, "utf8"),
  ]);
  return writeFileContent(storage, relativePath, contentBuffer, actor, { ifMatch });
}

/** Replaces (or creates) a file's content from a buffer or stream, atomically, with an optional `If-Match` check. */
export async function writeFileContent(
  storage: ActiveStorage,
  relativePath: string,
  content: Readable | Buffer,
  actor: FileActor,
  { ifMatch }: { ifMatch?: string } = {},
): Promise<FileStat> {
  const resolvedPath = await resolveInStorage(storage, relativePath, { forCreate: true });
  if (resolvedPath.relativePath === "") throw validationFailed("That path is a folder, not a file.");
  const targetPath = resolvedPath.realPath ?? resolvedPath.absolutePath;
  const currentStats = await stat(targetPath).catch(() => undefined);
  if (currentStats?.isDirectory()) throw validationFailed("That path is a folder, not a file.");
  await checkIfMatch(resolvedPath, currentStats, ifMatch);
  const operation = buildOperation("write", storage, resolvedPath, actor);
  await runGuards(operation);
  await requireDirectory(path.dirname(resolvedPath.absolutePath));
  await writeAtomically(resolvedPath.rootPath, targetPath, content, operation);
  emitChange(storage.id, resolvedPath.relativePath, currentStats ? "changed" : "added");
  await runAfterHooks(operation);
  return statEntry(storage, resolvedPath.relativePath, actor);
}

/** Creates a new file (409 `ALREADY_EXISTS` when the name is taken). The parent folder must exist. */
export async function createFile(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
  content = "",
): Promise<FileEntry> {
  const resolvedPath = await resolveInStorage(storage, relativePath, { forCreate: true });
  if (resolvedPath.relativePath === "") throw validationFailed("Enter a file name.");
  const operation = buildOperation("create", storage, resolvedPath, actor, { isDirectory: false });
  await runGuards(operation);
  await requireDirectory(path.dirname(resolvedPath.absolutePath));
  await writeFile(resolvedPath.absolutePath, "", { flag: "wx", mode: 0o644 });
  const writeOperation = { ...operation, type: "write" as const };
  if (content !== "" || (await collectTransforms("write", writeOperation)).length > 0) {
    await writeAtomically(
      resolvedPath.rootPath,
      resolvedPath.absolutePath,
      Buffer.from(content, "utf8"),
      writeOperation,
    );
  }
  emitChange(storage.id, resolvedPath.relativePath, "added");
  await runAfterHooks(operation);
  return toFileEntry(resolvedPath.rootPath, resolvedPath.absolutePath, resolvedPath.relativePath, { actor });
}

/** Creates a folder. The parent must exist; an existing name is 409 `ALREADY_EXISTS`. */
export async function createDirectory(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
): Promise<FileEntry> {
  const resolvedPath = await resolveInStorage(storage, relativePath, { forCreate: true });
  if (resolvedPath.relativePath === "") throw validationFailed("Enter a folder name.");
  const operation = buildOperation("mkdir", storage, resolvedPath, actor, { isDirectory: true });
  await runGuards(operation);
  await mkdir(resolvedPath.absolutePath, { mode: 0o755 });
  emitChange(storage.id, resolvedPath.relativePath, "added");
  await runAfterHooks(operation);
  return toFileEntry(resolvedPath.rootPath, resolvedPath.absolutePath, resolvedPath.relativePath, { actor });
}

async function isSameEntry(firstPath: string, secondPath: string): Promise<boolean> {
  const [firstStats, secondStats] = await Promise.all([lstat(firstPath), lstat(secondPath).catch(() => undefined)]);
  return secondStats !== undefined && firstStats.ino === secondStats.ino && firstStats.dev === secondStats.dev;
}

/** Renames an entry within its folder. A case-only rename ("a.md" → "A.md") works on case-insensitive disks. */
export async function renameEntry(
  storage: ActiveStorage,
  relativePath: string,
  newName: string,
  actor: FileActor,
): Promise<FileEntry> {
  assertValidName(newName);
  const source = await resolveInStorage(storage, relativePath);
  if (source.relativePath === "") throw validationFailed("A storage's root folder can't be renamed.");
  const target = await resolveInStorage(storage, joinRelativePath(parentRelativePath(source.relativePath), newName), {
    forCreate: true,
  });
  if (target.relativePath === source.relativePath) {
    return toFileEntry(source.rootPath, source.absolutePath, source.relativePath, { actor });
  }
  const targetExists = await lstat(target.absolutePath).then(
    () => true,
    () => false,
  );
  if (targetExists && !(await isSameEntry(source.absolutePath, target.absolutePath))) {
    throw new ApiRouteError(409, "ALREADY_EXISTS", `"${newName}" already exists in this folder.`);
  }
  const sourceStats = await lstat(source.absolutePath);
  const operation = buildOperation("rename", storage, source, actor, {
    isDirectory: sourceStats.isDirectory(),
    destination: { storageId: storage.id, path: target.relativePath, absolutePath: target.absolutePath },
  });
  await runGuards(operation);
  await rename(source.absolutePath, target.absolutePath);
  emitChange(storage.id, source.relativePath, "removed");
  emitChange(storage.id, target.relativePath, "added");
  await runAfterHooks(operation);
  return toFileEntry(target.rootPath, target.absolutePath, target.relativePath, { actor });
}

export interface TransferOptions {
  conflict?: "fail" | "keep-both";
  /** The user confirmed that a copy or move out of an encrypted folder is decrypted. */
  confirmDecrypt?: boolean;
}

export interface TransferResult {
  /** Paths created right away in the destination storage. */
  paths: string[];
  /** The job doing the rest (folders, big files, other drives). */
  job?: JobSummary;
}

async function readDestinationFolder(
  actor: FileActor,
  destination: StoragePathReference,
): Promise<{ storage: ActiveStorage; folder: ResolvedPath }> {
  const destinationStorage = requireStorageAccess(actor, destination.storageId, "write");
  const folder = await resolveInStorage(destinationStorage, destination.path);
  await requireDirectory(folder.absolutePath);
  return { storage: destinationStorage, folder };
}

async function pickTargetName(
  folderPath: string,
  sourceName: string,
  isDirectory: boolean,
  conflict: "fail" | "keep-both",
): Promise<string> {
  if (conflict === "keep-both") return findAvailableName(folderPath, sourceName, "copy", isDirectory);
  if (
    await lstat(joinStoragePath(folderPath, sourceName)).then(
      () => true,
      () => false,
    )
  ) {
    throw new ApiRouteError(409, "ALREADY_EXISTS", `"${sourceName}" already exists in the destination.`);
  }
  return sourceName;
}

/**
 * Runs the guards for sources that go to an `fs.copy` job before it is queued, so a refused folder
 * (an encrypted folder into a versioned one, a locked folder…) is refused right away rather than
 * by a failed job. The job runs them again when it starts.
 */
async function guardQueuedSources(
  actor: FileActor,
  sources: readonly StoragePathReference[],
  destinationStorage: ActiveStorage,
  folder: ResolvedPath,
  move: boolean,
  confirmDecrypt: boolean | undefined,
): Promise<void> {
  for (const source of sources) {
    const sourceStorage = requireStorageAccess(actor, source.storageId, move ? "write" : "read");
    const resolvedSource = await resolveInStorage(sourceStorage, source.path);
    const sourceStats = await lstat(resolvedSource.absolutePath);
    const sourceName = path.basename(resolvedSource.absolutePath);
    await runGuards(
      buildOperation(move ? "move" : "copy", sourceStorage, resolvedSource, actor, {
        isDirectory: sourceStats.isDirectory(),
        confirmDecrypt,
        destination: {
          storageId: destinationStorage.id,
          path: joinRelativePath(folder.relativePath, sourceName),
          absolutePath: joinStoragePath(folder.absolutePath, sourceName),
        },
      }),
    );
  }
}

function enqueueTransfer(
  actor: FileActor,
  sources: StoragePathReference[],
  destination: StoragePathReference,
  destinationLabel: string,
  move: boolean,
  { conflict, confirmDecrypt }: Required<Pick<TransferOptions, "conflict">> & TransferOptions,
): JobSummary {
  return getJobQueue().enqueue(
    ensureFileCopyJobType(),
    { sources, destination, destinationLabel, move, conflict, confirmDecrypt, actor },
    actor.id,
  );
}

/**
 * Moves entries into a folder. Within one storage and one disk it is a rename; anything else
 * (another storage, a drive mounted inside the storage, into or out of an encrypted folder)
 * becomes an `fs.copy` job that sends each source to the trash once copied.
 */
export async function moveEntries(
  actor: FileActor,
  sources: readonly StoragePathReference[],
  destination: StoragePathReference,
  { conflict = "fail", confirmDecrypt }: TransferOptions = {},
): Promise<TransferResult> {
  const { storage: destinationStorage, folder } = await readDestinationFolder(actor, destination);
  const result: TransferResult = { paths: [] };
  const queuedSources: StoragePathReference[] = [];
  for (const source of sources) {
    const sourceStorage = requireStorageAccess(actor, source.storageId, "write");
    const resolvedSource = await resolveInStorage(sourceStorage, source.path);
    if (resolvedSource.relativePath === "") throw validationFailed("A storage's root folder can't be moved.");
    if (sourceStorage.id !== destinationStorage.id) {
      queuedSources.push(source);
      continue;
    }
    const sourceStats = await lstat(resolvedSource.absolutePath);
    if (
      sourceStats.isDirectory() &&
      (folder.relativePath === resolvedSource.relativePath ||
        folder.relativePath.startsWith(`${resolvedSource.relativePath}/`))
    ) {
      throw validationFailed("A folder can't be moved into itself.");
    }
    if (parentRelativePath(resolvedSource.relativePath) === folder.relativePath) continue;
    const targetName = await pickTargetName(
      folder.absolutePath,
      path.basename(resolvedSource.absolutePath),
      sourceStats.isDirectory(),
      conflict,
    );
    const targetPath = joinRelativePath(folder.relativePath, targetName);
    const targetAbsolutePath = joinStoragePath(folder.absolutePath, targetName);
    const operation = buildOperation("move", sourceStorage, resolvedSource, actor, {
      isDirectory: sourceStats.isDirectory(),
      destination: { storageId: destinationStorage.id, path: targetPath, absolutePath: targetAbsolutePath },
      confirmDecrypt,
    });
    await runGuards(operation);
    if (await requiresContentCopy(operation)) {
      queuedSources.push(source);
      continue;
    }
    try {
      await rename(resolvedSource.absolutePath, targetAbsolutePath);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EXDEV") throw renameError;
      queuedSources.push(source);
      continue;
    }
    emitChange(sourceStorage.id, resolvedSource.relativePath, "removed");
    emitChange(destinationStorage.id, targetPath, "added");
    await runAfterHooks(operation);
    result.paths.push(targetPath);
  }
  if (queuedSources.length > 0) {
    await guardQueuedSources(actor, queuedSources, destinationStorage, folder, true, confirmDecrypt);
    result.job = enqueueTransfer(actor, queuedSources, destination, destinationStorage.label, true, {
      conflict,
      confirmDecrypt,
    });
  }
  return result;
}

/**
 * Copies entries into a folder. Single files up to 64 MB are copied right away; folders and
 * bigger files become an `fs.copy` job with byte progress.
 */
export async function copyEntries(
  actor: FileActor,
  sources: readonly StoragePathReference[],
  destination: StoragePathReference,
  { conflict = "keep-both", confirmDecrypt }: TransferOptions = {},
): Promise<TransferResult> {
  const { storage: destinationStorage, folder } = await readDestinationFolder(actor, destination);
  const result: TransferResult = { paths: [] };
  const queuedSources: StoragePathReference[] = [];
  for (const source of sources) {
    const sourceStorage = requireStorageAccess(actor, source.storageId, "read");
    const resolvedSource = await resolveInStorage(sourceStorage, source.path);
    if (resolvedSource.relativePath === "") throw validationFailed("A storage's root folder can't be copied.");
    const sourceStats = await lstat(resolvedSource.absolutePath);
    if (sourceStats.isDirectory() || sourceStats.size > INLINE_COPY_LIMIT_BYTES) {
      queuedSources.push(source);
      continue;
    }
    const targetName = await pickTargetName(
      folder.absolutePath,
      path.basename(resolvedSource.absolutePath),
      false,
      conflict,
    );
    const targetPath = joinRelativePath(folder.relativePath, targetName);
    const targetAbsolutePath = joinStoragePath(folder.absolutePath, targetName);
    const operation = buildOperation("copy", sourceStorage, resolvedSource, actor, {
      isDirectory: false,
      destination: { storageId: destinationStorage.id, path: targetPath, absolutePath: targetAbsolutePath },
      confirmDecrypt,
    });
    await runGuards(operation);
    if (sourceStats.isSymbolicLink()) {
      await copySymlink(resolvedSource.absolutePath, targetAbsolutePath);
    } else {
      const transforms = await collectTransferTransforms(operation);
      await copyFileContents(resolvedSource.absolutePath, targetAbsolutePath, { transforms });
    }
    emitChange(destinationStorage.id, targetPath, "added");
    await runAfterHooks(operation);
    result.paths.push(targetPath);
  }
  if (queuedSources.length > 0) {
    await guardQueuedSources(actor, queuedSources, destinationStorage, folder, false, confirmDecrypt);
    result.job = enqueueTransfer(actor, queuedSources, destination, destinationStorage.label, false, {
      conflict,
      confirmDecrypt,
    });
  }
  return result;
}

/** Moves entries to their storage's trash; nothing is ever unlinked here. */
export async function deleteEntries(
  actor: FileActor,
  storage: ActiveStorage,
  relativePaths: readonly string[],
): Promise<TrashItem[]> {
  const trashItems: TrashItem[] = [];
  for (const relativePath of relativePaths) trashItems.push(await moveToTrash(storage, relativePath, actor));
  return trashItems;
}
