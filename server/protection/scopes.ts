import "server-only";
import { and, eq } from "drizzle-orm";
import type { ProtectionMode } from "@/lib/protection";
import { getDatabase } from "@/server/db/client";
import { protectedScopes } from "@/server/db/schema";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

export type ProtectedScopeRow = typeof protectedScopes.$inferSelect;

/** Records (or clears, with mode "none") a protected folder or file in the index. */
export function recordProtectedScope(
  storageId: string,
  relativePath: string,
  kind: "folder" | "file",
  mode: ProtectionMode,
): void {
  const { orm } = getDatabase();
  if (mode === "none") {
    orm
      .delete(protectedScopes)
      .where(and(eq(protectedScopes.storageId, storageId), eq(protectedScopes.path, relativePath)))
      .run();
    return;
  }
  orm
    .insert(protectedScopes)
    .values({ storageId, path: relativePath, kind, mode, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [protectedScopes.storageId, protectedScopes.path],
      set: { kind, mode, updatedAt: new Date() },
    })
    .run();
}

/** Every indexed protected folder and file, optionally of one storage. */
export function listProtectedScopes(storageId?: string): ProtectedScopeRow[] {
  const query = getDatabase().orm.select().from(protectedScopes);
  return storageId ? query.where(eq(protectedScopes.storageId, storageId)).all() : query.all();
}

/**
 * The protected folders and files strictly inside `folderPath` (any depth). Deleting, moving or
 * renaming that folder would take them along, so those are refused.
 *
 * @example
 * findProtectedInside(storageId, "notes"); // [{ path: "notes/persona", … }]
 */
export function findProtectedInside(storageId: string, folderPath: string): ProtectedScopeRow[] {
  const prefix = folderPath === "" ? "" : `${folderPath}/`;
  return listProtectedScopes(storageId).filter((row) => row.path !== folderPath && row.path.startsWith(prefix));
}

/** Folders with a protection job running; the tamper watcher ignores their changes meanwhile. */
function getBusyScopes(): Set<string> {
  return getGlobalSingleton("protection-busy-scopes", () => new Set<string>());
}

export function toScopeKey(storageId: string, relativePath: string): string {
  return `${storageId}\u0000${relativePath}`;
}

export function markScopeBusy(storageId: string, relativePath: string, isBusy: boolean): void {
  const key = toScopeKey(storageId, relativePath);
  if (isBusy) getBusyScopes().add(key);
  else getBusyScopes().delete(key);
}

/** Whether a protection change is running on `relativePath` or on a folder around or inside it. */
export function isScopeBusy(storageId: string, relativePath: string): boolean {
  for (const key of getBusyScopes()) {
    const [busyStorageId, busyPath = ""] = key.split("\u0000");
    if (busyStorageId !== storageId) continue;
    if (
      busyPath === relativePath ||
      busyPath === "" ||
      relativePath === "" ||
      relativePath.startsWith(`${busyPath}/`) ||
      busyPath.startsWith(`${relativePath}/`)
    ) {
      return true;
    }
  }
  return false;
}
