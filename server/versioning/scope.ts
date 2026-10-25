import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { getEventBus, type VersioningChangedEvent } from "@/server/events/bus";
import { versionedScopes } from "@/server/db/schema";
import { META_FILES, type VersioningFile } from "@/server/meta/schemas";
import { InvalidMetaError, isScope, listAncestors, META_DIRECTORY, readMeta, writeMeta } from "@/server/meta/store";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Undo and redo remember this many steps. */
export const UNDO_STACK_LIMIT = 200;

/** Folders a walk for nested versioned folders never enters. */
const SKIPPED_NAMES = new Set([".ccm-trash", ".ccm-tmp", ".git", META_DIRECTORY, "node_modules"]);

/** A versioned folder: the nearest folder, itself included, whose `.ccm/versioning.json` is enabled. */
export interface VersionedScope {
  /** Storage-relative path of the versioned folder. */
  path: string;
  absolutePath: string;
  versioning: VersioningFile;
}

export type VersionedScopeRow = typeof versionedScopes.$inferSelect;

/** A folder's `versioning.json`, or undefined (also when it is damaged: history then just stops). */
export async function readVersioning(folderAbsolutePath: string): Promise<VersioningFile | undefined> {
  try {
    return await readMeta(folderAbsolutePath, META_FILES.versioning);
  } catch (readError) {
    if (readError instanceof InvalidMetaError) {
      console.warn(`[ccm] ${readError.message}`);
      return undefined;
    }
    throw readError;
  }
}

/** Writes a folder's `versioning.json`, keeping the undo stack within its 200-entry cap. */
export async function writeVersioning(folderAbsolutePath: string, versioning: VersioningFile): Promise<VersioningFile> {
  return writeMeta(folderAbsolutePath, META_FILES.versioning, {
    ...versioning,
    undoStack: versioning.undoStack.slice(-UNDO_STACK_LIMIT),
    redoStack: versioning.redoStack.slice(-UNDO_STACK_LIMIT),
  });
}

function toRelative(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

/**
 * The versioned folder that `folderAbsolutePath` is or is inside, nearest first.
 *
 * @example
 * const scope = await findVersionedScope(storage.rootPath, "/data/notes/persona/drafts");
 */
export async function findVersionedScope(
  rootPath: string,
  folderAbsolutePath: string,
): Promise<VersionedScope | undefined> {
  for (const candidatePath of listAncestors(rootPath, folderAbsolutePath)) {
    if (!(await isScope(candidatePath))) continue;
    const versioning = await readVersioning(candidatePath);
    if (versioning?.enabled) {
      return { path: toRelative(rootPath, candidatePath), absolutePath: candidatePath, versioning };
    }
  }
  return undefined;
}

/**
 * The versioned folder an entry belongs to: the entry itself when it is a versioned folder, else
 * the nearest versioned folder around it.
 *
 * @example
 * const scope = await versionedScopeOf(storage.rootPath, "persona/notes.md", { isDirectory: false });
 */
export async function versionedScopeOf(
  rootPath: string,
  relativePath: string,
  { isDirectory }: { isDirectory: boolean },
): Promise<VersionedScope | undefined> {
  const absolutePath = relativePath === "" ? rootPath : joinStoragePath(rootPath, ...relativePath.split("/"));
  return findVersionedScope(rootPath, isDirectory ? absolutePath : path.dirname(absolutePath));
}

/** The path of `relativePath` inside a versioned folder at `scopePath` ("" when it is the folder). */
export function toScopeRelative(scopePath: string, relativePath: string): string {
  if (scopePath === "") return relativePath;
  return relativePath === scopePath ? "" : relativePath.slice(scopePath.length + 1);
}

/** Whether `relativePath` is inside (or is) the folder at `scopePath`. */
export function isInsideScope(scopePath: string, relativePath: string): boolean {
  return scopePath === "" || relativePath === scopePath || relativePath.startsWith(`${scopePath}/`);
}

/** The first versioned folder under `folderAbsolutePath` (not itself), as a relative path. */
export async function findVersionedDescendant(folderAbsolutePath: string): Promise<string | undefined> {
  const pendingFolders = [""];
  while (pendingFolders.length > 0) {
    const relativeFolder = pendingFolders.shift() ?? "";
    const absoluteFolder =
      relativeFolder === "" ? folderAbsolutePath : joinStoragePath(folderAbsolutePath, ...relativeFolder.split("/"));
    const children = await readdir(absoluteFolder, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || SKIPPED_NAMES.has(child.name.toLowerCase())) continue;
      const childRelative = relativeFolder === "" ? child.name : `${relativeFolder}/${child.name}`;
      const childAbsolute = joinStoragePath(absoluteFolder, child.name);
      if ((await isScope(childAbsolute)) && (await readVersioning(childAbsolute))?.enabled) return childRelative;
      pendingFolders.push(childRelative);
    }
  }
  return undefined;
}

/** Every versioned folder under `folderAbsolutePath` (not itself), as relative paths; they never nest. */
export async function listVersionedDescendants(folderAbsolutePath: string): Promise<string[]> {
  const found: string[] = [];
  const pendingFolders = [""];
  while (pendingFolders.length > 0) {
    const relativeFolder = pendingFolders.shift() ?? "";
    const absoluteFolder =
      relativeFolder === "" ? folderAbsolutePath : joinStoragePath(folderAbsolutePath, ...relativeFolder.split("/"));
    const children = await readdir(absoluteFolder, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory() || SKIPPED_NAMES.has(child.name.toLowerCase())) continue;
      const childRelative = relativeFolder === "" ? child.name : `${relativeFolder}/${child.name}`;
      const childAbsolute = joinStoragePath(absoluteFolder, child.name);
      if ((await isScope(childAbsolute)) && (await readVersioning(childAbsolute))?.enabled) found.push(childRelative);
      else pendingFolders.push(childRelative);
    }
  }
  return found;
}

/** The index rows last written, so listings don't rewrite an unchanged row. */
function getIndexCache(): Set<string> {
  return getGlobalSingleton("versioned-scope-index", () => new Set<string>());
}

type IndexListener = () => void;

function getIndexListeners(): Set<IndexListener> {
  return getGlobalSingleton("versioned-scope-index-listeners", () => new Set<IndexListener>());
}

/** Calls `listener` whenever a folder is added to or removed from the index; returns the unsubscribe. */
export function onVersionedScopesChanged(listener: IndexListener): () => void {
  getIndexListeners().add(listener);
  return () => getIndexListeners().delete(listener);
}

function notifyIndexListeners(): void {
  for (const listener of getIndexListeners()) listener();
}

/** Records a versioned folder in the `versioned_scopes` index (the external-change watcher reads it). */
export function recordVersionedScope(storageId: string, scopePath: string): void {
  const cacheKey = `${storageId}\u0000${scopePath}`;
  if (getIndexCache().has(cacheKey)) return;
  getDatabase()
    .orm.insert(versionedScopes)
    .values({ storageId, path: scopePath, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [versionedScopes.storageId, versionedScopes.path], set: { updatedAt: new Date() } })
    .run();
  getIndexCache().add(cacheKey);
  notifyIndexListeners();
}

/** Removes a folder (and, with `withDescendants`, everything recorded inside it) from the index. */
export function forgetVersionedScope(storageId: string, scopePath: string, { withDescendants = false } = {}): void {
  const { orm } = getDatabase();
  const rows = listVersionedScopeRows(storageId).filter(
    (row) => row.path === scopePath || (withDescendants && (scopePath === "" || row.path.startsWith(`${scopePath}/`))),
  );
  if (rows.length === 0) return;
  for (const row of rows) {
    orm
      .delete(versionedScopes)
      .where(and(eq(versionedScopes.storageId, storageId), eq(versionedScopes.path, row.path)))
      .run();
    getIndexCache().delete(`${storageId}\u0000${row.path}`);
  }
  notifyIndexListeners();
}

/** Every indexed versioned folder, optionally of one storage. */
export function listVersionedScopeRows(storageId?: string): VersionedScopeRow[] {
  const query = getDatabase().orm.select().from(versionedScopes);
  return storageId ? query.where(eq(versionedScopes.storageId, storageId)).all() : query.all();
}

/** Tells clients a versioned folder changed (`versioning.changed`). */
export function emitVersioningChange(storageId: string, scopePath: string, change: VersioningChangedEvent["change"]) {
  getEventBus().emit("versioning.changed", { storageId, path: scopePath, change });
}
