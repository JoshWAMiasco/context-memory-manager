import "server-only";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { findEncryptedDescendant } from "@/server/crypto/scope";
import { ApiRouteError } from "@/server/http/api-error";
import { findEncryptionScope, readCrypto } from "@/server/meta/effective";
import { joinRelativePath } from "@/server/security/path-jail";
import { readOperationRoot, registerGuard, type FileOperation } from "@/server/storage/pipeline";
import { findVersionedDescendant, findVersionedScope, readVersioning } from "@/server/versioning/scope";

export const EXCLUSIVITY_GUARD_NAME = "versioning-encryption";

/*
 * Encrypted folders are never versioned (decided 2026-10-24): a folder can be encrypted or
 * versioned, not both, and neither kind may sit inside or around the other. A user who wants
 * history decrypts first; a user who wants encryption turns versioning off first.
 */

function conflict(message: string, scopePath: string): ApiRouteError {
  return new ApiRouteError(409, "VERSIONING_ENCRYPTION_CONFLICT", message, { scopePath });
}

function describe(relativePath: string, storageLabel: string): string {
  return `"${relativePath === "" ? storageLabel : relativePath}"`;
}

/**
 * Refuses versioning for a folder that is encrypted, is inside an encrypted folder, or holds one
 * (409 `VERSIONING_ENCRYPTION_CONFLICT`).
 *
 * @example
 * await assertCanVersion(resolvedPath, storage.label);
 */
export async function assertCanVersion(
  { rootPath, relativePath, absolutePath }: { rootPath: string; relativePath: string; absolutePath: string },
  storageLabel: string,
): Promise<void> {
  const encryption = await findEncryptionScope(rootPath, absolutePath);
  if (encryption?.path === relativePath) {
    throw conflict(
      "This folder is encrypted, and encrypted folders can't be versioned. Decrypt it first (Folder settings → Encryption → Decrypt permanently).",
      encryption.path,
    );
  }
  if (encryption) {
    throw conflict(
      `This folder is inside the encrypted folder ${describe(encryption.path, storageLabel)}, and encrypted folders can't be versioned. Decrypt that folder first.`,
      encryption.path,
    );
  }
  const descendant = await findEncryptedDescendant(absolutePath);
  if (descendant) {
    const descendantPath = joinRelativePath(relativePath, descendant);
    throw conflict(
      `This folder contains the encrypted folder ${describe(descendantPath, storageLabel)}, and encrypted folders can't be versioned. Decrypt it first.`,
      descendantPath,
    );
  }
}

/**
 * Refuses encryption for a folder that is versioned, is inside a versioned folder, or holds one
 * (409 `VERSIONING_ENCRYPTION_CONFLICT`).
 *
 * @example
 * await assertCanEncrypt(resolvedPath, storage.label);
 */
export async function assertCanEncrypt(
  { rootPath, relativePath, absolutePath }: { rootPath: string; relativePath: string; absolutePath: string },
  storageLabel: string,
): Promise<void> {
  const versioned = await findVersionedScope(rootPath, absolutePath);
  if (versioned?.path === relativePath) {
    throw conflict(
      "Versioning is on for this folder, and versioned folders can't be encrypted. Turn versioning off first (Folder settings → Versioning).",
      versioned.path,
    );
  }
  if (versioned) {
    throw conflict(
      `This folder is inside the versioned folder ${describe(versioned.path, storageLabel)}, and versioned folders can't be encrypted. Turn its versioning off first.`,
      versioned.path,
    );
  }
  const descendant = await findVersionedDescendant(absolutePath);
  if (descendant) {
    const descendantPath = joinRelativePath(relativePath, descendant);
    throw conflict(
      `This folder contains the versioned folder ${describe(descendantPath, storageLabel)}, and versioned folders can't be encrypted. Turn its versioning off first.`,
      descendantPath,
    );
  }
}

/** Whether a folder is versioned or holds a versioned folder. */
export async function isVersionedTree(absolutePath: string): Promise<boolean> {
  return (
    (await readVersioning(absolutePath))?.enabled === true ||
    (await findVersionedDescendant(absolutePath)) !== undefined
  );
}

/** Whether a folder is encrypted or holds an encrypted folder. */
export async function isEncryptedTree(absolutePath: string): Promise<boolean> {
  return (
    (await readCrypto(absolutePath).catch(() => undefined)) !== undefined ||
    (await findEncryptedDescendant(absolutePath)) !== undefined
  );
}

/**
 * Keeps moves and copies from putting a versioned folder inside an encrypted one, or an encrypted
 * folder inside a versioned one (409 `VERSIONING_ENCRYPTION_CONFLICT`).
 *
 * @example
 * await exclusivityGuard({ type: "move", …, destination });
 */
export async function exclusivityGuard(operation: FileOperation): Promise<void> {
  const destination = operation.destination;
  if (!destination || !["move", "copy", "rename"].includes(operation.type)) return;
  const isDirectory =
    operation.isDirectory ??
    (await lstat(operation.absolutePath).then(
      (entryStats) => entryStats.isDirectory(),
      () => false,
    ));
  if (!isDirectory) return;
  const destinationRoot = readOperationRoot(destination);
  const destinationParent = path.dirname(destination.absolutePath);
  const encryptedAround = await findEncryptionScope(destinationRoot, destinationParent);
  if (encryptedAround && (await isVersionedTree(operation.absolutePath))) {
    throw conflict(
      `A versioned folder can't be put inside the encrypted folder "${encryptedAround.path}". Turn its versioning off first.`,
      encryptedAround.path,
    );
  }
  const versionedAround = await findVersionedScope(destinationRoot, destinationParent);
  if (versionedAround && (await isEncryptedTree(operation.absolutePath))) {
    throw conflict(
      `An encrypted folder can't be put inside the versioned folder "${versionedAround.path}". Decrypt it first.`,
      versionedAround.path,
    );
  }
}

/** Registers the guard in the file operation pipeline (idempotent). */
export function registerExclusivityGuard(): void {
  registerGuard(EXCLUSIVITY_GUARD_NAME, exclusivityGuard);
}
