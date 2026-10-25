import "server-only";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { getEventBus } from "@/server/events/bus";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { isHiddenCmmName, joinRelativePath, resolveInStorage } from "@/server/security/path-jail";
import type { ActiveStorage } from "@/server/storage/roots";

export const WATCH_DEBOUNCE_MILLISECONDS = 300;

interface DirectoryWatch {
  storageId: string;
  directoryPath: string;
  watcher: FSWatcher;
  subscriberCount: number;
  pendingChanges: Map<string, "added" | "changed" | "removed">;
  flushTimer?: NodeJS.Timeout;
}

function getWatchRegistry(): Map<string, DirectoryWatch> {
  return getGlobalSingleton("fs-watchers", () => new Map<string, DirectoryWatch>());
}

function toWatchKey(storageId: string, directoryPath: string): string {
  return `${storageId}\u0000${directoryPath}`;
}

const CHANGE_BY_EVENT: Record<string, "added" | "changed" | "removed"> = {
  add: "added",
  addDir: "added",
  change: "changed",
  unlink: "removed",
  unlinkDir: "removed",
};

function scheduleFlush(directoryWatch: DirectoryWatch): void {
  clearTimeout(directoryWatch.flushTimer);
  directoryWatch.flushTimer = setTimeout(() => {
    const pendingChanges = [...directoryWatch.pendingChanges];
    directoryWatch.pendingChanges.clear();
    for (const [changedPath, change] of pendingChanges) {
      getEventBus().emit("fs.changed", { storageId: directoryWatch.storageId, path: changedPath, change });
    }
  }, WATCH_DEBOUNCE_MILLISECONDS);
}

/**
 * Watches one folder (not its subfolders) and emits `fs.changed` for changes made outside CMM
 *. Watches are shared and counted: each subscriber gets an unsubscribe function, and the
 * watcher closes when the last one leaves. Changes are batched for 300 ms; `.cmm*` and `.git` are
 * ignored.
 */
export async function subscribeToDirectory(storage: ActiveStorage, relativePath: string): Promise<() => Promise<void>> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const watchKey = toWatchKey(storage.id, resolvedPath.relativePath);
  const registry = getWatchRegistry();
  let directoryWatch = registry.get(watchKey);
  if (directoryWatch) {
    directoryWatch.subscriberCount += 1;
  } else {
    const watcher = chokidar.watch(resolvedPath.absolutePath, {
      depth: 0,
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (watchedPath: string) => {
        const baseName = path.basename(watchedPath);
        return watchedPath !== resolvedPath.absolutePath && (isHiddenCmmName(baseName) || baseName === ".git");
      },
    });
    const createdWatch: DirectoryWatch = {
      storageId: storage.id,
      directoryPath: resolvedPath.relativePath,
      watcher,
      subscriberCount: 1,
      pendingChanges: new Map(),
    };
    watcher.on("all", (eventName, changedPath) => {
      const change = CHANGE_BY_EVENT[eventName];
      if (!change || changedPath === resolvedPath.absolutePath) return;
      createdWatch.pendingChanges.set(joinRelativePath(resolvedPath.relativePath, path.basename(changedPath)), change);
      scheduleFlush(createdWatch);
    });
    watcher.on("error", (watchError) => console.warn(`[cmm] watcher error in ${storage.id}`, watchError));
    registry.set(watchKey, createdWatch);
    directoryWatch = createdWatch;
  }
  const subscribedWatch = directoryWatch;
  let isSubscribed = true;
  return async () => {
    if (!isSubscribed) return;
    isSubscribed = false;
    if (registry.get(watchKey) !== subscribedWatch) return;
    subscribedWatch.subscriberCount -= 1;
    if (subscribedWatch.subscriberCount > 0) return;
    registry.delete(watchKey);
    clearTimeout(subscribedWatch.flushTimer);
    await subscribedWatch.watcher.close();
  };
}

/** Closes every watcher of a storage (its drive was removed). */
export async function closeStorageWatchers(storageId: string): Promise<void> {
  const registry = getWatchRegistry();
  for (const [watchKey, directoryWatch] of registry) {
    if (directoryWatch.storageId !== storageId) continue;
    registry.delete(watchKey);
    clearTimeout(directoryWatch.flushTimer);
    await directoryWatch.watcher.close();
  }
}

/** Closes every watcher (shutdown). */
export async function closeAllWatchers(): Promise<void> {
  const registry = getWatchRegistry();
  const directoryWatches = [...registry.values()];
  registry.clear();
  await Promise.all(
    directoryWatches.map((directoryWatch) => {
      clearTimeout(directoryWatch.flushTimer);
      return directoryWatch.watcher.close();
    }),
  );
}

/** How many folders are watched right now; for tests. */
export function countActiveWatches(): number {
  return getWatchRegistry().size;
}
