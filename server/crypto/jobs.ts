import "server-only";
import { LEGACY_RESERVED_NAMES } from "@/lib/fs/legacy-names";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError } from "@/server/http/api-error";
import {
  decryptStream,
  encryptStream,
  readFileHeader,
  verifyEncryptedFile,
  type KeyResolver,
} from "@/server/crypto/format";
import { discardJobKeys, hasJobKeys, lockFolderEverywhere, readJobKey, unlockFolder } from "@/server/crypto/keyring";
import { forgetEncryptedScope, recordEncryptedScope } from "@/server/crypto/scope";
import { registerJobType, type JobContext, type JobDefinition } from "@/server/jobs/queue";
import { readCrypto } from "@/server/meta/effective";
import { META_FILES, type CryptoFile } from "@/server/meta/schemas";
import { deleteMeta, META_DIRECTORY, metaFilePath, writeJsonAtomically, writeMeta } from "@/server/meta/store";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { areTestHooksEnabled } from "@/server/runtime/test-hooks";
import { resolveInStorage } from "@/server/security/path-jail";
import { getSetting } from "@/server/settings/store";
import { TEMPORARY_DIRECTORY } from "@/server/storage/fs-ops";
import type { FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

export const CRYPTO_JOB_TYPES = {
  encrypt: "crypto.encrypt",
  decrypt: "crypto.decrypt",
  rekey: "crypto.rekey",
} as const;

export type CryptoJobKind = keyof typeof CRYPTO_JOB_TYPES;

export const JOURNAL_FILE = "crypto-journal.json";

/** How often a large file being rewritten reports its progress (the queue throttles events too). */
const IN_FILE_REPORT_MILLISECONDS = 100;

/** Folders the walk never enters. */
const SKIPPED_NAMES = new Set([META_DIRECTORY, ".cmm-trash", TEMPORARY_DIRECTORY, ".git", ...LEGACY_RESERVED_NAMES]);

const ACTIVITY: Record<CryptoJobKind, CryptoFile["state"]> = {
  encrypt: "encrypting",
  decrypt: "decrypting",
  rekey: "rekeying",
};

/** What a crypto job stores in the database. No key material: the job's keys live in the keyring only. */
export interface CryptoJobPayload {
  kind: CryptoJobKind;
  storageId: string;
  scopePath: string;
  folderId: string;
  /** Base64 key id of the folder's key (the old key while re-keying). */
  keyId: string;
  /** Re-key only: the new key's id. */
  nextKeyId?: string;
  actor: FileActor;
}

export interface CryptoJobCheckpoint {
  /** Files of the journal already handled. */
  cursor: number;
  doneBytes: number;
}

interface CryptoJournal {
  v: 1;
  jobId: string;
  kind: CryptoJobKind;
  files: string[];
  totalBytes: number;
}

function wrongState(message: string): ApiRouteError {
  return new ApiRouteError(409, "ENCRYPTION_IN_PROGRESS", message);
}

/** Every file in the folder, sorted, skipping CMM's folders and `.git`; symlinks are left alone. */
async function listScopeFiles(
  scopeAbsolutePath: string,
  signal: AbortSignal,
): Promise<{ files: string[]; totalBytes: number }> {
  const files: string[] = [];
  let totalBytes = 0;
  const pendingFolders = [""];
  while (pendingFolders.length > 0) {
    signal.throwIfAborted();
    const relativeFolder = pendingFolders.shift() ?? "";
    const absoluteFolder =
      relativeFolder === "" ? scopeAbsolutePath : joinStoragePath(scopeAbsolutePath, ...relativeFolder.split("/"));
    const childNames = (await readdir(absoluteFolder)).toSorted();
    const childFolders: string[] = [];
    for (const childName of childNames) {
      if (SKIPPED_NAMES.has(childName.toLowerCase())) continue;
      const childRelative = relativeFolder === "" ? childName : `${relativeFolder}/${childName}`;
      const childStats = await lstat(joinStoragePath(absoluteFolder, childName));
      if (childStats.isDirectory()) childFolders.push(childRelative);
      else if (childStats.isFile()) {
        files.push(childRelative);
        totalBytes += childStats.size;
      }
    }
    pendingFolders.unshift(...childFolders);
  }
  return { files, totalBytes };
}

async function readJournal(scopeAbsolutePath: string, jobId: string): Promise<CryptoJournal | undefined> {
  try {
    const journal = JSON.parse(await readFile(metaFilePath(scopeAbsolutePath, JOURNAL_FILE), "utf8")) as CryptoJournal;
    return journal.jobId === jobId && Array.isArray(journal.files) ? journal : undefined;
  } catch {
    return undefined;
  }
}

function requireJobKey(jobId: string, keyId: string): Buffer {
  const dek = readJobKey(jobId, keyId);
  if (!dek) throw wrongState("This job needs its key file again. Resume it from the folder's Encryption tab.");
  return dek;
}

/** The transforms that bring one file to the job's target state, or undefined when it is there already. */
async function planFile(
  jobId: string,
  payload: CryptoJobPayload,
  filePath: string,
): Promise<{ transforms: Transform[]; outputKeyId?: string } | undefined> {
  const header = await readFileHeader(filePath);
  const fileKeyId = header?.keyId.toString("base64");
  const resolveKey: KeyResolver = (keyId) => readJobKey(jobId, keyId.toString("base64"));
  if (payload.kind === "encrypt") {
    if (header) return undefined;
    const dek = requireJobKey(jobId, payload.keyId);
    return { transforms: [encryptStream(dek, Buffer.from(payload.keyId, "base64"))], outputKeyId: payload.keyId };
  }
  if (payload.kind === "decrypt") {
    if (!header) return undefined;
    return { transforms: [decryptStream(resolveKey)] };
  }
  const nextKeyId = payload.nextKeyId ?? "";
  if (fileKeyId === nextKeyId) return undefined;
  const nextDek = requireJobKey(jobId, nextKeyId);
  const encrypt = encryptStream(nextDek, Buffer.from(nextKeyId, "base64"));
  return { transforms: header ? [decryptStream(resolveKey), encrypt] : [encrypt], outputKeyId: nextKeyId };
}

/**
 * Rewrites one file through `transforms` into `<root>/.cmm-tmp/<uuid>` (fsync), checks new
 * ciphertext, then renames it over the original with the original mode bits. A crash leaves the
 * original or the finished file, never a mix.
 */
/** Test runs only: a pause after every chunk, so end-to-end tests can watch a job's progress move. */
const testSlowdown = getGlobalSingleton("crypto.testSlowdown", () => ({ chunkDelayMilliseconds: 0 }));

/**
 * Slows every crypto job down by `chunkDelayMilliseconds` per 64 KiB chunk (0 turns it off). Does
 * nothing unless test hooks are on (`CMM_TEST_HOOKS=1`).
 *
 * @example
 * setCryptoTestSlowdown(150);
 */
export function setCryptoTestSlowdown(chunkDelayMilliseconds: number): void {
  if (!areTestHooksEnabled()) return;
  testSlowdown.chunkDelayMilliseconds = Math.max(0, Math.min(chunkDelayMilliseconds, 5000));
}

/** Passes bytes through unchanged and reports how many went by, for progress inside a large file. */
function countBytes(onBytes: (byteCount: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onBytes(chunk.length);
      const delay = testSlowdown.chunkDelayMilliseconds;
      if (delay > 0) setTimeout(() => callback(null, chunk), delay);
      else callback(null, chunk);
    },
  });
}

async function rewriteFile(
  rootPath: string,
  filePath: string,
  transforms: Transform[],
  verifyKey: Buffer | undefined,
  signal: AbortSignal,
  onBytes: (byteCount: number) => void,
): Promise<void> {
  const temporaryDirectory = joinStoragePath(rootPath, TEMPORARY_DIRECTORY);
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = joinStoragePath(temporaryDirectory, randomUUID());
  const originalMode = (await lstat(filePath)).mode & 0o7777;
  try {
    await pipeline(
      [
        createReadStream(filePath),
        countBytes(onBytes),
        ...transforms,
        createWriteStream(temporaryPath, { flush: true, mode: 0o600 }),
      ],
      {
        signal,
      },
    );
    if (verifyKey) await verifyEncryptedFile(temporaryPath, verifyKey);
    await chmod(temporaryPath, originalMode);
    try {
      await rename(temporaryPath, filePath);
    } catch (renameError) {
      if ((renameError as NodeJS.ErrnoException).code !== "EXDEV") throw renameError;
      const siblingPath = joinStoragePath(path.dirname(filePath), `${TEMPORARY_DIRECTORY}-${randomUUID()}`);
      await copyFile(temporaryPath, siblingPath);
      await rename(siblingPath, filePath);
      await rm(temporaryPath, { force: true });
    }
  } catch (rewriteError) {
    await rm(temporaryPath, { force: true });
    throw rewriteError;
  }
}

async function finishJob(
  payload: CryptoJobPayload,
  scopeAbsolutePath: string,
  crypto: CryptoFile,
  jobId: string,
): Promise<void> {
  if (payload.kind === "decrypt") {
    await deleteMeta(scopeAbsolutePath, META_FILES.crypto);
    forgetEncryptedScope(payload.storageId, payload.scopePath);
    lockFolderEverywhere(payload.folderId);
  } else if (payload.kind === "rekey") {
    const nextKey = crypto.nextKey;
    if (!nextKey) throw wrongState("The new key is missing from the folder's encryption settings.");
    const updated = await writeMeta(scopeAbsolutePath, META_FILES.crypto, {
      ...crypto,
      keyId: nextKey.keyId,
      keyCheck: nextKey.keyCheck,
      nextKey: undefined,
      state: "encrypted",
    });
    recordEncryptedScope(payload.storageId, payload.scopePath, updated);
    const nextDek = readJobKey(jobId, nextKey.keyId);
    lockFolderEverywhere(payload.folderId);
    if (nextDek && payload.actor.sessionIdHash) {
      unlockFolder(payload.actor.sessionIdHash, {
        folderId: payload.folderId,
        storageId: payload.storageId,
        scopePath: payload.scopePath,
        keys: [{ keyId: Buffer.from(nextKey.keyId, "base64"), dek: nextDek }],
        expiresAt: Date.now() + getSetting("encryption.unlockTtlMinutes") * 60 * 1000,
      });
    }
  } else {
    const updated = await writeMeta(scopeAbsolutePath, META_FILES.crypto, { ...crypto, state: "encrypted" });
    recordEncryptedScope(payload.storageId, payload.scopePath, updated);
  }
  await rm(metaFilePath(scopeAbsolutePath, JOURNAL_FILE), { force: true });
}

/**
 * Encrypts, decrypts or re-keys every file of an encrypted folder. The file list is
 * written once to `.cmm/crypto-journal.json` and the cursor is checkpointed after every file;
 * each file is skipped when it is already in the target state, so a resumed or repeated job never
 * encrypts twice. Progress counts bytes and files, and moves inside a large file as it is read.
 */
async function runCryptoJob({
  jobId,
  payload,
  checkpoint,
  reportProgress,
  saveCheckpoint,
  signal,
}: JobContext<CryptoJobPayload, CryptoJobCheckpoint>): Promise<void> {
  // The queue can start a job inside `enqueue`, before the caller stores its keys (same tick).
  await Promise.resolve();
  if (!hasJobKeys(jobId)) {
    throw wrongState("This job needs its key file again. Resume it from the folder's Encryption tab.");
  }
  try {
    const storage = requireStorageAccess(payload.actor, payload.storageId, "write");
    const scope = await resolveInStorage(storage, payload.scopePath);
    const crypto = await readCrypto(scope.absolutePath);
    if (!crypto || crypto.folderId !== payload.folderId) {
      throw wrongState("This folder's encryption settings changed. Start again from its Encryption tab.");
    }
    if (crypto.state !== ACTIVITY[payload.kind]) {
      await writeMeta(scope.absolutePath, META_FILES.crypto, { ...crypto, state: ACTIVITY[payload.kind] });
    }
    let journal = await readJournal(scope.absolutePath, jobId);
    if (!journal) {
      const { files, totalBytes } = await listScopeFiles(scope.absolutePath, signal);
      journal = { v: 1, jobId, kind: payload.kind, files, totalBytes };
      await writeJsonAtomically(metaFilePath(scope.absolutePath, JOURNAL_FILE), journal);
    }
    const progress: CryptoJobCheckpoint = checkpoint ?? { cursor: 0, doneBytes: 0 };
    const report = (currentItem?: string, fileBytesDone = 0) =>
      reportProgress({
        done: progress.doneBytes + fileBytesDone,
        total: journal.totalBytes,
        unit: "bytes",
        files: { done: progress.cursor, total: journal.files.length },
        currentItem,
      });
    report();
    for (; progress.cursor < journal.files.length;) {
      signal.throwIfAborted();
      const relativeFile = journal.files[progress.cursor] ?? "";
      const filePath = joinStoragePath(scope.absolutePath, ...relativeFile.split("/"));
      const fileStats = await lstat(filePath).catch(() => undefined);
      if (fileStats?.isFile()) {
        const plan = await planFile(jobId, payload, filePath);
        if (plan) {
          const verifyKey = plan.outputKeyId ? readJobKey(jobId, plan.outputKeyId) : undefined;
          let fileBytesDone = 0;
          let lastReportAt = Date.now();
          await rewriteFile(scope.rootPath, filePath, plan.transforms, verifyKey, signal, (byteCount) => {
            fileBytesDone += byteCount;
            if (Date.now() - lastReportAt < IN_FILE_REPORT_MILLISECONDS) return;
            lastReportAt = Date.now();
            report(relativeFile, Math.min(fileBytesDone, fileStats.size));
          });
        }
        progress.doneBytes += fileStats.size;
      }
      progress.cursor += 1;
      saveCheckpoint(progress);
      report(relativeFile);
    }
    await finishJob(payload, scope.absolutePath, (await readCrypto(scope.absolutePath)) ?? crypto, jobId);
    getEventBus().emit("fs.changed", { storageId: payload.storageId, path: payload.scopePath, change: "changed" });
    reportProgress({
      done: journal.totalBytes,
      total: journal.totalBytes,
      unit: "bytes",
      files: { done: journal.files.length, total: journal.files.length },
    });
  } finally {
    getEventBus().emit("encryption.changed", {
      storageId: payload.storageId,
      path: payload.scopePath,
      folderId: payload.folderId,
      change: "state",
    });
  }
}

const TITLES: Record<CryptoJobKind, string> = { encrypt: "Encrypt", decrypt: "Decrypt", rekey: "Re-key" };

/** The definition shared by the three crypto job types. */
export const cryptoJob: JobDefinition<CryptoJobPayload, CryptoJobCheckpoint> = createCryptoJob();

function createCryptoJob(): JobDefinition<CryptoJobPayload, CryptoJobCheckpoint> {
  return {
    run: async (context) => {
      try {
        await runCryptoJob(context);
        discardJobKeys(context.jobId);
      } catch (jobError) {
        // Keys stay for a pause (the next run continues); a failure or cancel drops them.
        if (!context.signal.aborted) discardJobKeys(context.jobId);
        throw jobError;
      }
    },
    readVolumeKeys: (payload) => [payload.storageId],
    describe: (payload) =>
      `${TITLES[payload.kind]} "${payload.scopePath === "" ? "storage" : path.posix.basename(payload.scopePath)}"`,
    readTarget: (payload) => ({ storageId: payload.storageId, path: payload.scopePath }),
    readResumeBlocker: (jobId) =>
      hasJobKeys(jobId)
        ? undefined
        : "This job needs the folder's key file again. Resume it from the folder's Encryption tab.",
  };
}

/** Registers the three crypto job types in this module copy (idempotent). */
export function ensureCryptoJobTypes(): void {
  for (const jobType of Object.values(CRYPTO_JOB_TYPES)) registerJobType(jobType, cryptoJob);
}

export function isCryptoJobType(jobType: string): jobType is (typeof CRYPTO_JOB_TYPES)[CryptoJobKind] {
  return (Object.values(CRYPTO_JOB_TYPES) as string[]).includes(jobType);
}

/**
 * Settles a folder whose crypto job was cancelled: an interrupted encrypt or decrypt leaves a mix
 * of encrypted and plaintext files, so the folder goes back to "encrypted" (the plaintext ones are
 * flagged, with "Encrypt N files now"); an interrupted re-key stays "rekeying" until it is resumed
 * with both key files.
 */
export async function settleCancelledJob(payload: CryptoJobPayload, jobId: string): Promise<void> {
  discardJobKeys(jobId);
  const storage = requireStorageAccess(payload.actor, payload.storageId, "write");
  const scope = await resolveInStorage(storage, payload.scopePath);
  const crypto = await readCrypto(scope.absolutePath);
  await rm(metaFilePath(scope.absolutePath, JOURNAL_FILE), { force: true });
  if (!crypto || crypto.folderId !== payload.folderId || payload.kind === "rekey") return;
  const updated = await writeMeta(scope.absolutePath, META_FILES.crypto, { ...crypto, state: "encrypted" });
  recordEncryptedScope(payload.storageId, payload.scopePath, updated);
  getEventBus().emit("encryption.changed", {
    storageId: payload.storageId,
    path: payload.scopePath,
    folderId: payload.folderId,
    change: "state",
  });
}
