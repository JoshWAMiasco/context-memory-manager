import "server-only";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import type { MemoryListing, MemoryLocation } from "@/lib/memory";
import { getDatabase } from "@/server/db/client";
import { memoryLocations } from "@/server/db/schema";
import { getEventBus } from "@/server/events/bus";
import { readManifest } from "@/server/meta/effective";
import { META_DIRECTORY } from "@/server/meta/store";
import { toMemorySummary } from "@/server/memory";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { readTestOverride } from "@/server/runtime/test-hooks";
import { listActiveStorages, readAccessLevel, type ActiveStorage, type StorageActor } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Memories deeper than this many folders below a storage's root aren't found. */
const DISCOVERY_MAX_DEPTH = 6;
/** A walk looks at most this many folders, so a huge storage can't keep it busy for long. */
const DISCOVERY_FOLDER_LIMIT = 50_000;
/** Folders read at the same time, so one slow folder doesn't hold up the rest. */
const DISCOVERY_CONCURRENCY = 8;
/**
 * A folder that doesn't answer within this long is skipped. macOS holds a read of Desktop,
 * Documents or Downloads until the user answers its permission prompt.
 */
const FOLDER_READ_TIMEOUT_MILLISECONDS = 5000;
/** The dashboard waits this long for a walk; a longer one keeps going and refreshes the dashboard when done. */
const RESPONSE_WAIT_MILLISECONDS = 1500;
/** A finished walk is reused this long, unless something in its storage changed. */
const DISCOVERY_CACHE_MILLISECONDS = 60_000;

/** Folders that never hold memories but can hold a great many folders. */
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set(["node_modules", "__pycache__"]);
/** Top-level folders of a macOS home that are the system's, not the user's. */
const SKIPPED_ROOT_FOLDER_NAMES: ReadonlySet<string> = new Set(
  process.platform === "darwin" ? ["Library", "Applications"] : [],
);

type FoundMemory = Omit<MemoryLocation, "storageLabel">;

interface StorageWalk {
  /** The memories found so far, by path. */
  memories: Map<string, FoundMemory>;
  /** False once a folder was skipped (too slow) or the folder limit was reached. */
  isComplete: boolean;
  done: Promise<void>;
  finishedAt?: number;
  /** Something in the storage changed since the walk started: the next listing walks again. */
  isStale: boolean;
  /** A listing answered before the walk finished, so its end is announced (`memories.changed`). */
  hasAnsweredEarly: boolean;
}

/*
 * Any change CMM sees in a storage (its own file operations, memory settings, and the watcher)
 * makes that storage's walk stale, and so does a drive being plugged in (another computer may have
 * changed it); the next dashboard visit walks it again.
 */
function getStorageWalks(): Map<string, StorageWalk> {
  const walks = getGlobalSingleton("memory-discovery-walks", () => new Map<string, StorageWalk>());
  getGlobalSingleton("memory-discovery-listener", () => {
    const eventBus = getEventBus();
    const markStale = ({ storageId }: { storageId: string }) => {
      const walk = walks.get(storageId);
      if (walk) walk.isStale = true;
    };
    eventBus.on("fs.changed", markStale);
    eventBus.on("drive.added", markStale);
    eventBus.on("drive.removed", ({ storageId }) => walks.delete(storageId));
    return true;
  });
  return walks;
}

function isWalkable(folderName: string, depth: number): boolean {
  if (folderName.startsWith(".") || isSystemMetadataName(folderName)) return false;
  if (SKIPPED_FOLDER_NAMES.has(folderName)) return false;
  return depth > 0 || !SKIPPED_ROOT_FOLDER_NAMES.has(folderName);
}

function toAbsolutePath(storage: ActiveStorage, relativePath: string): string {
  return relativePath === "" ? storage.rootPath : joinStoragePath(storage.rootPath, ...relativePath.split("/"));
}

/** Resolves with `fallback` when `promise` takes longer than `milliseconds` (the work itself can't be stopped). */
function withTimeout<Value, Fallback>(promise: Promise<Value>, milliseconds: number, fallback: Fallback) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Fallback>((resolve) => {
    timer = setTimeout(() => resolve(fallback), milliseconds);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const TIMED_OUT = Symbol("timed out");

/**
 * A folder's entries, or none when it can't be read. Test hook: a folder named
 * `CMM_TEST_DISCOVERY_BLOCKED_FOLDER` never answers, like one macOS holds while it asks for permission.
 */
function readFolderChildren(absoluteFolder: string) {
  if (path.basename(absoluteFolder) === readTestOverride("CMM_TEST_DISCOVERY_BLOCKED_FOLDER")) {
    return new Promise<never>(() => undefined);
  }
  return readdir(absoluteFolder, { withFileTypes: true }).catch(() => []);
}

/**
 * Walks a storage for memory folders: breadth-first-ish with 8 folders read at once, down to 6
 * folders deep, not following symlinks, skipping hidden folders, `node_modules` and a macOS home's
 * `Library`, for at most 50,000 folders; a folder that takes over 5 seconds is skipped. Unreadable
 * folders are skipped quietly. When it ends, what it found is remembered for the next start.
 */
function startWalk(storage: ActiveStorage): StorageWalk {
  const walk: StorageWalk = {
    memories: new Map(),
    isComplete: true,
    done: Promise.resolve(),
    isStale: false,
    hasAnsweredEarly: false,
  };
  let scheduled = 0;
  let running = 0;
  const waiting: (() => void)[] = [];
  const acquire = async () => {
    if (running >= DISCOVERY_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
  };
  const release = () => {
    running -= 1;
    waiting.shift()?.();
  };

  const visit = async (folderPath: string, depth: number): Promise<void> => {
    await acquire();
    let childFolders: string[] = [];
    try {
      const absoluteFolder = toAbsolutePath(storage, folderPath);
      const children = await withTimeout(
        readFolderChildren(absoluteFolder),
        FOLDER_READ_TIMEOUT_MILLISECONDS,
        TIMED_OUT,
      );
      if (children === TIMED_OUT) {
        walk.isComplete = false;
        return;
      }
      if (folderPath !== "" && children.some((child) => child.name === META_DIRECTORY && child.isDirectory())) {
        const manifest = await readManifest(absoluteFolder);
        if (manifest?.kind === "memory") {
          walk.memories.set(folderPath, { storageId: storage.id, path: folderPath, memory: toMemorySummary(manifest) });
        }
      }
      if (depth >= DISCOVERY_MAX_DEPTH) return;
      childFolders = children
        .filter((child) => child.isDirectory() && isWalkable(child.name, depth))
        .map((child) => (folderPath === "" ? child.name : `${folderPath}/${child.name}`));
    } finally {
      release();
    }
    const visits: Promise<void>[] = [];
    for (const childFolder of childFolders) {
      if (scheduled >= DISCOVERY_FOLDER_LIMIT) {
        walk.isComplete = false;
        break;
      }
      scheduled += 1;
      visits.push(visit(childFolder, depth + 1));
    }
    await Promise.all(visits);
  };

  scheduled = 1;
  walk.done = visit("", 0)
    .catch((walkError: unknown) => {
      walk.isComplete = false;
      console.error(`[cmm] searching "${storage.label}" for memories failed`, walkError);
    })
    .then(() => {
      walk.finishedAt = Date.now();
      rememberFoundMemories(storage.id, walk);
      if (walk.hasAnsweredEarly) getEventBus().emit("memories.changed", { storageId: storage.id });
    });
  return walk;
}

/** Saves a finished walk's memories for the next start; a complete walk also forgets the ones it didn't find. */
function rememberFoundMemories(storageId: string, walk: StorageWalk): void {
  const { orm } = getDatabase();
  const now = new Date();
  orm.transaction((transaction) => {
    if (walk.isComplete) transaction.delete(memoryLocations).where(eq(memoryLocations.storageId, storageId)).run();
    for (const memoryPath of walk.memories.keys()) {
      transaction
        .insert(memoryLocations)
        .values({ storageId, path: memoryPath, lastSeenAt: now })
        .onConflictDoUpdate({ target: [memoryLocations.storageId, memoryLocations.path], set: { lastSeenAt: now } })
        .run();
    }
  });
}

/**
 * The memories found on an earlier walk that are still memories, read again from their manifests.
 * Ones whose folder is gone are forgotten; ones that can't be read now (permission, slow drive) are
 * kept for later.
 */
async function readRememberedMemories(storage: ActiveStorage): Promise<FoundMemory[]> {
  const { orm } = getDatabase();
  const rememberedPaths = orm
    .select({ path: memoryLocations.path })
    .from(memoryLocations)
    .where(eq(memoryLocations.storageId, storage.id))
    .all()
    .map((row) => row.path);
  const memories = await Promise.all(
    rememberedPaths.map(async (memoryPath): Promise<FoundMemory | undefined> => {
      const absolutePath = toAbsolutePath(storage, memoryPath);
      const manifest = await withTimeout(readManifest(absolutePath), RESPONSE_WAIT_MILLISECONDS, TIMED_OUT);
      if (manifest === TIMED_OUT) return undefined;
      if (manifest?.kind === "memory")
        return { storageId: storage.id, path: memoryPath, memory: toMemorySummary(manifest) };
      const folderIsGone = await lstat(absolutePath).then(
        () => false,
        (statError: NodeJS.ErrnoException) => statError.code === "ENOENT",
      );
      if (folderIsGone || manifest) {
        orm
          .delete(memoryLocations)
          .where(and(eq(memoryLocations.storageId, storage.id), eq(memoryLocations.path, memoryPath)))
          .run();
      }
      return undefined;
    }),
  );
  return memories.filter((memory): memory is FoundMemory => memory !== undefined);
}

/** The storage's current walk: a running one, a recent one nothing has changed since, or a new one. */
function readCurrentWalk(storage: ActiveStorage): StorageWalk {
  const walks = getStorageWalks();
  const walk = walks.get(storage.id);
  const isReusable =
    walk !== undefined &&
    (walk.finishedAt === undefined || (!walk.isStale && Date.now() - walk.finishedAt < DISCOVERY_CACHE_MILLISECONDS));
  if (walk && isReusable) return walk;
  const nextWalk = startWalk(storage);
  walks.set(storage.id, nextWalk);
  return nextWalk;
}

/**
 * The memory folders on the storages `actor` can open, for the dashboard: the internal storages
 * and the drives plugged in now, so memories backed up on another computer show up too. The
 * memories found on earlier walks show at once; each storage is walked again (see `startWalk`),
 * waiting up to 1.5 s for it. A walk still going then keeps going (`isSearching`) and sends
 * `memories.changed` when it ends, so the dashboard updates. Walks are reused for a minute or until
 * something in the storage changes. `isComplete` is false when a walk skipped folders or stopped at
 * its limit. Memories come sorted by name.
 *
 * @example
 * const { memories } = await listMemories(user); // [{ storageId: "home", storageLabel: "Home", path: "notes/persona", memory: {…} }]
 */
export async function listMemories(actor: StorageActor): Promise<MemoryListing> {
  const storages = listActiveStorages().filter(
    (storage) => storage.available && readAccessLevel(actor, storage) !== undefined,
  );
  const discoveries = await Promise.all(
    storages.map(async (storage) => {
      const walk = readCurrentWalk(storage);
      const [remembered] = await Promise.all([
        readRememberedMemories(storage),
        withTimeout(walk.done, RESPONSE_WAIT_MILLISECONDS, undefined),
      ]);
      const isSearching = walk.finishedAt === undefined;
      if (isSearching) walk.hasAnsweredEarly = true;
      const memories = new Map(remembered.map((memory) => [memory.path, memory]));
      for (const [memoryPath, memory] of walk.memories) memories.set(memoryPath, memory);
      return { memories: [...memories.values()], isSearching, isComplete: walk.isComplete };
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
  return {
    memories,
    isSearching: discoveries.some((discovery) => discovery.isSearching),
    isComplete: discoveries.every((discovery) => discovery.isComplete),
  };
}
