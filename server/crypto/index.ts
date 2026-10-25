import "server-only";
import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { inArray } from "drizzle-orm";
import type { EncryptedFolderSummary, EncryptionStatus, JobSummary } from "@/lib/api-types";
import { getSessionLifetimeMilliseconds, type ResolvedSession } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { readFileHeader, CRYPTO_ALGORITHM } from "@/server/crypto/format";
import {
  CRYPTO_JOB_TYPES,
  ensureCryptoJobTypes,
  isCryptoJobType,
  settleCancelledJob,
  type CryptoJobKind,
  type CryptoJobPayload,
} from "@/server/crypto/jobs";
import {
  buildKeyFile,
  computeKeyCheck,
  generateFolderKey,
  hasAllZeroKey,
  KEY_FILE_EXTENSION,
  matchKeyFile,
  parseKeyFile,
  wrongKeyFile,
  type ParsedKeyFile,
} from "@/server/crypto/keyfile";
import {
  discardPendingKey,
  listUnlockedFolders,
  lockAll,
  lockFolder,
  readFolderKey,
  readPendingKey,
  readUnlockExpiry,
  storeJobKeys,
  storePendingKey,
  unlockFolder,
} from "@/server/crypto/keyring";
import { registerEncryptionHooks } from "@/server/crypto/pipeline";
import {
  assertNoNestedScope,
  encryptionScopeOf,
  forgetEncryptedScope,
  listEncryptedScopeRows,
  recordEncryptedScope,
} from "@/server/crypto/scope";
import { getJobQueue, toJobSummary, type JobRow } from "@/server/jobs/queue";
import { effectiveState, readCrypto, readManifest, type EncryptionScope } from "@/server/meta/effective";
import { META_FILES, type CryptoFile } from "@/server/meta/schemas";
import { writeMeta } from "@/server/meta/store";
import { findProtectedInside, isScopeBusy } from "@/server/protection/scopes";
import { resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import type { BackgroundService } from "@/server/services";
import { getSetting } from "@/server/settings/store";
import type { FileActor } from "@/server/storage/pipeline";
import { assertCanEncrypt } from "@/server/versioning/exclusivity";
import { canSeeStorage, findActiveStorage, type ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Counting plaintext files inside an encrypted folder stops here. */
const PLAINTEXT_COUNT_LIMIT = 10_000;

export interface CryptoRequest {
  storage: ActiveStorage;
  path: string;
  actor: FileActor;
}

function requireSessionHash(actor: FileActor): string {
  if (!actor.sessionIdHash) throw new ApiRouteError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return actor.sessionIdHash;
}

/** When an unlock made now ends: the unlock time setting, never past the session's lifetime. */
export function readUnlockDeadline(auth: ResolvedSession, now = Date.now()): number {
  const ttlMilliseconds = getSetting("encryption.unlockTtlMinutes") * 60 * 1000;
  return Math.min(now + ttlMilliseconds, auth.session.createdAt.getTime() + getSessionLifetimeMilliseconds());
}

function folderNameOf(storage: ActiveStorage, relativePath: string): string {
  return relativePath === "" ? storage.label : path.posix.basename(relativePath);
}

async function requireFolder(storage: ActiveStorage, relativePath: string): Promise<ResolvedPath> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  if (!(await stat(resolvedPath.absolutePath)).isDirectory()) throw validationFailed("Choose a folder to encrypt.");
  return resolvedPath;
}

/** The encrypted folder at or around `relativePath` (a file or folder); 409 when there is none. */
async function requireScope(storage: ActiveStorage, relativePath: string): Promise<EncryptionScope> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const isDirectory = (await stat(resolvedPath.absolutePath)).isDirectory();
  const scope = await encryptionScopeOf(resolvedPath.rootPath, resolvedPath.relativePath, { isDirectory });
  if (!scope) throw validationFailed("This folder is not encrypted.");
  recordEncryptedScope(storage.id, scope.path, scope.crypto);
  return scope;
}

function readActiveCryptoJobs(): { row: JobRow; payload: CryptoJobPayload }[] {
  return getDatabase()
    .orm.select()
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running", "paused"]))
    .all()
    .filter((jobRow) => isCryptoJobType(jobRow.type))
    .map((jobRow) => ({ row: jobRow, payload: JSON.parse(jobRow.payloadJson ?? "{}") as CryptoJobPayload }));
}

/** The queued, running or paused crypto job of an encrypted folder, if any. */
function findCryptoJob(folderId: string): { row: JobRow; payload: CryptoJobPayload } | undefined {
  return readActiveCryptoJobs().find(({ payload }) => payload.folderId === folderId);
}

/** Why encryption can't change on this folder right now, or undefined. */
async function readBlockedReason(storage: ActiveStorage, resolvedPath: ResolvedPath): Promise<string | undefined> {
  const { protection } = await effectiveState(resolvedPath.rootPath, resolvedPath.relativePath, { isDirectory: true });
  if (protection.mode !== "none") {
    return `This folder is ${protection.mode === "locked" ? "locked" : "view-only"}. Remove its protection first.`;
  }
  const protectedInside = findProtectedInside(storage.id, resolvedPath.relativePath);
  if (protectedInside[0]) return `"${protectedInside[0].path}" inside is protected. Remove its protection first.`;
  if (isScopeBusy(storage.id, resolvedPath.relativePath)) return "A protection change is running here.";
  return undefined;
}

async function assertCanChange(storage: ActiveStorage, resolvedPath: ResolvedPath, folderId?: string): Promise<void> {
  const blockedReason = await readBlockedReason(storage, resolvedPath);
  if (blockedReason) throw new ApiRouteError(409, "SCOPE_BUSY", blockedReason);
  if (folderId && findCryptoJob(folderId)) {
    throw new ApiRouteError(409, "SCOPE_BUSY", "An encryption job is already working on this folder.");
  }
}

/**
 * Step 2 of the Enable encryption wizard: checks the folder can be encrypted (not the
 * storage root, not nested, not protected, history decided for versioned folders), generates its
 * key and keeps it in a 15-minute pending slot of this session. The password is confirmed by the
 * route first.
 */
export async function prepareEncryption({
  storage,
  path: relativePath,
  actor,
}: CryptoRequest): Promise<{ pendingId: string; folderName: string }> {
  const sessionIdHash = requireSessionHash(actor);
  const resolvedPath = await requireFolder(storage, relativePath);
  if (resolvedPath.relativePath === "") {
    throw validationFailed("A storage's root folder can't be encrypted. Encrypt the folders inside it.");
  }
  await assertNoNestedScope(resolvedPath.rootPath, resolvedPath.relativePath);
  await assertCanChange(storage, resolvedPath);
  await assertCanEncrypt(resolvedPath, storage.label);
  const manifest = await readManifest(resolvedPath.absolutePath);
  const folderName = manifest?.name ?? folderNameOf(storage, resolvedPath.relativePath);
  const { dek, keyId } = generateFolderKey();
  const pendingKey = storePendingKey(sessionIdHash, {
    kind: "encrypt",
    storageId: storage.id,
    scopePath: resolvedPath.relativePath,
    folderId: randomUUID(),
    folderName,
    dek,
    keyId,
    createdAt: new Date().toISOString(),
  });
  dek.fill(0);
  return { pendingId: pendingKey.pendingId, folderName };
}

function requirePending(actor: FileActor, pendingId: string) {
  const pendingKey = readPendingKey(requireSessionHash(actor), pendingId);
  if (!pendingKey) {
    throw new ApiRouteError(404, "NOT_FOUND", "This key expired after 15 minutes. Start again to get a new key file.");
  }
  return pendingKey;
}

function toKeyFileName(folderName: string): string {
  const safeName = folderName.replaceAll(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "folder";
  return `${safeName}${KEY_FILE_EXTENSION}`;
}

/** Step 3: the pending key's `.ccmkey` file; it can be downloaded again while the slot lives. */
export function readPendingKeyFile(actor: FileActor, pendingId: string): { fileName: string; bytes: Buffer } {
  const pendingKey = requirePending(actor, pendingId);
  return {
    fileName: toKeyFileName(pendingKey.folderName),
    bytes: buildKeyFile({
      folderId: pendingKey.folderId,
      folderName: pendingKey.folderName,
      createdAt: pendingKey.createdAt,
      dek: pendingKey.dek,
      keyId: pendingKey.keyId,
    }),
  };
}

/** Step 4: the uploaded key file must be exactly the one just downloaded. */
export function verifyPendingKeyFile(actor: FileActor, pendingId: string, keyFileBytes: Buffer): void {
  const pendingKey = requirePending(actor, pendingId);
  const keyFile = parseKeyFile(keyFileBytes);
  try {
    const isSame =
      keyFile.folderId === pendingKey.folderId &&
      keyFile.keyId.equals(pendingKey.keyId) &&
      keyFile.dek.equals(pendingKey.dek);
    if (!isSame) {
      throw new ApiRouteError(
        400,
        "WRONG_KEY_FILE",
        "That isn't the key file you just downloaded. Choose the .ccmkey file from step 3.",
      );
    }
    pendingKey.isVerified = true;
  } finally {
    keyFile.dek.fill(0);
  }
}

function emitStateChange(storageId: string, scopePath: string, folderId: string): void {
  getEventBus().emit("encryption.changed", { storageId, path: scopePath, folderId, change: "state" });
}

/**
 * Enqueues a crypto job and hands it its keys. The queue may start the job inside `enqueue`; the
 * job waits one microtask before looking for its keys, and they are stored synchronously here.
 */
function enqueueCryptoJob(payload: CryptoJobPayload, keys: readonly { keyId: Buffer; dek: Buffer }[]): JobSummary {
  ensureCryptoJobTypes();
  const job = getJobQueue().enqueue(CRYPTO_JOB_TYPES[payload.kind], payload, payload.actor.id);
  storeJobKeys(job.id, keys);
  return job;
}

/**
 * Step 5: writes `.ccm/crypto.json` (state `encrypting`, or `rekeying` with the new key), starts
 * the job with its own copy of the key(s), and unlocks the folder for this session. Needs the key
 * file verified in step 4.
 */
export async function startPendingJob(
  { storage, actor }: Omit<CryptoRequest, "path">,
  pendingId: string,
  auth: ResolvedSession,
): Promise<{ job: JobSummary; scopePath: string }> {
  const sessionIdHash = requireSessionHash(actor);
  const pendingKey = requirePending(actor, pendingId);
  if (!pendingKey.isVerified) throw validationFailed("Upload the key file to verify it first.");
  if (pendingKey.storageId !== storage.id) throw validationFailed("This key belongs to another storage.");
  const resolvedPath = await requireFolder(storage, pendingKey.scopePath);
  const keyIdText = pendingKey.keyId.toString("base64");
  const keyCheck = computeKeyCheck(pendingKey.dek, pendingKey.keyId);
  let crypto: CryptoFile;
  let payload: CryptoJobPayload;
  let jobKeys: { keyId: Buffer; dek: Buffer }[];
  if (pendingKey.kind === "encrypt") {
    await assertNoNestedScope(resolvedPath.rootPath, resolvedPath.relativePath);
    await assertCanChange(storage, resolvedPath);
    await assertCanEncrypt(resolvedPath, storage.label);
    crypto = await writeMeta(resolvedPath.absolutePath, META_FILES.crypto, {
      v: 1,
      folderId: pendingKey.folderId,
      algorithm: CRYPTO_ALGORITHM,
      keyId: keyIdText,
      keyCheck,
      state: "encrypting",
      createdAt: pendingKey.createdAt,
      createdBy: actor.username ?? actor.id,
    });
    jobKeys = [{ keyId: pendingKey.keyId, dek: pendingKey.dek }];
    payload = {
      kind: "encrypt",
      storageId: storage.id,
      scopePath: resolvedPath.relativePath,
      folderId: pendingKey.folderId,
      keyId: keyIdText,
      actor,
    };
  } else {
    const current = await readCrypto(resolvedPath.absolutePath);
    const oldKey = pendingKey.oldKey;
    if (!current || current.folderId !== pendingKey.folderId || !oldKey) {
      throw validationFailed("This folder's encryption changed. Start the re-key again.");
    }
    await assertCanChange(storage, resolvedPath, current.folderId);
    crypto = await writeMeta(resolvedPath.absolutePath, META_FILES.crypto, {
      ...current,
      state: "rekeying",
      nextKey: { keyId: keyIdText, keyCheck },
    });
    jobKeys = [oldKey, { keyId: pendingKey.keyId, dek: pendingKey.dek }];
    payload = {
      kind: "rekey",
      storageId: storage.id,
      scopePath: resolvedPath.relativePath,
      folderId: current.folderId,
      keyId: current.keyId,
      nextKeyId: keyIdText,
      actor,
    };
  }
  recordEncryptedScope(storage.id, resolvedPath.relativePath, crypto);
  unlockFolder(sessionIdHash, {
    folderId: crypto.folderId,
    storageId: storage.id,
    scopePath: resolvedPath.relativePath,
    keys: jobKeys,
    expiresAt: readUnlockDeadline(auth),
  });
  const job = enqueueCryptoJob(payload, jobKeys);
  discardPendingKey(sessionIdHash, pendingId);
  emitStateChange(storage.id, resolvedPath.relativePath, crypto.folderId);
  return { job, scopePath: resolvedPath.relativePath };
}

/** Parses a key file and checks it is the folder's current (or, while re-keying, next) key. */
function requireMatchingKey(scope: EncryptionScope, keyFileBytes: Buffer): ParsedKeyFile {
  const keyFile = parseKeyFile(keyFileBytes);
  const { crypto } = scope;
  const isCurrent = matchKeyFile(keyFile, crypto);
  const isNext =
    crypto.nextKey !== undefined &&
    matchKeyFile(keyFile, {
      folderId: crypto.folderId,
      keyId: crypto.nextKey.keyId,
      keyCheck: crypto.nextKey.keyCheck,
    });
  if (!isCurrent && !isNext) {
    keyFile.dek.fill(0);
    throw wrongKeyFile();
  }
  return keyFile;
}

/**
 * Unlocks an encrypted folder for this session: the key file must belong to it, and the
 * route has confirmed the password. While re-keying, either key file works (each opens its files).
 */
export async function unlockEncryptedFolder(
  { storage, path: relativePath, actor }: CryptoRequest,
  keyFileBytes: Buffer,
  auth: ResolvedSession,
): Promise<EncryptionStatus> {
  const sessionIdHash = requireSessionHash(actor);
  const scope = await requireScope(storage, relativePath);
  const keyFile = requireMatchingKey(scope, keyFileBytes);
  try {
    unlockFolder(sessionIdHash, {
      folderId: scope.crypto.folderId,
      storageId: storage.id,
      scopePath: scope.path,
      keys: [{ keyId: keyFile.keyId, dek: keyFile.dek }],
      expiresAt: readUnlockDeadline(auth),
    });
  } finally {
    keyFile.dek.fill(0);
  }
  return readEncryptionStatus({ storage, path: scope.path, actor });
}

/** Locks one encrypted folder for this session. */
export async function lockEncryptedFolder({ storage, path: relativePath, actor }: CryptoRequest): Promise<void> {
  const scope = await requireScope(storage, relativePath);
  lockFolder(requireSessionHash(actor), scope.crypto.folderId);
}

/** Locks every encrypted folder of this session ("Lock all"). */
export function lockAllEncryptedFolders(actor: FileActor): void {
  lockAll(requireSessionHash(actor));
}

/**
 * Decrypt permanently: needs the key file even when the folder is unlocked, and the typed
 * folder name; then a `crypto.decrypt` job turns every file back into plaintext and removes
 * `crypto.json`.
 */
export async function requestDecryption(
  { storage, path: relativePath, actor }: CryptoRequest,
  keyFileBytes: Buffer,
  confirmName: string,
): Promise<{ job: JobSummary }> {
  const resolvedPath = await requireFolder(storage, relativePath);
  const scope = await requireScope(storage, resolvedPath.relativePath);
  if (scope.path !== resolvedPath.relativePath) {
    throw validationFailed(`Decrypt the encrypted folder "${scope.path}" itself.`);
  }
  const folderName = folderNameOf(storage, scope.path);
  if (confirmName.trim() !== folderName) throw validationFailed(`Type "${folderName}" to confirm.`);
  if (scope.crypto.state === "rekeying") throw validationFailed("Finish re-keying this folder first.");
  const keyFile = requireMatchingKey(scope, keyFileBytes);
  try {
    await assertCanChange(storage, resolvedPath, scope.crypto.folderId);
    await writeMeta(scope.absolutePath, META_FILES.crypto, { ...scope.crypto, state: "decrypting" });
    recordEncryptedScope(storage.id, scope.path, { ...scope.crypto, state: "decrypting" });
    const job = enqueueCryptoJob(
      {
        kind: "decrypt",
        storageId: storage.id,
        scopePath: scope.path,
        folderId: scope.crypto.folderId,
        keyId: scope.crypto.keyId,
        actor,
      },
      [{ keyId: keyFile.keyId, dek: keyFile.dek }],
    );
    emitStateChange(storage.id, scope.path, scope.crypto.folderId);
    return { job };
  } finally {
    keyFile.dek.fill(0);
  }
}

/**
 * Re-key, first step: the old key file proves access; a new key goes into a pending slot and the
 * wizard continues with download, verify and start as for encryption.
 */
export async function prepareRekey(
  { storage, path: relativePath, actor }: CryptoRequest,
  oldKeyFileBytes: Buffer,
): Promise<{ pendingId: string; folderName: string }> {
  const sessionIdHash = requireSessionHash(actor);
  const resolvedPath = await requireFolder(storage, relativePath);
  const scope = await requireScope(storage, resolvedPath.relativePath);
  if (scope.path !== resolvedPath.relativePath) throw validationFailed(`Re-key "${scope.path}" itself.`);
  if (scope.crypto.state !== "encrypted") throw validationFailed("Wait until the folder's current job finishes.");
  const oldKeyFile = requireMatchingKey(scope, oldKeyFileBytes);
  await assertCanChange(storage, resolvedPath, scope.crypto.folderId);
  const manifest = await readManifest(resolvedPath.absolutePath);
  const folderName = manifest?.name ?? folderNameOf(storage, scope.path);
  const { dek, keyId } = generateFolderKey();
  const pendingKey = storePendingKey(sessionIdHash, {
    kind: "rekey",
    storageId: storage.id,
    scopePath: scope.path,
    folderId: scope.crypto.folderId,
    folderName,
    dek,
    keyId,
    createdAt: new Date().toISOString(),
    oldKey: { dek: oldKeyFile.dek, keyId: oldKeyFile.keyId },
  });
  dek.fill(0);
  return { pendingId: pendingKey.pendingId, folderName };
}

/**
 * Continues an interrupted encryption job: a paused job gets its keys back and resumes;
 * a folder left encrypting, decrypting or re-keying without a job gets a new job, which skips the
 * files already done. Re-keying needs the old and the new key file.
 */
export async function resumeEncryption(
  { storage, path: relativePath, actor }: CryptoRequest,
  keyFileBytes: Buffer,
  newKeyFileBytes: Buffer | undefined,
): Promise<{ job: JobSummary }> {
  const scope = await requireScope(storage, relativePath);
  const { crypto } = scope;
  if (crypto.state === "encrypted") throw validationFailed("Nothing to resume: this folder is encrypted.");
  const oldKeyFile = parseKeyFile(keyFileBytes);
  const newKeyFile = newKeyFileBytes ? parseKeyFile(newKeyFileBytes) : undefined;
  try {
    if (!matchKeyFile(oldKeyFile, crypto)) throw wrongKeyFile();
    const keys = [{ keyId: oldKeyFile.keyId, dek: oldKeyFile.dek }];
    if (crypto.state === "rekeying") {
      const nextKey = crypto.nextKey;
      if (!nextKey || !newKeyFile) throw validationFailed("Re-keying needs the new key file too.");
      if (!matchKeyFile(newKeyFile, { folderId: crypto.folderId, ...nextKey })) throw wrongKeyFile();
      keys.push({ keyId: newKeyFile.keyId, dek: newKeyFile.dek });
    }
    const existing = findCryptoJob(crypto.folderId);
    if (existing && existing.row.status !== "paused") {
      throw new ApiRouteError(409, "SCOPE_BUSY", "The encryption job is already running.");
    }
    if (existing) {
      storeJobKeys(existing.row.id, keys);
      return { job: getJobQueue().resume(actor, existing.row.id) };
    }
    const kind: CryptoJobKind =
      crypto.state === "encrypting" ? "encrypt" : crypto.state === "decrypting" ? "decrypt" : "rekey";
    const job = enqueueCryptoJob(
      {
        kind,
        storageId: storage.id,
        scopePath: scope.path,
        folderId: crypto.folderId,
        keyId: crypto.keyId,
        nextKeyId: crypto.nextKey?.keyId,
        actor,
      },
      keys,
    );
    return { job };
  } finally {
    oldKeyFile.dek.fill(0);
    newKeyFile?.dek.fill(0);
  }
}

/**
 * Encrypts the plaintext files another program left inside an encrypted folder ("Encrypt N files
 * now"): a `crypto.encrypt` job with this session's key, which skips files already encrypted.
 */
export async function encryptPlaintextFiles({
  storage,
  path: relativePath,
  actor,
}: CryptoRequest): Promise<{ job: JobSummary }> {
  const scope = await requireScope(storage, relativePath);
  if (scope.crypto.state !== "encrypted") throw validationFailed("Wait until the folder's current job finishes.");
  const dek = readFolderKey(actor.sessionIdHash, scope.crypto.folderId, scope.crypto.keyId);
  if (!dek) throw new ApiRouteError(403, "ENCRYPTED_LOCKED", "Unlock the folder first.");
  const resolvedPath = await requireFolder(storage, scope.path);
  await assertCanChange(storage, resolvedPath, scope.crypto.folderId);
  await writeMeta(scope.absolutePath, META_FILES.crypto, { ...scope.crypto, state: "encrypting" });
  const job = enqueueCryptoJob(
    {
      kind: "encrypt",
      storageId: storage.id,
      scopePath: scope.path,
      folderId: scope.crypto.folderId,
      keyId: scope.crypto.keyId,
      actor,
    },
    [{ keyId: Buffer.from(scope.crypto.keyId, "base64"), dek }],
  );
  emitStateChange(storage.id, scope.path, scope.crypto.folderId);
  return { job };
}

async function countPlaintextFiles(scopeAbsolutePath: string): Promise<{ count: number; isCapped: boolean }> {
  let count = 0;
  let visited = 0;
  const pendingFolders = [scopeAbsolutePath];
  while (pendingFolders.length > 0) {
    const folder = pendingFolders.shift() ?? scopeAbsolutePath;
    for (const child of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if ([".ccm", ".ccm-trash", ".ccm-tmp", ".git"].includes(child.name.toLowerCase())) continue;
      const childPath = joinStoragePath(folder, child.name);
      if (child.isDirectory()) pendingFolders.push(childPath);
      else if (child.isFile()) {
        visited += 1;
        if (!(await readFileHeader(childPath))) count += 1;
        if (visited >= PLAINTEXT_COUNT_LIMIT) return { count, isCapped: true };
      }
    }
  }
  return { count, isCapped: false };
}

function shortFingerprint(keyId: string): string {
  return Buffer.from(keyId, "base64").subarray(0, 4).toString("hex").toUpperCase();
}

/** The encryption state of a folder or file and this session's unlock (`status`). */
export async function readEncryptionStatus({
  storage,
  path: relativePath,
  actor,
}: CryptoRequest): Promise<EncryptionStatus> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const isDirectory = (await stat(resolvedPath.absolutePath)).isDirectory();
  const scope = await encryptionScopeOf(resolvedPath.rootPath, resolvedPath.relativePath, { isDirectory });
  if (!scope) {
    const folderPath = isDirectory ? resolvedPath.relativePath : path.posix.dirname(resolvedPath.relativePath);
    const status: EncryptionStatus = {
      encrypted: false,
      scopePath: resolvedPath.relativePath,
      folderName: folderNameOf(storage, resolvedPath.relativePath),
      unlocked: false,
      plaintextFiles: 0,
    };
    if (isDirectory) {
      status.blockedReason =
        resolvedPath.relativePath === ""
          ? "A storage's root folder can't be encrypted."
          : await assertNoNestedScope(resolvedPath.rootPath, resolvedPath.relativePath)
              .then(() => assertCanEncrypt(resolvedPath, storage.label))
              .then(
                () => readBlockedReason(storage, resolvedPath),
                (nestedError: unknown) => (nestedError as Error).message,
              );
    } else if (folderPath !== resolvedPath.relativePath) {
      status.blockedReason = "Encrypt the folder this file is in.";
    }
    return status;
  }
  recordEncryptedScope(storage.id, scope.path, scope.crypto);
  const expiresAt = readUnlockExpiry(actor.sessionIdHash, scope.crypto.folderId);
  const plaintext = await countPlaintextFiles(scope.absolutePath);
  const status: EncryptionStatus = {
    encrypted: true,
    scopePath: scope.path,
    folderName: folderNameOf(storage, scope.path),
    folderId: scope.crypto.folderId,
    state: scope.crypto.state,
    unlocked: expiresAt !== undefined,
    keyFingerprint: shortFingerprint(scope.crypto.keyId),
    createdAt: scope.crypto.createdAt,
    createdBy: scope.crypto.createdBy,
    plaintextFiles: plaintext.count,
  };
  if (plaintext.isCapped) status.plaintextFilesCapped = true;
  if (hasAllZeroKey(scope.crypto)) status.weakKey = true;
  if (expiresAt) status.expiresAt = new Date(expiresAt).toISOString();
  const job = findCryptoJob(scope.crypto.folderId);
  if (job) status.job = toJobSummary(job.row);
  return status;
}

/**
 * Every encrypted folder `actor` can see, from the index, checked against the disk:
 * rows whose folder is gone or no longer encrypted are dropped. Unlocked folders this session
 * holds are always listed.
 */
export async function listEncryptedFolders(actor: FileActor): Promise<EncryptedFolderSummary[]> {
  const summaries = new Map<string, EncryptedFolderSummary>();
  for (const row of listEncryptedScopeRows()) {
    if (!canSeeStorage(actor, row.storageId)) continue;
    const storage = findActiveStorage(row.storageId);
    if (!storage) continue;
    let state = row.state;
    if (storage.available) {
      const absolutePath =
        row.path === "" ? storage.rootPath : joinStoragePath(storage.rootPath, ...row.path.split("/"));
      const crypto = await readCrypto(absolutePath).catch(() => undefined);
      if (!crypto || crypto.folderId !== row.folderId) {
        forgetEncryptedScope(row.storageId, row.path);
        continue;
      }
      state = crypto.state;
    }
    const expiresAt = readUnlockExpiry(actor.sessionIdHash, row.folderId);
    const summary: EncryptedFolderSummary = {
      storageId: row.storageId,
      storageLabel: storage.label,
      path: row.path,
      folderName: folderNameOf(storage, row.path),
      state,
      unlocked: expiresAt !== undefined,
      available: storage.available,
    };
    if (expiresAt) summary.expiresAt = new Date(expiresAt).toISOString();
    summaries.set(row.folderId, summary);
  }
  for (const unlocked of listUnlockedFolders(actor.sessionIdHash)) {
    if (summaries.has(unlocked.folderId) || !canSeeStorage(actor, unlocked.storageId)) continue;
    const storage = findActiveStorage(unlocked.storageId);
    if (!storage) continue;
    summaries.set(unlocked.folderId, {
      storageId: unlocked.storageId,
      storageLabel: storage.label,
      path: unlocked.scopePath,
      folderName: folderNameOf(storage, unlocked.scopePath),
      state: "encrypted",
      unlocked: true,
      expiresAt: new Date(unlocked.expiresAt).toISOString(),
      available: storage.available,
    });
  }
  return [...summaries.values()].toSorted(
    (first, second) => first.storageLabel.localeCompare(second.storageLabel) || first.path.localeCompare(second.path),
  );
}

/** How many folders this session has unlocked (the header key icon). */
export function countUnlockedFolders(actor: FileActor): number {
  return listUnlockedFolders(actor.sessionIdHash).length;
}

/**
 * The encryption service: registers the pipeline hooks and job types, and settles folders whose
 * encryption job was cancelled.
 */
export function createEncryptionService(): BackgroundService {
  const handleJobState = ({ job }: { job: JobSummary }) => {
    if (!isCryptoJobType(job.type) || job.status !== "cancelled") return;
    const row = getJobQueue().get(job.id);
    if (!row?.payloadJson) return;
    void settleCancelledJob(JSON.parse(row.payloadJson) as CryptoJobPayload, job.id).catch((settleError: unknown) =>
      console.warn("[ccm] could not settle a cancelled encryption job", settleError),
    );
  };
  return {
    name: "encryption",
    start: () => {
      registerEncryptionHooks();
      ensureCryptoJobTypes();
      getEventBus().on("job.state", handleJobState);
    },
    stop: () => {
      getEventBus().off("job.state", handleJobState);
    },
  };
}
