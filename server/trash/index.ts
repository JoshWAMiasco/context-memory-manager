import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TrashItem, TrashListResponse } from "@/lib/api-types";
import { getConfig } from "@/server/config";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, forbidden, notFound, validationFailed } from "@/server/http/api-error";
import { parentRelativePath, resolveInStorage, resolveRootPath } from "@/server/security/path-jail";
import { getSetting } from "@/server/settings/store";
import type { BackgroundService } from "@/server/services";
import { findAvailableName, measureTree } from "@/server/storage/copy-tree";
import { readFolderBadges } from "@/server/storage/meta-badges";
import { runAfterHooks, runGuards, type FileActor } from "@/server/storage/pipeline";
import {
  listActiveStorages,
  readAccessLevel,
  requireStorageAccess,
  type ActiveStorage,
  type StorageActor,
} from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

export const TRASH_DIRECTORY = ".ccm-trash";
export const EMPTY_TRASH_CONFIRMATION = "EMPTY";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;

/** `<storage root>/.ccm-trash/items/<uuid>/meta.json` (overview §9). */
export interface TrashMeta {
  v: 1;
  id: string;
  name: string;
  originalPath: string;
  deletedAt: string;
  deletedBy: string | null;
  deletedById: string | null;
  size: number;
  isDir: boolean;
  encrypted: boolean;
  memory: boolean;
  status: "moving" | "ok";
}

interface TrashItemLocation {
  storage: ActiveStorage;
  itemId: string;
  itemDirectory: string;
  meta: TrashMeta;
}

function readItemsDirectory(rootPath: string): string {
  return joinStoragePath(rootPath, TRASH_DIRECTORY, "items");
}

/** Trash item ids sent to clients name the storage too: `<storageId>:<uuid>`. */
export function toTrashItemId(storageId: string, itemUuid: string): string {
  return `${storageId}:${itemUuid}`;
}

/** Splits a client trash item id; the uuid part is checked, so it can't address anything outside the trash. */
export function parseTrashItemId(trashItemId: string): { storageId: string; itemUuid: string } {
  const separatorIndex = trashItemId.lastIndexOf(":");
  const storageId = trashItemId.slice(0, separatorIndex);
  const itemUuid = trashItemId.slice(separatorIndex + 1);
  if (separatorIndex <= 0 || !UUID_PATTERN.test(itemUuid)) throw notFound("That item is not in the trash.");
  return { storageId, itemUuid };
}

/** Writes JSON through a temporary file and a rename, so a crash never leaves half a file. */
async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function readMeta(itemDirectory: string): Promise<TrashMeta | undefined> {
  try {
    const parsedMeta = JSON.parse(await readFile(joinStoragePath(itemDirectory, "meta.json"), "utf8")) as TrashMeta;
    return parsedMeta.v === 1 && typeof parsedMeta.name === "string" ? parsedMeta : undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function toTrashItem(storage: ActiveStorage, meta: TrashMeta): TrashItem {
  return {
    id: toTrashItemId(storage.id, meta.id),
    storageId: storage.id,
    storageLabel: storage.label,
    name: meta.name,
    originalPath: meta.originalPath,
    deletedAt: meta.deletedAt,
    deletedBy: meta.deletedBy,
    size: meta.size,
    isDir: meta.isDir,
    encrypted: meta.encrypted,
    memory: meta.memory,
  };
}

/**
 * Moves a file or folder into `<root>/.ccm-trash/items/<uuid>/payload/`. Nothing is
 * unlinked: the data stays on the same volume and a restore is a rename. `meta.json` is written
 * as "moving" before the rename and "ok" after, so `reconcileTrash` can repair a crash in between.
 * A folder holding a mount point, or an item on a drive mounted inside the storage, is refused.
 */
export async function moveToTrash(storage: ActiveStorage, relativePath: string, actor: FileActor): Promise<TrashItem> {
  const { absolutePath, relativePath: normalizedPath, rootPath } = await resolveInStorage(storage, relativePath);
  if (normalizedPath === "") throw validationFailed("A storage's root folder can't be deleted.");
  const targetStats = await lstat(absolutePath);
  const isDirectory = targetStats.isDirectory();
  await runGuards({
    type: "delete",
    storageId: storage.id,
    path: normalizedPath,
    absolutePath,
    actor,
    isDirectory,
  });

  const rootStats = await stat(rootPath);
  if (targetStats.dev !== rootStats.dev) {
    throw new ApiRouteError(409, "CONTAINS_MOUNT_POINT", "This item is on another drive mounted inside the storage.");
  }
  const measurement = isDirectory
    ? await measureTree(absolutePath)
    : { size: targetStats.size, containsMountPoint: false };
  if (measurement.containsMountPoint) {
    throw new ApiRouteError(
      409,
      "CONTAINS_MOUNT_POINT",
      "This folder contains another mounted drive. Unmount it first, then delete the folder.",
    );
  }
  const badges = isDirectory ? await readFolderBadges(absolutePath) : undefined;

  const itemUuid = randomUUID();
  const itemDirectory = joinStoragePath(readItemsDirectory(rootPath), itemUuid);
  const payloadDirectory = joinStoragePath(itemDirectory, "payload");
  await mkdir(payloadDirectory, { recursive: true, mode: 0o700 });
  const meta: TrashMeta = {
    v: 1,
    id: itemUuid,
    name: path.basename(absolutePath),
    originalPath: normalizedPath,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.username ?? null,
    deletedById: actor.id,
    size: measurement.size,
    isDir: isDirectory,
    encrypted: badges?.encrypted ?? false,
    memory: badges?.isMemory ?? false,
    status: "moving",
  };
  await writeJsonAtomically(joinStoragePath(itemDirectory, "meta.json"), meta);
  try {
    await rename(absolutePath, joinStoragePath(payloadDirectory, meta.name));
  } catch (renameError) {
    await rm(itemDirectory, { recursive: true, force: true });
    throw renameError;
  }
  meta.status = "ok";
  await writeJsonAtomically(joinStoragePath(itemDirectory, "meta.json"), meta);

  getEventBus().emit("fs.changed", { storageId: storage.id, path: normalizedPath, change: "removed" });
  await runAfterHooks({
    type: "delete",
    storageId: storage.id,
    path: normalizedPath,
    absolutePath,
    actor,
    isDirectory,
  });
  return toTrashItem(storage, meta);
}

/**
 * Repairs trash items a crash left half-moved (run at startup and when a drive is added): a
 * "moving" item whose payload arrived is marked "ok"; one whose original is still in place is
 * dropped. Items without a readable `meta.json` and without a payload are dropped too.
 */
export async function reconcileTrash(
  storage: Pick<ActiveStorage, "id" | "rootPath">,
): Promise<{ repaired: number; removed: number }> {
  const result = { repaired: 0, removed: 0 };
  const rootPath = await resolveRootPath(storage).catch(() => undefined);
  if (!rootPath) return result;
  const itemsDirectory = readItemsDirectory(rootPath);
  const itemNames = await readdir(itemsDirectory).catch(() => [] as string[]);
  for (const itemName of itemNames) {
    if (!UUID_PATTERN.test(itemName)) continue;
    const itemDirectory = joinStoragePath(itemsDirectory, itemName);
    const meta = await readMeta(itemDirectory);
    if (meta?.status === "ok") continue;
    const payloadNames = await readdir(joinStoragePath(itemDirectory, "payload")).catch(() => [] as string[]);
    if (!meta) {
      if (payloadNames.length === 0) {
        await rm(itemDirectory, { recursive: true, force: true });
        result.removed += 1;
      } else {
        console.warn(`[ccm] trash item ${itemDirectory} has no readable meta.json; leaving it for manual review`);
      }
      continue;
    }
    if (payloadNames.includes(meta.name)) {
      await writeJsonAtomically(joinStoragePath(itemDirectory, "meta.json"), { ...meta, status: "ok" });
      result.repaired += 1;
      continue;
    }
    const originalStillThere = await pathExists(joinStoragePath(rootPath, ...meta.originalPath.split("/")));
    if (originalStillThere || payloadNames.length === 0) {
      await rm(itemDirectory, { recursive: true, force: true });
      result.removed += 1;
    }
  }
  return result;
}

async function listStorageItems(storage: ActiveStorage): Promise<TrashItemLocation[]> {
  const rootPath = await resolveRootPath(storage).catch(() => undefined);
  if (!rootPath) return [];
  const itemsDirectory = readItemsDirectory(rootPath);
  const itemNames = await readdir(itemsDirectory).catch(() => [] as string[]);
  const locations: TrashItemLocation[] = [];
  for (const itemName of itemNames) {
    if (!UUID_PATTERN.test(itemName)) continue;
    const itemDirectory = joinStoragePath(itemsDirectory, itemName);
    const meta = await readMeta(itemDirectory);
    if (meta?.status === "ok") locations.push({ storage, itemId: itemName, itemDirectory, meta });
  }
  return locations;
}

function listReadableStorages(actor: StorageActor, storageId?: string): ActiveStorage[] {
  return listActiveStorages().filter(
    (activeStorage) =>
      activeStorage.available &&
      (storageId === undefined || activeStorage.id === storageId) &&
      readAccessLevel(actor, activeStorage) !== undefined,
  );
}

/** The trash of every storage `actor` can read (or one storage), newest first, with the total size. */
export async function listTrash(actor: StorageActor, storageId?: string): Promise<TrashListResponse> {
  if (storageId !== undefined) requireStorageAccess(actor, storageId, "read");
  const itemGroups = await Promise.all(listReadableStorages(actor, storageId).map(listStorageItems));
  const items = itemGroups
    .flat()
    .map((location) => toTrashItem(location.storage, location.meta))
    .toSorted((first, second) => second.deletedAt.localeCompare(first.deletedAt));
  return { items, totalSize: items.reduce((totalSize, item) => totalSize + item.size, 0) };
}

/** The total size of a storage's trash, for the Drives page. */
export async function readTrashSize(storage: ActiveStorage): Promise<number> {
  const locations = await listStorageItems(storage);
  return locations.reduce((totalSize, location) => totalSize + location.meta.size, 0);
}

async function locateItem(actor: StorageActor, trashItemId: string): Promise<TrashItemLocation> {
  const { storageId, itemUuid } = parseTrashItemId(trashItemId);
  const storage = requireStorageAccess(actor, storageId, "write");
  const rootPath = await resolveRootPath(storage);
  const itemDirectory = joinStoragePath(readItemsDirectory(rootPath), itemUuid);
  const meta = await readMeta(itemDirectory);
  if (meta?.status !== "ok") throw notFound("That item is not in the trash.");
  return { storage, itemId: itemUuid, itemDirectory, meta };
}

/**
 * Puts an item back where it was. Missing parent folders are recreated; if the name is taken the
 * item comes back as "name (restored)", "name (restored 2)", and so on. Returns the restored path.
 */
export async function restoreTrashItem(
  actor: FileActor,
  trashItemId: string,
): Promise<{ storageId: string; path: string }> {
  const { storage, itemDirectory, meta } = await locateItem(actor, trashItemId);
  const parentPath = parentRelativePath(meta.originalPath);
  const parent = await resolveInStorage(storage, parentPath, { forCreate: true });
  const restoredName = await findAvailableName(parent.absolutePath, meta.name, "restored", meta.isDir);
  const restoredPath = parentPath === "" ? restoredName : `${parentPath}/${restoredName}`;
  const restoredAbsolutePath = joinStoragePath(parent.absolutePath, restoredName);
  await runGuards({
    type: "restore",
    storageId: storage.id,
    path: restoredPath,
    absolutePath: restoredAbsolutePath,
    actor,
    isDirectory: meta.isDir,
  });
  await mkdir(parent.absolutePath, { recursive: true });
  await rename(joinStoragePath(itemDirectory, "payload", meta.name), restoredAbsolutePath);
  await rm(itemDirectory, { recursive: true, force: true });
  getEventBus().emit("fs.changed", { storageId: storage.id, path: restoredPath, change: "added" });
  await runAfterHooks({
    type: "restore",
    storageId: storage.id,
    path: restoredPath,
    absolutePath: restoredAbsolutePath,
    actor,
    isDirectory: meta.isDir,
  });
  return { storageId: storage.id, path: restoredPath };
}

/** Deletes trash items for good (`rm -rf`). The route asks for the `delete-permanent` step-up. */
export async function purgeTrashItems(actor: StorageActor, trashItemIds: readonly string[]): Promise<number> {
  const locations = await Promise.all(trashItemIds.map((trashItemId) => locateItem(actor, trashItemId)));
  for (const location of locations) await rm(location.itemDirectory, { recursive: true, force: true });
  return locations.length;
}

/**
 * Deletes everything in the trash of one storage, or of every storage `actor` can write to.
 * `confirmText` must be "EMPTY".
 */
export async function emptyTrash(actor: StorageActor, storageId: string, confirmText: string): Promise<number> {
  if (confirmText !== EMPTY_TRASH_CONFIRMATION) {
    throw validationFailed(`Type ${EMPTY_TRASH_CONFIRMATION} to confirm emptying the trash.`);
  }
  const targetStorages =
    storageId === "all"
      ? listReadableStorages(actor).filter((activeStorage) => readAccessLevel(actor, activeStorage) === "write")
      : [requireStorageAccess(actor, storageId, "write")];
  let removedCount = 0;
  for (const targetStorage of targetStorages) {
    for (const location of await listStorageItems(targetStorage)) {
      await rm(location.itemDirectory, { recursive: true, force: true });
      removedCount += 1;
    }
  }
  return removedCount;
}

/**
 * Hands items to the operating system's trash (macOS Trash, Windows Recycle Bin, the Linux
 * freedesktop trash). Desktop mode only: on a server the OS trash belongs to the service account,
 * where nobody would find it.
 */
export async function moveTrashItemsToOsTrash(actor: StorageActor, trashItemIds: readonly string[]): Promise<number> {
  if (getConfig().mode !== "desktop") throw forbidden("Moving to the system trash is not available in server mode.");
  const locations = await Promise.all(trashItemIds.map((trashItemId) => locateItem(actor, trashItemId)));
  const { default: moveToSystemTrash } = await import("trash");
  for (const location of locations) {
    await moveToSystemTrash(joinStoragePath(location.itemDirectory, "payload", location.meta.name), { glob: false });
    await rm(location.itemDirectory, { recursive: true, force: true });
  }
  return locations.length;
}

/** Deletes trash items older than `trash.autoPurgeDays` (0 turns it off) from every available storage. */
export async function autoPurgeTrash(now = Date.now()): Promise<number> {
  const retentionDays = getSetting("trash.autoPurgeDays");
  if (retentionDays <= 0) return 0;
  const cutoffTime = now - retentionDays * DAY_MILLISECONDS;
  let purgedCount = 0;
  for (const activeStorage of listActiveStorages().filter((candidate) => candidate.available)) {
    for (const location of await listStorageItems(activeStorage)) {
      if (Date.parse(location.meta.deletedAt) >= cutoffTime) continue;
      await rm(location.itemDirectory, { recursive: true, force: true });
      purgedCount += 1;
    }
  }
  return purgedCount;
}

/** Runs `autoPurgeTrash` a minute after start, then once a day. */
export function createTrashAutoPurgeService(): BackgroundService {
  const timers: { first?: NodeJS.Timeout; daily?: NodeJS.Timeout } = {};
  const purgeSafely = () => {
    autoPurgeTrash().catch((purgeError: unknown) => console.error("[ccm] trash auto-purge failed", purgeError));
  };
  return {
    name: "trash-auto-purge",
    start: () => {
      timers.first = setTimeout(purgeSafely, 60_000);
      timers.daily = setInterval(purgeSafely, DAY_MILLISECONDS);
      timers.first.unref();
      timers.daily.unref();
    },
    stop: () => {
      clearTimeout(timers.first);
      clearInterval(timers.daily);
    },
  };
}
