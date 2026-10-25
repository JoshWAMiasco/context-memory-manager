import "server-only";
import { readdir } from "node:fs/promises";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import type { MemoryListing, MemoryLocation } from "@/lib/memory";
import { getEventBus } from "@/server/events/bus";
import { readManifest } from "@/server/meta/effective";
import { META_DIRECTORY } from "@/server/meta/store";
import { toMemorySummary } from "@/server/memory";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { listActiveStorages, readAccessLevel, type ActiveStorage, type StorageActor } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Memories deeper than this many folders below a storage's root aren't found. */
const DISCOVERY_MAX_DEPTH = 6;
/** Each storage's walk stops after this many folders or this long, so a huge home folder can't stall the dashboard. */
const DISCOVERY_FOLDER_LIMIT = 20_000;
const DISCOVERY_TIME_LIMIT_MILLISECONDS = 1500;
const DISCOVERY_CACHE_MILLISECONDS = 60_000;

/** Folders that never hold memories but can hold a great many folders. */
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set(["node_modules", "__pycache__"]);
/** Top-level folders of a macOS home that are the system's, not the user's. */
const SKIPPED_ROOT_FOLDER_NAMES: ReadonlySet<string> = new Set(
  process.platform === "darwin" ? ["Library", "Applications"] : [],
);

interface StorageDiscovery {
  memories: Omit<MemoryLocation, "storageLabel">[];
  isComplete: boolean;
}

interface CachedDiscovery {
  computedAt: number;
  discovery: StorageDiscovery;
}

/*
 * Any change CMM sees in a storage (its own file operations, memory settings, and the watcher)
 * drops that storage's cached memories; the next dashboard visit walks it again.
 */
function getDiscoveryCache(): Map<string, CachedDiscovery> {
  const cache = getGlobalSingleton("memory-discovery-cache", () => new Map<string, CachedDiscovery>());
  getGlobalSingleton("memory-discovery-listener", () => {
    getEventBus().on("fs.changed", ({ storageId }) => cache.delete(storageId));
    return true;
  });
  return cache;
}

function isWalkable(folderName: string, depth: number): boolean {
  if (folderName.startsWith(".") || isSystemMetadataName(folderName)) return false;
  if (SKIPPED_FOLDER_NAMES.has(folderName)) return false;
  return depth > 0 || !SKIPPED_ROOT_FOLDER_NAMES.has(folderName);
}

async function discoverInStorage(storage: ActiveStorage): Promise<StorageDiscovery> {
  const memories: StorageDiscovery["memories"] = [];
  const deadline = Date.now() + DISCOVERY_TIME_LIMIT_MILLISECONDS;
  const pendingFolders: { path: string; depth: number }[] = [{ path: "", depth: 0 }];
  let walked = 0;
  let isComplete = true;
  while (pendingFolders.length > 0) {
    if (walked >= DISCOVERY_FOLDER_LIMIT || Date.now() > deadline) {
      isComplete = false;
      break;
    }
    const folder = pendingFolders.shift() ?? { path: "", depth: 0 };
    walked += 1;
    const absoluteFolder =
      folder.path === "" ? storage.rootPath : joinStoragePath(storage.rootPath, ...folder.path.split("/"));
    const children = await readdir(absoluteFolder, { withFileTypes: true }).catch(() => []);
    if (folder.path !== "" && children.some((child) => child.name === META_DIRECTORY && child.isDirectory())) {
      const manifest = await readManifest(absoluteFolder);
      if (manifest?.kind === "memory") {
        memories.push({ storageId: storage.id, path: folder.path, memory: toMemorySummary(manifest) });
      }
    }
    if (folder.depth >= DISCOVERY_MAX_DEPTH) continue;
    for (const child of children) {
      if (!child.isDirectory() || !isWalkable(child.name, folder.depth)) continue;
      pendingFolders.push({
        path: folder.path === "" ? child.name : `${folder.path}/${child.name}`,
        depth: folder.depth + 1,
      });
    }
  }
  return { memories, isComplete };
}

/**
 * The memory folders on the internal storages `actor` can open, for the dashboard: each storage
 * is walked breadth-first (not following symlinks, skipping hidden folders, `node_modules` and a
 * macOS home's `Library`), down to 6 folders deep, for at most 20,000 folders or 1.5 s, then
 * cached for a minute or until something in it changes. `isComplete` is false when a
 * walk stopped early. Memories come sorted by name.
 *
 * @example
 * const { memories } = await listMemories(user); // [{ storageId: "home", storageLabel: "Home", path: "notes/persona", memory: {…} }]
 */
export async function listMemories(actor: StorageActor): Promise<MemoryListing> {
  const cache = getDiscoveryCache();
  const storages = listActiveStorages().filter(
    (storage) => storage.kind === "internal" && storage.available && readAccessLevel(actor, storage) !== undefined,
  );
  const discoveries = await Promise.all(
    storages.map(async (storage) => {
      const cached = cache.get(storage.id);
      if (cached && Date.now() - cached.computedAt < DISCOVERY_CACHE_MILLISECONDS) return cached.discovery;
      const discovery = await discoverInStorage(storage);
      cache.set(storage.id, { computedAt: Date.now(), discovery });
      return discovery;
    }),
  );
  const memories = discoveries
    .flatMap((discovery, storageIndex) =>
      discovery.memories.map((location) => ({ ...location, storageLabel: storages[storageIndex]?.label ?? "" })),
    )
    .toSorted(
      (first, second) =>
        first.memory.name.localeCompare(second.memory.name) || first.storageLabel.localeCompare(second.storageLabel),
    );
  return { memories, isComplete: discoveries.every((discovery) => discovery.isComplete) };
}
