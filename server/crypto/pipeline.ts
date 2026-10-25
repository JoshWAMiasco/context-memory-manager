import "server-only";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ApiRouteError } from "@/server/http/api-error";
import {
  decryptRange,
  decryptStream,
  encryptAppender,
  encryptStream,
  parseHeader,
  readFileHeader,
  readPartProgress,
  buildHeader,
  SALT_BYTES,
  verifyEncryptedFile,
  type KeyResolver,
} from "@/server/crypto/format";
import { readFolderKey } from "@/server/crypto/keyring";
import { encryptionScopeOf, findEncryptedDescendant, recordEncryptedScope } from "@/server/crypto/scope";
import type { EncryptionScope } from "@/server/meta/effective";
import {
  readOperationRoot,
  registerGuard,
  registerTransform,
  type FileActor,
  type FileOperation,
  type FileOperationTarget,
  type FileTransform,
  type UploadCipher,
} from "@/server/storage/pipeline";

export const ENCRYPTION_HOOK_NAME = "encryption";

function folderName(scope: EncryptionScope): string {
  return scope.path === "" ? "This storage" : `"${path.posix.basename(scope.path)}"`;
}

/** 403 `ENCRYPTED_LOCKED`: the folder must be unlocked with its key file first. */
export function encryptedLocked(scope: EncryptionScope): ApiRouteError {
  return new ApiRouteError(
    403,
    "ENCRYPTED_LOCKED",
    `${folderName(scope)} is encrypted and locked. Unlock it with its key file to continue.`,
    { scopePath: scope.path, folderId: scope.crypto.folderId },
  );
}

/** The scope of a target: a folder's own scope when it is one, else its parent folder's. */
async function scopeOfTarget(target: FileOperationTarget, isDirectory: boolean): Promise<EncryptionScope | undefined> {
  const scope = await encryptionScopeOf(readOperationRoot(target), target.path, { isDirectory });
  if (scope) recordEncryptedScope(target.storageId, scope.path, scope.crypto);
  return scope;
}

/** CCM's own metadata (`.ccm/` files) is never encrypted: it must stay readable without a key. */
function isMetadataPath(relativePath: string): boolean {
  return relativePath.split("/").includes(".ccm");
}

/** Keys this session holds for a scope, looked up by the key id in each file's header. */
function resolverFor(actor: FileActor, scope: EncryptionScope): KeyResolver {
  return (keyId) => readFolderKey(actor.sessionIdHash, scope.crypto.folderId, keyId.toString("base64"));
}

function requireKey(actor: FileActor, scope: EncryptionScope, keyId = scope.crypto.keyId): Buffer {
  const dek = readFolderKey(actor.sessionIdHash, scope.crypto.folderId, keyId);
  if (!dek) throw encryptedLocked(scope);
  return dek;
}

function requireSettled(scope: EncryptionScope): void {
  if (scope.crypto.state === "encrypted") return;
  const activity = { encrypting: "encrypted", decrypting: "decrypted", rekeying: "re-keyed" }[scope.crypto.state];
  throw new ApiRouteError(
    409,
    "ENCRYPTION_IN_PROGRESS",
    `${folderName(scope)} is being ${activity}. Files can be changed again when that finishes.`,
    { scopePath: scope.path },
  );
}

function parentTarget(target: FileOperationTarget): FileOperationTarget {
  const parentPath = path.posix.dirname(target.path);
  return {
    storageId: target.storageId,
    path: parentPath === "." ? "" : parentPath,
    absolutePath: path.dirname(target.absolutePath),
  };
}

/** The key id an entry carries on a copy or move: its folder's own scope when it is one, else its parent's. */
interface TransferScopes {
  source?: EncryptionScope;
  destination?: EncryptionScope;
  /** The moved or copied folder is an encrypted folder itself, so its scope travels with it. */
  carriesOwnScope: boolean;
}

async function readTransferScopes(operation: FileOperation): Promise<TransferScopes> {
  const destination = operation.destination;
  const isDirectory = operation.isDirectory === true;
  const source = await scopeOfTarget(operation, isDirectory);
  const carriesOwnScope = isDirectory && source?.path === operation.path;
  const destinationScope = destination ? await scopeOfTarget(parentTarget(destination), true) : undefined;
  return { source, destination: destinationScope, carriesOwnScope };
}

function isSameKey({ source, destination, carriesOwnScope }: TransferScopes): boolean {
  if (carriesOwnScope) return destination === undefined;
  return source?.crypto.keyId === destination?.crypto.keyId;
}

async function guardTransfer(operation: FileOperation): Promise<void> {
  const scopes = await readTransferScopes(operation);
  const { source, destination, carriesOwnScope } = scopes;
  if (destination && (carriesOwnScope || (operation.isDirectory && (await containsEncryptedFolder(operation))))) {
    throw new ApiRouteError(
      409,
      "NESTED_SCOPE",
      "An encrypted folder can't be put inside another encrypted folder. Decrypt one of them first.",
      { scopePath: destination.path },
    );
  }
  if (isSameKey(scopes)) return;
  if (source) {
    requireKey(operation.actor, source);
    if (!destination && !operation.confirmDecrypt) {
      throw new ApiRouteError(
        409,
        "DECRYPT_CONFIRM_REQUIRED",
        `This is inside the encrypted folder ${folderName(source)}. Its copy outside will be decrypted (plaintext on disk).`,
        { scopePath: source.path },
      );
    }
  }
  if (destination) {
    requireSettled(destination);
    requireKey(operation.actor, destination);
  }
}

async function containsEncryptedFolder(operation: FileOperation): Promise<boolean> {
  return (await findEncryptedDescendant(operation.absolutePath)) !== undefined;
}

/**
 * Encryption rules for every file operation. Reading an encrypted file needs its folder
 * unlocked (403 `ENCRYPTED_LOCKED`); writing, creating and uploading inside an encrypted folder
 * need it unlocked and settled (409 `ENCRYPTION_IN_PROGRESS` while a job runs); moving or copying
 * across folders with different keys needs both unlocked, and leaving an encrypted folder needs
 * `confirmDecrypt` (409 `DECRYPT_CONFIRM_REQUIRED`). Renames, new folders, trash and listings
 * need no key.
 *
 * @example
 * await encryptionGuard({ type: "read", storageId, path: "persona/notes.md", absolutePath, actor });
 */
export async function encryptionGuard(operation: FileOperation): Promise<void> {
  if (isMetadataPath(operation.path) || operation.asStored) return;
  switch (operation.type) {
    case "read": {
      const scope = await scopeOfTarget(operation, operation.isDirectory === true);
      if (!scope) return;
      if (operation.isDirectory) {
        requireKey(operation.actor, scope);
        return;
      }
      const header = await readFileHeader(operation.absolutePath);
      if (
        header &&
        !readFolderKey(operation.actor.sessionIdHash, scope.crypto.folderId, header.keyId.toString("base64"))
      ) {
        throw encryptedLocked(scope);
      }
      return;
    }
    case "write":
    case "create": {
      if (operation.isDirectory) return;
      const scope = await scopeOfTarget(operation, false);
      if (!scope) return;
      requireSettled(scope);
      requireKey(operation.actor, scope);
      return;
    }
    case "move":
    case "copy":
      return guardTransfer(operation);
    default:
      return;
  }
}

async function readEncryptedScopeOf(operation: FileOperation): Promise<EncryptionScope | undefined> {
  if (isMetadataPath(operation.path) || operation.asStored) return undefined;
  return scopeOfTarget(operation, false);
}

/** The encryption transforms: decrypt on read, encrypt on write, transcode across keys. */
export const encryptionTransform: FileTransform = {
  read: async (operation) => {
    const scope = await readEncryptedScopeOf(operation);
    if (!scope || !(await readFileHeader(operation.absolutePath))) return undefined;
    return decryptStream(resolverFor(operation.actor, scope));
  },
  write: async (operation) => {
    const scope = await readEncryptedScopeOf(operation);
    if (!scope) return undefined;
    return encryptStream(requireKey(operation.actor, scope), Buffer.from(scope.crypto.keyId, "base64"));
  },
  readRange: async (operation, range) => {
    const scope = await readEncryptedScopeOf(operation);
    if (!scope || !(await readFileHeader(operation.absolutePath))) return undefined;
    return decryptRange(operation.absolutePath, resolverFor(operation.actor, scope), range.start, range.end);
  },
  transfer: async (operation) => {
    if (isMetadataPath(operation.path) || isMetadataPath(operation.destination?.path ?? "")) return [];
    const scopes = await readTransferScopes({ ...operation, isDirectory: false });
    if (isSameKey(scopes)) return [];
    const transforms = [];
    if (scopes.source && (await readFileHeader(operation.absolutePath))) {
      transforms.push(decryptStream(resolverFor(operation.actor, scopes.source)));
    }
    if (scopes.destination) {
      const dek = requireKey(operation.actor, scopes.destination);
      transforms.push(encryptStream(dek, Buffer.from(scopes.destination.crypto.keyId, "base64")));
    }
    return transforms;
  },
  blocksRename: async (operation) => !isSameKey(await readTransferScopes(operation)),
  verifyWrite: async (operation, temporaryPath) => {
    const scope = await readEncryptedScopeOf(operation);
    if (scope) await verifyEncryptedFile(temporaryPath, resolverFor(operation.actor, scope));
  },
  upload: async (operation): Promise<UploadCipher | undefined> => {
    const scope = await readEncryptedScopeOf(operation);
    if (!scope) return undefined;
    requireSettled(scope);
    const keyId = Buffer.from(scope.crypto.keyId, "base64");
    const resolveKey = resolverFor(operation.actor, scope);
    requireKey(operation.actor, scope);
    return {
      startBytes: () => buildHeader(keyId, randomBytes(SALT_BYTES)),
      received: readPartProgress,
      createAppender: (partStart, plainOffset, totalSize) => {
        const header = parseHeader(partStart);
        const dek = resolveKey(header.keyId);
        if (!dek) throw encryptedLocked(scope);
        return encryptAppender(dek, header, plainOffset, totalSize);
      },
      verify: (partPath) => verifyEncryptedFile(partPath, resolveKey),
    };
  },
};

/** Registers the encryption guard and transforms in the file operation pipeline (idempotent). */
export function registerEncryptionHooks(): void {
  registerGuard(ENCRYPTION_HOOK_NAME, encryptionGuard);
  registerTransform(ENCRYPTION_HOOK_NAME, encryptionTransform);
}
