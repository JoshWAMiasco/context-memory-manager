import "server-only";
import { lstat } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { getEventBus } from "@/server/events/bus";
import { readProtection } from "@/server/meta/effective";
import { META_FILES } from "@/server/meta/schemas";
import { writeMeta } from "@/server/meta/store";
import { ensureProtectionJobType, onProtectionChanged } from "@/server/protection";
import { registerProtectionGuard } from "@/server/protection/guard";
import { applyReadOnly, createPermissionSystem } from "@/server/protection/os-perms";
import { isScopeBusy, listProtectedScopes, type ProtectedScopeRow } from "@/server/protection/scopes";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { isHiddenCmmName } from "@/server/security/path-jail";
import type { BackgroundService } from "@/server/services";
import { findActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

const VIOLATION_DEBOUNCE_MILLISECONDS = 400;

interface ScopeWatch {
  row: ProtectedScopeRow;
  absolutePath: string;
  watcher: FSWatcher;
  pendingPaths: Set<string>;
  flushTimer?: NodeJS.Timeout;
}

function getScopeWatches(): Map<string, ScopeWatch> {
  return getGlobalSingleton("protection-scope-watches", () => new Map<string, ScopeWatch>());
}

function toWatchKey(row: Pick<ProtectedScopeRow, "storageId" | "path">): string {
  return `${row.storageId}\u0000${row.path}`;
}

/**
 * Handles changes another program made inside a protected folder: makes the changed
 * entries read-only again, records the alert in the scope's `protection.json` (shown as a banner
 * until someone dismisses it) and sends `protection.violation`.
 */
export async function reportViolation(
  row: ProtectedScopeRow,
  scopeAbsolutePath: string,
  changedPaths: string[],
): Promise<void> {
  const system = createPermissionSystem();
  for (const changedPath of changedPaths) {
    const entryStats = await lstat(changedPath).catch(() => undefined);
    if (!entryStats || entryStats.isSymbolicLink()) continue;
    await applyReadOnly(system, {
      absolutePath: changedPath,
      mode: entryStats.mode & 0o7777,
      isDirectory: entryStats.isDirectory(),
    }).catch((chmodError: unknown) => console.warn("[cmm] could not make a changed entry read-only again", chmodError));
  }
  const firstPath = changedPaths[0] ?? scopeAbsolutePath;
  const scopeFolder = row.kind === "file" ? path.dirname(scopeAbsolutePath) : scopeAbsolutePath;
  const relativeChange = path.relative(path.dirname(scopeAbsolutePath), firstPath).split(path.sep).join("/");
  const parentPath = path.posix.dirname(row.path);
  const changedRelativePath = parentPath === "." ? relativeChange : `${parentPath}/${relativeChange}`;
  const detectedAt = new Date().toISOString();
  const protection = await readProtection(scopeFolder);
  if (protection) {
    await writeMeta(scopeFolder, META_FILES.protection, {
      ...protection,
      violation: { at: detectedAt, path: changedRelativePath },
    }).catch((writeError: unknown) => console.warn("[cmm] could not record a protection alert", writeError));
  }
  getEventBus().emit("protection.violation", {
    storageId: row.storageId,
    scopePath: row.kind === "file" ? (parentPath === "." ? "" : parentPath) : row.path,
    path: changedRelativePath,
    detectedAt,
  });
}

/**
 * Reports only entries that are writable again. An event for an entry that is already read-only
 * is CMM's own chmod (the protection job, or making a changed entry read-only again) arriving
 * late, not a new change.
 */
async function reportWritableChanges(row: ProtectedScopeRow, scopeAbsolutePath: string, changedPaths: string[]) {
  const writablePaths: string[] = [];
  for (const changedPath of changedPaths) {
    const entryStats = await lstat(changedPath).catch(() => undefined);
    if (entryStats && !entryStats.isSymbolicLink() && (entryStats.mode & 0o222) !== 0) writablePaths.push(changedPath);
  }
  if (writablePaths.length > 0) await reportViolation(row, scopeAbsolutePath, writablePaths);
}

function watchScope(row: ProtectedScopeRow, absolutePath: string): ScopeWatch {
  const watcher = chokidar.watch(absolutePath, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (watchedPath: string) => watchedPath !== absolutePath && isHiddenCmmName(path.basename(watchedPath)),
  });
  const scopeWatch: ScopeWatch = { row, absolutePath, watcher, pendingPaths: new Set() };
  watcher.on("all", (eventName, changedPath) => {
    if (eventName === "unlink" || eventName === "unlinkDir") return;
    if (isScopeBusy(row.storageId, row.path)) return;
    scopeWatch.pendingPaths.add(changedPath);
    clearTimeout(scopeWatch.flushTimer);
    scopeWatch.flushTimer = setTimeout(() => {
      const changedPaths = [...scopeWatch.pendingPaths];
      scopeWatch.pendingPaths.clear();
      if (isScopeBusy(row.storageId, row.path)) return;
      void reportWritableChanges(row, absolutePath, changedPaths);
    }, VIOLATION_DEBOUNCE_MILLISECONDS);
  });
  watcher.on("error", (watchError) => console.warn("[cmm] protection watcher error", watchError));
  return scopeWatch;
}

/** Watches every indexed protected folder and file on a mounted storage, and stops watching the rest. */
export async function syncProtectionWatches(): Promise<void> {
  const scopeWatches = getScopeWatches();
  const wanted = new Map<string, { row: ProtectedScopeRow; absolutePath: string }>();
  for (const row of listProtectedScopes()) {
    const storage = findActiveStorage(row.storageId);
    if (!storage?.available) continue;
    wanted.set(toWatchKey(row), {
      row,
      absolutePath: row.path === "" ? storage.rootPath : joinStoragePath(storage.rootPath, ...row.path.split("/")),
    });
  }
  for (const [watchKey, scopeWatch] of scopeWatches) {
    if (wanted.get(watchKey)?.absolutePath === scopeWatch.absolutePath) continue;
    scopeWatches.delete(watchKey);
    clearTimeout(scopeWatch.flushTimer);
    await scopeWatch.watcher.close();
  }
  for (const [watchKey, { row, absolutePath }] of wanted) {
    if (!scopeWatches.has(watchKey)) scopeWatches.set(watchKey, watchScope(row, absolutePath));
  }
}

async function closeProtectionWatches(): Promise<void> {
  const scopeWatches = getScopeWatches();
  const allWatches = [...scopeWatches.values()];
  scopeWatches.clear();
  await Promise.all(
    allWatches.map((scopeWatch) => {
      clearTimeout(scopeWatch.flushTimer);
      return scopeWatch.watcher.close();
    }),
  );
}

/**
 * The protection service: registers the protection guard and job type, then watches protected
 * folders for changes made outside CMM, re-reading the list when protection changes or a drive
 * comes and goes.
 *
 * @example
 * const BACKGROUND_SERVICES = [createProtectionService(), …];
 */
export function createProtectionService(): BackgroundService {
  const unsubscribers: (() => void)[] = [];
  return {
    name: "protection",
    start: async () => {
      registerProtectionGuard();
      ensureProtectionJobType();
      const resync = () => {
        void syncProtectionWatches().catch((syncError: unknown) =>
          console.warn("[cmm] could not refresh the protection watchers", syncError),
        );
      };
      unsubscribers.push(onProtectionChanged(resync));
      const eventBus = getEventBus();
      for (const eventName of ["drive.added", "drive.removed", "drive.updated"] as const) {
        eventBus.on(eventName, resync);
        unsubscribers.push(() => eventBus.off(eventName, resync));
      }
      await syncProtectionWatches();
    },
    stop: async () => {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      await closeProtectionWatches();
    },
  };
}
