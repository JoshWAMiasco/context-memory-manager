import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { LEGACY_RESERVED_NAMES } from "@/lib/fs/legacy-names";
import { getDatabase } from "@/server/db/client";
import { encryptedScopes } from "@/server/db/schema";
import { ApiRouteError } from "@/server/http/api-error";
import { findEncryptionScope, type EncryptionScope } from "@/server/meta/effective";
import type { CryptoFile } from "@/server/meta/schemas";
import { META_DIRECTORY, metaFilePath } from "@/server/meta/store";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Folders a walk for nested encrypted folders never enters. */
const SKIPPED_NAMES = new Set([".cmm-trash", ".cmm-tmp", ".git", META_DIRECTORY, ...LEGACY_RESERVED_NAMES]);

export type EncryptedScopeRow = typeof encryptedScopes.$inferSelect;

/**
 * The encrypted folder an entry is in: the nearest folder with `.cmm/crypto.json`, the
 * entry itself included when it is a folder.
 *
 * @example
 * const scope = await encryptionScopeOf(storage.rootPath, "persona/notes.md", { isDirectory: false });
 */
export async function encryptionScopeOf(
  rootPath: string,
  relativePath: string,
  { isDirectory }: { isDirectory: boolean },
): Promise<EncryptionScope | undefined> {
  const absolutePath = relativePath === "" ? rootPath : joinStoragePath(rootPath, ...relativePath.split("/"));
  return findEncryptionScope(rootPath, isDirectory ? absolutePath : path.dirname(absolutePath));
}

async function hasCryptoFile(folderAbsolutePath: string): Promise<boolean> {
  return stat(metaFilePath(folderAbsolutePath, "crypto.json")).then(
    () => true,
    () => false,
  );
}

/** The first folder under `folderAbsolutePath` (not itself) that is encrypted, as a relative path. */
export async function findEncryptedDescendant(folderAbsolutePath: string): Promise<string | undefined> {
  const pendingFolders = [""];
  while (pendingFolders.length > 0) {
    const relativeFolder = pendingFolders.shift() ?? "";
    const absoluteFolder =
      relativeFolder === "" ? folderAbsolutePath : joinStoragePath(folderAbsolutePath, ...relativeFolder.split("/"));
    const children = await readdir(absoluteFolder, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || SKIPPED_NAMES.has(child.name.toLowerCase())) continue;
      const childRelative = relativeFolder === "" ? child.name : `${relativeFolder}/${child.name}`;
      if (await hasCryptoFile(joinStoragePath(absoluteFolder, child.name))) return childRelative;
      pendingFolders.push(childRelative);
    }
  }
  return undefined;
}

/**
 * Refuses to encrypt a folder that is already encrypted, sits inside an encrypted folder, or
 * holds one: encrypted folders never nest (409 `NESTED_SCOPE`).
 *
 * @example
 * await assertNoNestedScope(storage.rootPath, "persona");
 */
export async function assertNoNestedScope(rootPath: string, relativePath: string): Promise<void> {
  const absolutePath = relativePath === "" ? rootPath : joinStoragePath(rootPath, ...relativePath.split("/"));
  const enclosing = await findEncryptionScope(rootPath, absolutePath);
  if (enclosing?.path === relativePath) {
    throw new ApiRouteError(409, "NESTED_SCOPE", "This folder is already encrypted.");
  }
  if (enclosing) {
    throw new ApiRouteError(
      409,
      "NESTED_SCOPE",
      `This folder is inside the encrypted folder "${enclosing.path}", so it is already encrypted with that folder's key.`,
      { scopePath: enclosing.path },
    );
  }
  const descendant = await findEncryptedDescendant(absolutePath);
  if (descendant) {
    throw new ApiRouteError(
      409,
      "NESTED_SCOPE",
      `This folder contains the encrypted folder "${descendant}". Decrypt it first: encrypted folders can't be nested.`,
      { scopePath: descendant },
    );
  }
}

/** The index rows last written, so reads don't rewrite an unchanged row. */
function getIndexCache(): Map<string, string> {
  return getGlobalSingleton("encrypted-scope-index", () => new Map<string, string>());
}

/**
 * Records an encrypted folder in the `encrypted_scopes` index (Settings → Encryption lists it).
 * Folders found while browsing are added lazily; the files themselves stay the source of truth.
 */
export function recordEncryptedScope(storageId: string, scopePath: string, crypto: CryptoFile): void {
  const cacheKey = `${storageId}\u0000${scopePath}`;
  const signature = `${crypto.folderId}|${crypto.keyId}|${crypto.state}`;
  if (getIndexCache().get(cacheKey) === signature) return;
  getDatabase()
    .orm.insert(encryptedScopes)
    .values({
      storageId,
      path: scopePath,
      folderId: crypto.folderId,
      keyId: crypto.keyId,
      state: crypto.state,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [encryptedScopes.storageId, encryptedScopes.path],
      set: { folderId: crypto.folderId, keyId: crypto.keyId, state: crypto.state, updatedAt: new Date() },
    })
    .run();
  getIndexCache().set(cacheKey, signature);
}

/** Removes a folder from the index (decrypted, or no longer there). */
export function forgetEncryptedScope(storageId: string, scopePath: string): void {
  getDatabase()
    .orm.delete(encryptedScopes)
    .where(and(eq(encryptedScopes.storageId, storageId), eq(encryptedScopes.path, scopePath)))
    .run();
  getIndexCache().delete(`${storageId}\u0000${scopePath}`);
}

export function listEncryptedScopeRows(): EncryptedScopeRow[] {
  return getDatabase().orm.select().from(encryptedScopes).all();
}
