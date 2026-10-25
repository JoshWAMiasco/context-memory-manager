import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import type { FileEntry } from "@/lib/api-types";
import {
  slugifyMemoryName,
  type MemoryColor,
  type MemoryIcon,
  type MemoryStats,
  type MemorySummary,
} from "@/lib/memory";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { effectiveState, readManifest } from "@/server/meta/effective";
import { META_FILES, type Manifest } from "@/server/meta/schemas";
import { deleteMeta, metaDirectoryOf, writeMeta } from "@/server/meta/store";
import { findMemoryTemplate } from "@/server/memory/templates";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { assertValidName, isHiddenCcmName, joinRelativePath, resolveInStorage } from "@/server/security/path-jail";
import { createDirectory, createFile } from "@/server/storage/fs-ops";
import { readEntryBadges } from "@/server/storage/meta-badges";
import type { FileActor } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";

export interface MemoryFields {
  name: string;
  description?: string;
  icon?: MemoryIcon;
  color?: MemoryColor;
}

const STATS_CACHE_MILLISECONDS = 30_000;
const STATS_FILE_LIMIT = 50_000;
const RECENT_FILE_COUNT = 10;

/** The memory fields the client sees. */
export function toMemorySummary(manifest: Manifest): MemorySummary {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    color: manifest.color,
    template: manifest.template,
    createdAt: manifest.createdAt,
  };
}

/** Changing a memory's settings counts as a change: refused inside view-only and locked folders. */
async function requireUnprotectedFolder(rootPath: string, relativePath: string): Promise<void> {
  const { protection } = await effectiveState(rootPath, relativePath, { isDirectory: true });
  if (protection.mode === "none") return;
  throw new ApiRouteError(
    403,
    protection.mode === "locked" ? "PROTECTED_LOCKED" : "PROTECTED_VIEW_ONLY",
    `This folder is ${protection.mode === "locked" ? "locked" : "view-only"}, so its memory settings can't change.`,
  );
}

function emitFolderChange(storageId: string, relativePath: string): void {
  getEventBus().emit("fs.changed", { storageId, path: relativePath, change: "changed" });
}

/**
 * Creates a memory folder: the folder (named from `name` unless `folderName` is given),
 * its manifest, and the template's files. Files and folders go through the normal file operations,
 * so protection and events apply.
 *
 * @example
 * await createMemory(storage, "", { name: "Claude persona", template: "llm-persona" }, actor);
 */
export async function createMemory(
  storage: ActiveStorage,
  parentPath: string,
  { folderName, template: templateId = "blank", ...fields }: MemoryFields & { folderName?: string; template?: string },
  actor: FileActor,
): Promise<{ entry: FileEntry; memory: MemorySummary }> {
  const template = findMemoryTemplate(templateId);
  if (!template) throw validationFailed("That memory template doesn't exist.");
  const name = folderName?.trim() || slugifyMemoryName(fields.name);
  assertValidName(name);
  const memoryPath = joinRelativePath(parentPath, name);
  const target = await resolveInStorage(storage, memoryPath, { forCreate: true });
  if (
    await lstat(target.absolutePath).then(
      () => true,
      () => false,
    )
  ) {
    throw new ApiRouteError(409, "ALREADY_EXISTS", `A file or folder named "${name}" already exists here.`);
  }
  await createDirectory(storage, memoryPath, actor);
  const { absolutePath } = await resolveInStorage(storage, memoryPath);
  const manifest = await writeMeta(absolutePath, META_FILES.manifest, {
    v: 1,
    kind: "memory",
    id: randomUUID(),
    name: fields.name,
    description: fields.description ?? "",
    icon: fields.icon,
    color: fields.color,
    template: template.id,
    createdAt: new Date().toISOString(),
  });
  for (const templateFile of template.files) {
    const filePath = joinRelativePath(memoryPath, templateFile.path.replace(/\/$/, ""));
    if (templateFile.path.endsWith("/")) await createDirectory(storage, filePath, actor);
    else await createFile(storage, filePath, actor, templateFile.content);
  }
  const badges = await readEntryBadges(storage.rootPath, memoryPath, true);
  emitFolderChange(storage.id, memoryPath);
  return {
    entry: {
      name,
      path: memoryPath,
      type: "directory",
      size: 0,
      mtimeMs: Date.now(),
      createdMs: Date.now(),
      kind: "folder",
      hasChildren: template.files.length > 0,
      badges,
    },
    memory: toMemorySummary(manifest),
  };
}

async function requireFolder(storage: ActiveStorage, relativePath: string) {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  if (resolvedPath.relativePath === "") throw validationFailed("A storage's root folder can't be a memory.");
  if (!(await lstat(resolvedPath.absolutePath)).isDirectory()) throw validationFailed("Only folders can be memories.");
  return resolvedPath;
}

/**
 * Makes an existing folder a memory, keeping its contents. A folder that already has a
 * manifest keeps its id.
 *
 * @example
 * await convertToMemory(storage, "notes", { name: "Notes" });
 */
export async function convertToMemory(
  storage: ActiveStorage,
  relativePath: string,
  fields: MemoryFields,
): Promise<MemorySummary> {
  const resolvedPath = await requireFolder(storage, relativePath);
  await requireUnprotectedFolder(resolvedPath.rootPath, resolvedPath.relativePath);
  const existing = await readManifest(resolvedPath.absolutePath);
  const manifest = await writeMeta(resolvedPath.absolutePath, META_FILES.manifest, {
    v: 1,
    kind: "memory",
    id: existing?.id ?? randomUUID(),
    name: fields.name,
    description: fields.description ?? existing?.description ?? "",
    icon: fields.icon ?? existing?.icon,
    color: fields.color ?? existing?.color,
    template: existing?.template,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
  emitFolderChange(storage.id, resolvedPath.relativePath);
  return toMemorySummary(manifest);
}

/**
 * Turns a memory back into a plain folder: the manifest is removed, or kept with
 * `kind: "folder"` when other `.ccm/` files (protection, encryption…) are there.
 */
export async function convertToFolder(storage: ActiveStorage, relativePath: string): Promise<void> {
  const resolvedPath = await requireFolder(storage, relativePath);
  await requireUnprotectedFolder(resolvedPath.rootPath, resolvedPath.relativePath);
  const existing = await readManifest(resolvedPath.absolutePath);
  if (!existing) return;
  const otherMetaFiles = (await readdir(metaDirectoryOf(resolvedPath.absolutePath)).catch(() => [] as string[])).filter(
    (fileName) => fileName !== META_FILES.manifest,
  );
  if (otherMetaFiles.length > 0) {
    await writeMeta(resolvedPath.absolutePath, META_FILES.manifest, { ...existing, kind: "folder" });
  } else {
    await deleteMeta(resolvedPath.absolutePath, META_FILES.manifest);
  }
  emitFolderChange(storage.id, resolvedPath.relativePath);
}

/** Changes a memory's name, description, icon or colour. */
export async function updateMemory(
  storage: ActiveStorage,
  relativePath: string,
  patch: Partial<MemoryFields>,
): Promise<MemorySummary> {
  const resolvedPath = await requireFolder(storage, relativePath);
  const existing = await readManifest(resolvedPath.absolutePath);
  if (existing?.kind !== "memory") throw new ApiRouteError(404, "NOT_FOUND", "That folder is not a memory.");
  await requireUnprotectedFolder(resolvedPath.rootPath, resolvedPath.relativePath);
  const manifest = await writeMeta(resolvedPath.absolutePath, META_FILES.manifest, {
    ...existing,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  });
  emitFolderChange(storage.id, resolvedPath.relativePath);
  return toMemorySummary(manifest);
}

/** A folder's memory manifest, or undefined. */
export async function readMemory(storage: ActiveStorage, relativePath: string): Promise<MemorySummary | undefined> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const manifest = await readManifest(resolvedPath.absolutePath);
  return manifest?.kind === "memory" ? toMemorySummary(manifest) : undefined;
}

interface CachedStats {
  computedAt: number;
  stats: MemoryStats;
}

const MARKDOWN_PATTERN = /\.(md|markdown|mdx)$/i;

/**
 * File count, total size, Markdown count, last change and the 10 most recently changed files of a
 * folder, not counting `.ccm*`. Counting stops at 50,000 files (`isPartial`). Results are
 * cached for 30 seconds.
 *
 * @example
 * const stats = await memoryStats(storage, "persona");
 */
export async function memoryStats(storage: ActiveStorage, relativePath: string): Promise<MemoryStats> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const cacheKey = `${storage.id}\u0000${resolvedPath.relativePath}`;
  const cache = getGlobalSingleton("memory-stats-cache", () => new Map<string, CachedStats>());
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.computedAt < STATS_CACHE_MILLISECONDS) return cached.stats;

  const stats: MemoryStats = { fileCount: 0, totalBytes: 0, markdownCount: 0, recentFiles: [], isPartial: false };
  const pending = [""];
  while (pending.length > 0 && !stats.isPartial) {
    const folderPath = pending.pop() ?? "";
    const folderAbsolutePath =
      folderPath === ""
        ? resolvedPath.absolutePath
        : joinStoragePath(resolvedPath.absolutePath, ...folderPath.split("/"));
    const children = await readdir(folderAbsolutePath, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (isHiddenCcmName(child.name) || child.isSymbolicLink()) continue;
      const childPath = folderPath === "" ? child.name : `${folderPath}/${child.name}`;
      if (child.isDirectory()) {
        pending.push(childPath);
        continue;
      }
      const childStats = await lstat(joinStoragePath(folderAbsolutePath, child.name)).catch(() => undefined);
      if (!childStats) continue;
      stats.fileCount += 1;
      stats.totalBytes += childStats.size;
      if (MARKDOWN_PATTERN.test(child.name)) stats.markdownCount += 1;
      stats.lastModifiedMs = Math.max(stats.lastModifiedMs ?? 0, childStats.mtimeMs);
      stats.recentFiles.push({
        path: joinRelativePath(resolvedPath.relativePath, childPath),
        name: child.name,
        size: childStats.size,
        mtimeMs: childStats.mtimeMs,
      });
      if (stats.recentFiles.length > RECENT_FILE_COUNT * 4) {
        stats.recentFiles = stats.recentFiles
          .toSorted((first, second) => second.mtimeMs - first.mtimeMs)
          .slice(0, RECENT_FILE_COUNT);
      }
      if (stats.fileCount >= STATS_FILE_LIMIT) {
        stats.isPartial = true;
        break;
      }
    }
  }
  stats.recentFiles = stats.recentFiles
    .toSorted((first, second) => second.mtimeMs - first.mtimeMs)
    .slice(0, RECENT_FILE_COUNT);
  cache.set(cacheKey, { computedAt: Date.now(), stats });
  return stats;
}

/** Drops cached stats for a folder and its parents (after a change inside). */
export function invalidateMemoryStats(storageId: string, relativePath: string): void {
  const cache = getGlobalSingleton("memory-stats-cache", () => new Map<string, CachedStats>());
  for (const cacheKey of cache.keys()) {
    const [cachedStorageId, cachedPath = ""] = cacheKey.split("\u0000");
    if (
      cachedStorageId === storageId &&
      (cachedPath === "" || relativePath === cachedPath || relativePath.startsWith(`${cachedPath}/`))
    ) {
      cache.delete(cacheKey);
    }
  }
}
