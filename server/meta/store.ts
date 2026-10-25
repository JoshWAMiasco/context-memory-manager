import "server-only";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readdir, readFile, rename, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { parseMetaDocument, type MetaData, type MetaFileName } from "@/server/meta/schemas";
import { joinStoragePath } from "@/server/storage/storage-path";

/** The folder that makes a folder a scope (overview §6). */
export const META_DIRECTORY = ".cmm";

const CACHE_LIMIT = 4000;

interface CachedMeta {
  mtimeMs: number;
  size: number;
  /** The parsed document, or the error that reading it raised. */
  value: unknown;
  error?: Error;
}

function getMetaCache(): Map<string, CachedMeta> {
  return getGlobalSingleton("meta-cache", () => new Map<string, CachedMeta>());
}

/** The `.cmm/` folder of a scope. */
export function metaDirectoryOf(scopeAbsolutePath: string): string {
  return joinStoragePath(scopeAbsolutePath, META_DIRECTORY);
}

/** The path of one metadata file of a scope. */
export function metaFilePath(scopeAbsolutePath: string, fileName: string): string {
  return joinStoragePath(scopeAbsolutePath, META_DIRECTORY, fileName);
}

/** Thrown by `readMeta` for a metadata file that exists but can't be used. */
export class InvalidMetaError extends Error {
  override name = "InvalidMetaError";
}

/**
 * Reads and validates a `.cmm/` file, or undefined when it doesn't exist. Results are
 * cached by path, modification time and size, so a changed file (by CMM, the watcher or another
 * program) is read again. Throws `InvalidMetaError` for a file that is damaged or too new.
 *
 * @example
 * const manifest = await readMeta(folderPath, "manifest.json");
 */
export async function readMeta<FileName extends MetaFileName>(
  scopeAbsolutePath: string,
  fileName: FileName,
): Promise<MetaData<FileName> | undefined> {
  const filePath = metaFilePath(scopeAbsolutePath, fileName);
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return undefined;
  }
  const cache = getMetaCache();
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
    if (cached.error) throw cached.error;
    return cached.value as MetaData<FileName>;
  }
  const entry: CachedMeta = { mtimeMs: fileStats.mtimeMs, size: fileStats.size, value: undefined };
  try {
    entry.value = parseMetaDocument(fileName, JSON.parse(await readFile(filePath, "utf8")));
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    entry.error = new InvalidMetaError(
      `${path.basename(scopeAbsolutePath)}/.cmm/${fileName} can't be read: ${(readError as Error).message}`,
    );
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? "");
  cache.set(filePath, entry);
  if (entry.error) throw entry.error;
  return entry.value as MetaData<FileName>;
}

/** Drops cached copies of a scope's metadata (or of one file). */
export function invalidateMeta(scopeAbsolutePath: string, fileName?: string): void {
  const cache = getMetaCache();
  if (fileName) {
    cache.delete(metaFilePath(scopeAbsolutePath, fileName));
    return;
  }
  const prefix = `${metaDirectoryOf(scopeAbsolutePath)}${path.sep}`;
  for (const cachedPath of cache.keys()) if (cachedPath.startsWith(prefix)) cache.delete(cachedPath);
}

/**
 * Creates the scope's `.cmm/` folder if needed. It stays writable by its owner even inside a
 * protected folder, so CMM can keep its metadata up to date.
 */
export async function ensureMetaDirectory(scopeAbsolutePath: string): Promise<string> {
  const metaDirectory = metaDirectoryOf(scopeAbsolutePath);
  await mkdir(metaDirectory, { recursive: true, mode: 0o755 });
  return metaDirectory;
}

/** Writes JSON to `filePath` atomically: a temporary file next to it, fsync, then rename. */
export async function writeJsonAtomically(filePath: string, document: unknown): Promise<void> {
  const temporaryPath = joinStoragePath(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const fileHandle = await open(temporaryPath, "w", 0o644);
  try {
    await fileHandle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }
  try {
    await rename(temporaryPath, filePath);
  } catch (renameError) {
    await rm(temporaryPath, { force: true });
    throw renameError;
  }
}

/**
 * Validates and writes a `.cmm/` file atomically, creating `.cmm/` when it is missing.
 * Returns the stored document.
 *
 * @example
 * await writeMeta(folderPath, "protection.json", { v: 1, mode: "locked", files: {} });
 */
export async function writeMeta<FileName extends MetaFileName>(
  scopeAbsolutePath: string,
  fileName: FileName,
  document: MetaData<FileName> | Record<string, unknown>,
): Promise<MetaData<FileName>> {
  const parsedDocument = parseMetaDocument(fileName, document);
  await ensureMetaDirectory(scopeAbsolutePath);
  const filePath = metaFilePath(scopeAbsolutePath, fileName);
  await chmod(filePath, 0o644).catch(() => undefined);
  await writeJsonAtomically(filePath, parsedDocument);
  invalidateMeta(scopeAbsolutePath, fileName);
  return parsedDocument;
}

/** Deletes a `.cmm/` file, and the `.cmm/` folder when nothing else is left in it. */
export async function deleteMeta(scopeAbsolutePath: string, fileName: string): Promise<void> {
  await rm(metaFilePath(scopeAbsolutePath, fileName), { force: true });
  invalidateMeta(scopeAbsolutePath, fileName);
  const metaDirectory = metaDirectoryOf(scopeAbsolutePath);
  const remaining = await readdir(metaDirectory).catch(() => undefined);
  if (remaining?.length === 0) await rmdir(metaDirectory).catch(() => undefined);
}

/** Whether a folder has a `.cmm/` folder, i.e. is a scope. */
export async function isScope(folderAbsolutePath: string): Promise<boolean> {
  try {
    return (await stat(metaDirectoryOf(folderAbsolutePath))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The folders from `absolutePath` up to the storage root (both included) that are scopes, nearest
 * first. `absolutePath` must be inside `rootPath`.
 *
 * @example
 * await findScopes("/data/notes", "/data/notes/a/b"); // ["/data/notes/a/b", "/data/notes"] when both have .cmm/
 */
export async function findScopes(rootPath: string, absolutePath: string): Promise<string[]> {
  const candidates = listAncestors(rootPath, absolutePath);
  const flags = await Promise.all(candidates.map((candidate) => isScope(candidate)));
  return candidates.filter((_candidate, candidateIndex) => flags[candidateIndex]);
}

/** `absolutePath` and its parents up to `rootPath`, nearest first. */
export function listAncestors(rootPath: string, absolutePath: string): string[] {
  const relativePath = path.relative(rootPath, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return [];
  const segments = relativePath === "" ? [] : relativePath.split(path.sep);
  const ancestors: string[] = [];
  for (let segmentCount = segments.length; segmentCount >= 0; segmentCount -= 1) {
    ancestors.push(segmentCount === 0 ? rootPath : joinStoragePath(rootPath, ...segments.slice(0, segmentCount)));
  }
  return ancestors;
}
