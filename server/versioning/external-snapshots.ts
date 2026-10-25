import "server-only";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { getEventBus } from "@/server/events/bus";
import { effectiveState } from "@/server/meta/effective";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { areTestHooksEnabled } from "@/server/runtime/test-hooks";
import { isHiddenCmmName } from "@/server/security/path-jail";
import { isStorageEjecting } from "@/server/storage/drives/ejecting";
import { findActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { commitScopeChanges, hasPendingAutocommit, wasWrittenByApp } from "@/server/versioning/autocommit";
import { EXTERNAL_AUTHOR, readDirtyPaths, withRepo } from "@/server/versioning/repo";
import {
  forgetVersionedScope,
  listVersionedScopeRows,
  onVersionedScopesChanged,
  readVersioning,
  type VersionedScopeRow,
} from "@/server/versioning/scope";

/** Quiet time after the last outside change before it is committed. */
const DEFAULT_DEBOUNCE_MILLISECONDS = 10_000;

interface ScopeWatch {
  row: VersionedScopeRow;
  absolutePath: string;
  rootPath: string;
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
}

interface SnapshotState {
  watches: Map<string, ScopeWatch>;
  debounceMilliseconds: number;
}

function getState(): SnapshotState {
  return getGlobalSingleton("versioning-external-snapshots", () => ({
    watches: new Map(),
    debounceMilliseconds: DEFAULT_DEBOUNCE_MILLISECONDS,
  }));
}

function toWatchKey(row: Pick<VersionedScopeRow, "storageId" | "path">): string {
  return `${row.storageId}\u0000${row.path}`;
}

/** Test runs only: a shorter quiet time, so tests don't wait 10 seconds. */
export function setExternalSnapshotDebounce(milliseconds: number): void {
  if (areTestHooksEnabled()) getState().debounceMilliseconds = milliseconds;
}

/**
 * Commits changes another program made in a versioned folder, as author "External":
 * "External changes (N files)". Changes CMM made itself are left to the auto-commit, and nothing
 * happens while the folder is protected.
 *
 * @example
 * await snapshotExternalChanges("internal", "/data/notes", "persona");
 */
export async function snapshotExternalChanges(
  storageId: string,
  rootPath: string,
  scopePath: string,
): Promise<string | undefined> {
  const absolutePath = scopePath === "" ? rootPath : joinStoragePath(rootPath, ...scopePath.split("/"));
  if (!(await readVersioning(absolutePath))?.enabled) return undefined;
  if (hasPendingAutocommit(storageId, scopePath)) return undefined;
  const { protection } = await effectiveState(rootPath, scopePath, { isDirectory: true });
  if (protection.mode !== "none") return undefined;
  const dirtyPaths = await withRepo(absolutePath, (git) => readDirtyPaths(git));
  if (!dirtyPaths.some((dirtyPath) => !wasWrittenByApp(absolutePath, dirtyPath))) return undefined;
  const fileCount = dirtyPaths.length;
  return commitScopeChanges(
    { absolutePath },
    storageId,
    scopePath,
    `External changes (${fileCount} file${fileCount === 1 ? "" : "s"})`,
    EXTERNAL_AUTHOR,
  );
}

function scheduleSnapshot(scopeWatch: ScopeWatch): void {
  clearTimeout(scopeWatch.timer);
  scopeWatch.timer = setTimeout(() => {
    scopeWatch.timer = undefined;
    void snapshotExternalChanges(scopeWatch.row.storageId, scopeWatch.rootPath, scopeWatch.row.path).catch(
      (snapshotError: unknown) => console.warn("[cmm] versioning: couldn't record outside changes", snapshotError),
    );
  }, getState().debounceMilliseconds);
}

function watchScope(row: VersionedScopeRow, rootPath: string, absolutePath: string): ScopeWatch {
  const watcher = chokidar.watch(absolutePath, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (watchedPath: string) => {
      if (watchedPath === absolutePath) return false;
      const name = path.basename(watchedPath);
      return name === ".git" || isHiddenCmmName(name);
    },
  });
  const scopeWatch: ScopeWatch = { row, absolutePath, rootPath, watcher };
  watcher.on("all", () => scheduleSnapshot(scopeWatch));
  watcher.on("error", (watchError) => console.warn("[cmm] versioning watcher error", watchError));
  return scopeWatch;
}

async function closeWatch(scopeWatch: ScopeWatch): Promise<void> {
  clearTimeout(scopeWatch.timer);
  await scopeWatch.watcher.close();
}

/**
 * Watches every indexed versioned folder on a mounted storage, and stops watching the rest. A drive
 * being ejected counts as unmounted.
 */
export async function syncVersioningWatches(): Promise<void> {
  const watches = getState().watches;
  const wanted = new Map<string, { row: VersionedScopeRow; rootPath: string; absolutePath: string }>();
  for (const row of listVersionedScopeRows()) {
    const storage = findActiveStorage(row.storageId);
    if (!storage?.available || isStorageEjecting(storage.id)) continue;
    const absolutePath = row.path === "" ? storage.rootPath : joinStoragePath(storage.rootPath, ...row.path.split("/"));
    if (!(await readVersioning(absolutePath))?.enabled) {
      forgetVersionedScope(row.storageId, row.path);
      continue;
    }
    wanted.set(toWatchKey(row), { row, rootPath: storage.rootPath, absolutePath });
  }
  for (const [watchKey, scopeWatch] of watches) {
    if (wanted.get(watchKey)?.absolutePath === scopeWatch.absolutePath) continue;
    watches.delete(watchKey);
    await closeWatch(scopeWatch);
  }
  for (const [watchKey, { row, rootPath, absolutePath }] of wanted) {
    if (!watches.has(watchKey)) watches.set(watchKey, watchScope(row, rootPath, absolutePath));
  }
}

/** Stops watching the versioned folders of one storage (before its drive is ejected). */
export async function closeVersioningWatchesIn(storageId: string): Promise<void> {
  const watches = getState().watches;
  for (const [watchKey, scopeWatch] of watches) {
    if (scopeWatch.row.storageId !== storageId) continue;
    watches.delete(watchKey);
    await closeWatch(scopeWatch);
  }
}

/** Stops every watcher. */
export async function closeVersioningWatches(): Promise<void> {
  const watches = getState().watches;
  const all = [...watches.values()];
  watches.clear();
  await Promise.all(all.map((scopeWatch) => closeWatch(scopeWatch)));
}

/**
 * Keeps the watchers in step with the versioned-folder index and with drives coming and going.
 * Returns the function that stops listening.
 */
export function followVersionedScopes(): () => void {
  const resync = () => {
    void syncVersioningWatches().catch((syncError: unknown) =>
      console.warn("[cmm] could not refresh the versioning watchers", syncError),
    );
  };
  const unsubscribers = [onVersionedScopesChanged(resync)];
  const eventBus = getEventBus();
  for (const eventName of ["drive.added", "drive.removed", "drive.updated"] as const) {
    eventBus.on(eventName, resync);
    unsubscribers.push(() => eventBus.off(eventName, resync));
  }
  resync();
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
