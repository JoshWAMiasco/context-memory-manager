import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileEntry, ReplaceResult, UploadSession } from "@/lib/api-types";
import { HEADER_BYTES, readPartProgress } from "@/server/crypto/format";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, notFound, validationFailed } from "@/server/http/api-error";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { assertValidName, joinRelativePath, resolveInStorage, resolveRootPath } from "@/server/security/path-jail";
import type { BackgroundService } from "@/server/services";
import { readCurrentEtag, statEntry, TEMPORARY_DIRECTORY, writeAtomically } from "@/server/storage/fs-ops";
import {
  collectTransforms,
  collectUploadCipher,
  runAfterHooks,
  runGuards,
  type FileActor,
  type FileOperation,
  type UploadCipher,
} from "@/server/storage/pipeline";
import { listActiveStorages, requireStorageAccess, type ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { copyFileToTrash } from "@/server/trash";
import { flushAutocommits } from "@/server/versioning/autocommit";
import { readVersioning, versionedScopeOf } from "@/server/versioning/scope";

export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
export const STALE_UPLOAD_MILLISECONDS = 24 * 60 * 60 * 1000;

const UPLOAD_ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

/** `<root>/.cmm-tmp/uploads/<id>.json`, next to the `<id>.part` data. */
interface UploadRecord {
  v: 1;
  uploadId: string;
  storageId: string;
  directory: string;
  name: string;
  size: number;
  overwrite: boolean;
  userId: string;
  createdAt: string;
  /** The part is encrypted as it arrives (an upload into an encrypted folder). */
  encrypted?: boolean;
  /** "Replace with file from computer…": the target must exist, unchanged since `expectedEtag`. */
  replace?: ReplaceRequest;
}

/** A replace of an existing file: it must still be the version the user saw (`expectedEtag`). */
export interface ReplaceRequest {
  expectedEtag?: string;
}

interface LocatedUpload {
  record: UploadRecord;
  storage: ActiveStorage;
  partPath: string;
  recordPath: string;
}

function readUploadsDirectory(rootPath: string): string {
  return joinStoragePath(rootPath, TEMPORARY_DIRECTORY, "uploads");
}

/** Which storage holds each upload, so chunk requests don't scan every storage. */
function getUploadIndex(): Map<string, string> {
  return getGlobalSingleton("upload-index", () => new Map<string, string>());
}

/** Uploads with a chunk being written right now; a second concurrent chunk is refused. */
function getActiveChunkWrites(): Set<string> {
  return getGlobalSingleton("upload-active-chunks", () => new Set<string>());
}

async function readFreeBytes(rootPath: string): Promise<number> {
  const fileSystem = await statfs(rootPath);
  return fileSystem.bavail * fileSystem.bsize;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  return lstat(absolutePath).then(
    () => true,
    () => false,
  );
}

function toSession(record: UploadRecord, received: number): UploadSession {
  return { uploadId: record.uploadId, chunkSize: UPLOAD_CHUNK_SIZE, received, size: record.size };
}

export interface UploadRequest {
  directory: string;
  name: string;
  size: number;
  overwrite: boolean;
  replace?: ReplaceRequest;
}

/** Refuses a replace whose target is gone, is a folder, or changed since the user chose it. */
async function checkReplaceTarget(storage: ActiveStorage, targetPath: string, replace: ReplaceRequest): Promise<void> {
  const currentEtag = await readCurrentEtag(storage, targetPath);
  if (currentEtag === undefined) throw notFound("The file to replace is no longer there.");
  if (replace.expectedEtag !== undefined && currentEtag !== replace.expectedEtag) {
    throw new ApiRouteError(409, "ETAG_MISMATCH", "The file changed since you chose to replace it. Look at it, then try again.", {
      etag: currentEtag,
    });
  }
}

/**
 * Starts an upload: checks the name, the target, and free space up front, then creates
 * an empty `.part` file. The route asks for the `upload` step-up here, once per upload. A replace
 * needs the target to exist, unchanged since the user chose it.
 */
export async function initUpload(
  actor: FileActor,
  storage: ActiveStorage,
  { directory, name, size, overwrite: overwriteRequested, replace }: UploadRequest,
): Promise<UploadSession> {
  const overwrite = overwriteRequested || replace !== undefined;
  assertValidName(name);
  const folder = await resolveInStorage(storage, directory);
  if (!(await stat(folder.absolutePath)).isDirectory()) throw validationFailed("The upload folder is not a folder.");
  const target = await resolveInStorage(storage, joinRelativePath(folder.relativePath, name), { forCreate: true });
  const targetStats = await stat(target.absolutePath).catch(() => undefined);
  if (targetStats?.isDirectory())
    throw new ApiRouteError(409, "ALREADY_EXISTS", `A folder named "${name}" already exists.`);
  if (targetStats && !overwrite)
    throw new ApiRouteError(409, "ALREADY_EXISTS", `"${name}" already exists in this folder.`);
  if (replace) await checkReplaceTarget(storage, target.relativePath, replace);
  const freeBytes = await readFreeBytes(target.rootPath);
  if (freeBytes < size) {
    throw new ApiRouteError(507, "INSUFFICIENT_SPACE", "There is not enough free space on this storage.", {
      freeBytes,
      size,
    });
  }
  const operation: FileOperation = {
    type: targetStats ? "write" : "create",
    storageId: storage.id,
    path: target.relativePath,
    absolutePath: target.absolutePath,
    actor,
  };
  await runGuards(operation);
  const cipher = await collectUploadCipher({ ...operation, type: "write" });
  const record: UploadRecord = {
    v: 1,
    uploadId: randomUUID(),
    storageId: storage.id,
    directory: folder.relativePath,
    name,
    size,
    overwrite,
    userId: actor.id,
    createdAt: new Date().toISOString(),
  };
  if (cipher) record.encrypted = true;
  if (replace) record.replace = replace;
  const uploadsDirectory = readUploadsDirectory(target.rootPath);
  await mkdir(uploadsDirectory, { recursive: true, mode: 0o700 });
  await writeFile(joinStoragePath(uploadsDirectory, `${record.uploadId}.part`), cipher?.startBytes() ?? "", {
    mode: 0o600,
  });
  await writeFile(joinStoragePath(uploadsDirectory, `${record.uploadId}.json`), JSON.stringify(record), {
    mode: 0o600,
  });
  getUploadIndex().set(record.uploadId, storage.id);
  return toSession(record, 0);
}

async function readRecord(rootPath: string, uploadId: string): Promise<UploadRecord | undefined> {
  try {
    return JSON.parse(
      await readFile(joinStoragePath(readUploadsDirectory(rootPath), `${uploadId}.json`), "utf8"),
    ) as UploadRecord;
  } catch {
    return undefined;
  }
}

/** Finds an upload of `actor`'s, checking write access again; other people's uploads are 404. */
async function locateUpload(actor: FileActor, uploadId: string): Promise<LocatedUpload> {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) throw notFound("That upload does not exist.");
  const indexedStorageId = getUploadIndex().get(uploadId);
  const candidateStorages = listActiveStorages().filter(
    (activeStorage) =>
      activeStorage.available && (indexedStorageId === undefined || activeStorage.id === indexedStorageId),
  );
  for (const candidateStorage of candidateStorages) {
    const rootPath = await resolveRootPath(candidateStorage).catch(() => undefined);
    if (!rootPath) continue;
    const record = await readRecord(rootPath, uploadId);
    if (!record || record.userId !== actor.id || record.storageId !== candidateStorage.id) continue;
    const storage = requireStorageAccess(actor, candidateStorage.id, "write");
    getUploadIndex().set(uploadId, storage.id);
    const uploadsDirectory = readUploadsDirectory(rootPath);
    return {
      record,
      storage,
      partPath: joinStoragePath(uploadsDirectory, `${uploadId}.part`),
      recordPath: joinStoragePath(uploadsDirectory, `${uploadId}.json`),
    };
  }
  throw notFound("That upload does not exist.");
}

/**
 * How many bytes of the file have arrived. An encrypted part counts plaintext in whole chunks; a
 * chunk torn by a crash is cut off, so the upload resumes on a chunk boundary.
 */
async function readReceivedBytes(partPath: string, record: UploadRecord): Promise<number> {
  const partStats = await stat(partPath).catch(() => undefined);
  if (!partStats) throw notFound("That upload does not exist.");
  if (!record.encrypted) return partStats.size;
  const progress = readPartProgress(partStats.size, record.size);
  if (progress.partBytes < partStats.size) await truncate(partPath, progress.partBytes);
  return progress.plainBytes;
}

/** How much of an upload has arrived, so an interrupted upload can resume from there. */
export async function readUploadStatus(actor: FileActor, uploadId: string): Promise<UploadSession> {
  const { record, partPath } = await locateUpload(actor, uploadId);
  return toSession(record, await readReceivedBytes(partPath, record));
}

async function readPartStart(partPath: string): Promise<Buffer> {
  const fileHandle = await open(partPath, "r");
  try {
    const partStart = Buffer.alloc(HEADER_BYTES);
    await fileHandle.read(partStart, 0, HEADER_BYTES, 0);
    return partStart;
  } finally {
    await fileHandle.close();
  }
}

/** The cipher of an encrypted upload's target folder; the folder must still be encrypted and unlocked. */
async function requireUploadCipher(
  actor: FileActor,
  storage: ActiveStorage,
  record: UploadRecord,
): Promise<UploadCipher> {
  const target = await resolveInStorage(storage, joinRelativePath(record.directory, record.name), { forCreate: true });
  const cipher = await collectUploadCipher({
    type: "write",
    storageId: storage.id,
    path: target.relativePath,
    absolutePath: target.absolutePath,
    actor,
  });
  if (!cipher) {
    throw new ApiRouteError(
      409,
      "ENCRYPTION_IN_PROGRESS",
      "The folder's encryption changed during the upload. Upload the file again.",
    );
  }
  return cipher;
}

function createSizeLimiter(maximumBytes: number): Transform {
  let passedBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      passedBytes += chunk.length;
      if (passedBytes > maximumBytes) {
        callback(validationFailed("The chunk is larger than allowed.", { maximumBytes }));
        return;
      }
      callback(null, chunk);
    },
  });
}

/**
 * Appends one chunk. Chunks arrive in order: `offset` must equal the bytes received so far
 * (409 `UPLOAD_OFFSET_MISMATCH` with `details.received` otherwise). A chunk cut off by a dropped
 * connection keeps the bytes that arrived; the client asks for `received` and continues.
 */
export async function appendUploadChunk(
  actor: FileActor,
  uploadId: string,
  offset: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<UploadSession> {
  const { record, storage, partPath } = await locateUpload(actor, uploadId);
  const activeChunkWrites = getActiveChunkWrites();
  if (activeChunkWrites.has(uploadId)) {
    throw new ApiRouteError(409, "UPLOAD_OFFSET_MISMATCH", "Another chunk of this upload is still being written.", {
      received: await readReceivedBytes(partPath, record),
    });
  }
  activeChunkWrites.add(uploadId);
  try {
    const received = await readReceivedBytes(partPath, record);
    const cipher = record.encrypted ? await requireUploadCipher(actor, storage, record) : undefined;
    if (offset !== received) {
      throw new ApiRouteError(409, "UPLOAD_OFFSET_MISMATCH", "The chunk does not continue where the upload stopped.", {
        received,
      });
    }
    if (body) {
      const maximumBytes = Math.min(UPLOAD_CHUNK_SIZE, record.size - received);
      try {
        const appender = cipher?.createAppender(await readPartStart(partPath), received, record.size);
        await pipeline([
          Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>),
          createSizeLimiter(maximumBytes),
          ...(appender ? [appender] : []),
          createWriteStream(partPath, { flags: "a" }),
        ]);
      } catch (chunkError) {
        if (chunkError instanceof ApiRouteError) {
          if (!record.encrypted) await truncate(partPath, received);
          else await readReceivedBytes(partPath, record);
          throw chunkError;
        }
        console.warn(`[cmm] upload ${uploadId} chunk interrupted`, (chunkError as Error).message);
      }
    }
    return toSession(record, await readReceivedBytes(partPath, record));
  } finally {
    activeChunkWrites.delete(uploadId);
  }
}

async function placeWithoutOverwriting(partPath: string, targetPath: string, name: string): Promise<void> {
  try {
    await link(partPath, targetPath);
    await unlink(partPath);
    return;
  } catch (linkError) {
    const errorCode = (linkError as NodeJS.ErrnoException).code;
    if (errorCode === "EEXIST")
      throw new ApiRouteError(409, "ALREADY_EXISTS", `"${name}" already exists in this folder.`);
    if (errorCode !== "EPERM" && errorCode !== "ENOTSUP" && errorCode !== "EXDEV" && errorCode !== "EMLINK")
      throw linkError;
  }
  if (await pathExists(targetPath))
    throw new ApiRouteError(409, "ALREADY_EXISTS", `"${name}" already exists in this folder.`);
  await rename(partPath, targetPath);
}

/**
 * Puts an encrypted part in place: an empty file gets its one empty last chunk, the
 * ciphertext is authenticated, then the part replaces the target (keeping its mode) or claims
 * the name without overwriting.
 */
async function placeEncryptedPart(
  actor: FileActor,
  storage: ActiveStorage,
  record: UploadRecord,
  partPath: string,
  targetPath: string,
  targetExisted: boolean,
): Promise<void> {
  const cipher = await requireUploadCipher(actor, storage, record);
  if (record.size === 0 && (await stat(partPath)).size === HEADER_BYTES) {
    await pipeline(
      Readable.from([]),
      cipher.createAppender(await readPartStart(partPath), 0, 0),
      createWriteStream(partPath, { flags: "a" }),
    );
  }
  await cipher.verify(partPath);
  const mode = targetExisted ? (await stat(targetPath)).mode & 0o7777 : 0o644;
  await chmod(partPath, mode).catch(() => undefined);
  try {
    if (targetExisted) await rename(partPath, targetPath);
    else await placeWithoutOverwriting(partPath, targetPath, record.name);
  } catch (placeError) {
    if ((placeError as NodeJS.ErrnoException).code !== "EXDEV") throw placeError;
    // The target is on a drive mounted inside the storage: stage the ciphertext next to it first.
    const siblingPath = joinStoragePath(path.dirname(targetPath), `${TEMPORARY_DIRECTORY}-${randomUUID()}`);
    await copyFile(partPath, siblingPath);
    if (targetExisted) await rename(siblingPath, targetPath);
    else await placeWithoutOverwriting(siblingPath, targetPath, record.name);
    await rm(partPath, { force: true });
  }
}

/** The last commit of a versioned folder, from its undo stack. */
async function readLastCommit(scopeAbsolutePath: string): Promise<string | undefined> {
  return (await readVersioning(scopeAbsolutePath))?.undoStack.at(-1);
}

/**
 * Before a replace: in a versioned folder, commits pending edits so the replace is a step of its
 * own; elsewhere, keeps a copy of the current file in the trash. Returns what to do afterwards.
 */
async function prepareReplace(
  actor: FileActor,
  storage: ActiveStorage,
  target: { rootPath: string; relativePath: string },
): Promise<{ finish: () => Promise<ReplaceResult> }> {
  const scope = await versionedScopeOf(target.rootPath, target.relativePath, { isDirectory: false });
  if (scope) {
    await flushAutocommits(storage.id, scope.path);
    const commitBefore = await readLastCommit(scope.absolutePath);
    return {
      finish: async () => {
        await flushAutocommits(storage.id, scope.path);
        const commitAfter = await readLastCommit(scope.absolutePath);
        return commitAfter && commitAfter !== commitBefore ? { commitSha: commitAfter } : {};
      },
    };
  }
  const kept = await copyFileToTrash(storage, target.relativePath, actor);
  return { finish: () => Promise.resolve({ trashItemId: kept.id }) };
}

/**
 * Puts a fully received upload in place through the FS pipeline (encryption happens here). Without
 * overwrite the target is claimed with a hard link, so a file created meanwhile is never replaced.
 * A replace checks the target is unchanged, and returns the commit (versioned folder) or the trash
 * copy of the old version (elsewhere) to compare with.
 */
export async function completeUpload(
  actor: FileActor,
  uploadId: string,
): Promise<{ entry: FileEntry; replaced?: ReplaceResult }> {
  const { record, storage, partPath, recordPath } = await locateUpload(actor, uploadId);
  const received = await readReceivedBytes(partPath, record);
  if (received !== record.size) {
    throw new ApiRouteError(409, "UPLOAD_OFFSET_MISMATCH", "The upload is not complete yet.", { received });
  }
  const target = await resolveInStorage(storage, joinRelativePath(record.directory, record.name), { forCreate: true });
  const targetPath = target.realPath ?? target.absolutePath;
  const targetExisted = await pathExists(targetPath);
  if (targetExisted && !record.overwrite) {
    throw new ApiRouteError(409, "ALREADY_EXISTS", `"${record.name}" already exists in this folder.`);
  }
  if (record.replace) {
    if (!targetExisted) throw notFound("The file to replace is no longer there.");
    await checkReplaceTarget(storage, target.relativePath, record.replace);
  }
  const operation: FileOperation = {
    type: "write",
    storageId: storage.id,
    path: target.relativePath,
    absolutePath: target.absolutePath,
    actor,
    origin: record.replace ? "replace" : "upload",
  };
  await runGuards(targetExisted ? operation : { ...operation, type: "create" });
  const replacing = record.replace ? await prepareReplace(actor, storage, target) : undefined;
  if (record.encrypted) {
    await placeEncryptedPart(actor, storage, record, partPath, targetPath, targetExisted);
  } else if ((await collectTransforms("write", operation)).length > 0 || targetExisted) {
    await writeAtomically(target.rootPath, targetPath, createReadStream(partPath), operation);
    await rm(partPath, { force: true });
  } else {
    await chmod(partPath, 0o644);
    try {
      await placeWithoutOverwriting(partPath, targetPath, record.name);
    } catch (placeError) {
      if ((placeError as NodeJS.ErrnoException).code !== "EXDEV") throw placeError;
      await writeAtomically(target.rootPath, targetPath, createReadStream(partPath), operation);
      await rm(partPath, { force: true });
    }
  }
  await rm(recordPath, { force: true });
  getUploadIndex().delete(uploadId);
  getEventBus().emit("fs.changed", {
    storageId: storage.id,
    path: target.relativePath,
    change: targetExisted ? "changed" : "added",
  });
  await runAfterHooks(operation);
  const replaced = await replacing?.finish();
  const { entry } = await statEntry(storage, target.relativePath, actor);
  return replaced ? { entry, replaced } : { entry };
}

/** Cancels an upload and deletes what arrived. */
export async function cancelUpload(actor: FileActor, uploadId: string): Promise<void> {
  const { partPath, recordPath } = await locateUpload(actor, uploadId);
  await rm(partPath, { force: true });
  await rm(recordPath, { force: true });
  getUploadIndex().delete(uploadId);
}

/**
 * Deletes upload parts and atomic-write leftovers older than 24 hours from every available
 * storage's `.cmm-tmp/`. Returns how many files went.
 */
export async function removeStaleTemporaryFiles(now = Date.now()): Promise<number> {
  let removedCount = 0;
  for (const activeStorage of listActiveStorages().filter((candidate) => candidate.available)) {
    const rootPath = await resolveRootPath(activeStorage).catch(() => undefined);
    if (!rootPath) continue;
    for (const directoryPath of [joinStoragePath(rootPath, TEMPORARY_DIRECTORY), readUploadsDirectory(rootPath)]) {
      const entryNames = await readdir(directoryPath).catch(() => [] as string[]);
      for (const entryName of entryNames) {
        const entryPath = joinStoragePath(directoryPath, entryName);
        const entryStats = await lstat(entryPath).catch(() => undefined);
        if (!entryStats?.isFile() || now - entryStats.mtimeMs < STALE_UPLOAD_MILLISECONDS) continue;
        await rm(entryPath, { force: true });
        removedCount += 1;
      }
    }
  }
  return removedCount;
}

/** Runs `removeStaleTemporaryFiles` at start and then every hour. */
export function createUploadCleanupService(): BackgroundService {
  const timers: { hourly?: NodeJS.Timeout } = {};
  const cleanSafely = () => {
    removeStaleTemporaryFiles().catch((cleanupError: unknown) =>
      console.error("[cmm] temporary file cleanup failed", cleanupError),
    );
  };
  return {
    name: "upload-cleanup",
    start: () => {
      cleanSafely();
      timers.hourly = setInterval(cleanSafely, 60 * 60 * 1000);
      timers.hourly.unref();
    },
    stop: () => clearInterval(timers.hourly),
  };
}
