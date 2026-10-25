import "server-only";
import { execFile } from "node:child_process";
import { chmod, lstat, readdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { isHiddenCmmName } from "@/server/security/path-jail";
import { META_FILES, parseModesChunk, type ProtectionModesFile } from "@/server/meta/schemas";
import {
  deleteMeta,
  ensureMetaDirectory,
  metaFilePath,
  readMeta,
  writeJsonAtomically,
  writeMeta,
} from "@/server/meta/store";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Entries per `protection-modes` file; bigger trees spill into `protection-modes.<n>.json`. */
export const MODES_CHUNK_SIZE = 25_000;
const CHFLAGS_BATCH_SIZE = 200;

/** How permission changes are made; tests pass a fake to cover other platforms. */
export interface PermissionSystem {
  platform: NodeJS.Platform;
  chmod: (absolutePath: string, mode: number) => Promise<void>;
  /** macOS "Strong lock": `chflags uchg` / `nouchg`. Undefined when unavailable or turned off. */
  setImmutable?: (absolutePaths: string[], isImmutable: boolean) => Promise<void>;
}

const runExecFile = promisify(execFile);

/**
 * The real permission system. On macOS, `useImmutableFlag` adds `chflags uchg` for locked folders
 * (the `protection.macosImmutable` setting).
 *
 * @example
 * const permissionSystem = createPermissionSystem({ useImmutableFlag: false });
 */
export function createPermissionSystem({ useImmutableFlag = false } = {}): PermissionSystem {
  const system: PermissionSystem = {
    platform: process.platform,
    chmod: (absolutePath, mode) => chmod(absolutePath, mode),
  };
  if (useImmutableFlag && process.platform === "darwin") {
    system.setImmutable = async (absolutePaths, isImmutable) => {
      for (let start = 0; start < absolutePaths.length; start += CHFLAGS_BATCH_SIZE) {
        await runExecFile("chflags", [
          isImmutable ? "uchg" : "nouchg",
          ...absolutePaths.slice(start, start + CHFLAGS_BATCH_SIZE),
        ]);
      }
    };
  }
  return system;
}

export interface ProtectableEntry {
  /** Relative to the walked folder, `/`-separated; "" is the folder. */
  relativePath: string;
  absolutePath: string;
  mode: number;
  isDirectory: boolean;
}

/**
 * Every entry of a folder protection applies to, parents first: the folder itself, its files and
 * subfolders. CMM's `.cmm*` entries and symlinks (which could point outside) are skipped.
 */
export async function* walkProtectable(
  folderAbsolutePath: string,
  signal?: AbortSignal,
): AsyncGenerator<ProtectableEntry> {
  const pending = [""];
  while (pending.length > 0) {
    signal?.throwIfAborted();
    const relativePath = pending.shift() ?? "";
    const absolutePath =
      relativePath === "" ? folderAbsolutePath : joinStoragePath(folderAbsolutePath, ...relativePath.split("/"));
    const entryStats = await lstat(absolutePath).catch(() => undefined);
    if (!entryStats || entryStats.isSymbolicLink()) continue;
    const isDirectory = entryStats.isDirectory();
    yield { relativePath, absolutePath, mode: entryStats.mode & 0o7777, isDirectory };
    if (!isDirectory) continue;
    const childNames = (await readdir(absolutePath).catch(() => [] as string[])).toSorted();
    pending.unshift(
      ...childNames
        .filter((childName) => !isHiddenCmmName(childName))
        .map((childName) => (relativePath === "" ? childName : `${relativePath}/${childName}`)),
    );
  }
}

/**
 * The read-only version of a mode, or undefined when the platform can't protect this kind of
 * entry. POSIX: every write bit cleared (`a-w`), on files and folders, so nothing can be created,
 * deleted or renamed inside. Windows: only files get the read-only attribute; folders can't be
 * made read-only this way.
 */
export function toReadOnlyMode(platform: NodeJS.Platform, mode: number, isDirectory: boolean): number | undefined {
  if (platform === "win32") return isDirectory ? undefined : 0o444;
  return mode & ~0o222;
}

/** Makes one entry read-only; returns whether anything was changed. */
export async function applyReadOnly(
  system: PermissionSystem,
  entry: Pick<ProtectableEntry, "absolutePath" | "mode" | "isDirectory">,
): Promise<boolean> {
  const readOnlyMode = toReadOnlyMode(system.platform, entry.mode, entry.isDirectory);
  if (readOnlyMode === undefined || readOnlyMode === entry.mode) return false;
  await system.chmod(entry.absolutePath, readOnlyMode);
  return true;
}

/** The recorded original modes of a protected folder (all chunks), by path relative to the folder. */
export async function readRecordedModes(folderAbsolutePath: string): Promise<Map<string, number>> {
  const modesFile = await readMeta(folderAbsolutePath, META_FILES.protectionModes);
  const recordedModes = new Map(Object.entries(modesFile?.entries ?? {}));
  for (let chunkIndex = 1; chunkIndex <= (modesFile?.chunkCount ?? 0); chunkIndex += 1) {
    const chunkPath = metaFilePath(folderAbsolutePath, `protection-modes.${chunkIndex}.json`);
    const chunk = parseModesChunk(JSON.parse(await readFile(chunkPath, "utf8")));
    for (const [relativePath, mode] of Object.entries(chunk.entries)) recordedModes.set(relativePath, mode);
  }
  return recordedModes;
}

/** Single-file original modes kept in a folder's `protection-modes.json`. */
export async function readRecordedFileModes(folderAbsolutePath: string): Promise<Record<string, number>> {
  return (await readMeta(folderAbsolutePath, META_FILES.protectionModes))?.files ?? {};
}

/**
 * Writes original modes, keeping single-file modes as they are. Large maps spill into
 * `protection-modes.<n>.json` chunks of 25,000 entries; an empty result removes the files.
 */
export async function writeRecordedModes(
  folderAbsolutePath: string,
  recordedModes: ReadonlyMap<string, number>,
  fileModes?: Record<string, number>,
): Promise<void> {
  const existing = await readMeta(folderAbsolutePath, META_FILES.protectionModes);
  const files = fileModes ?? existing?.files ?? {};
  const allEntries = [...recordedModes.entries()];
  const firstChunk = Object.fromEntries(allEntries.slice(0, MODES_CHUNK_SIZE));
  const chunkCount = Math.max(0, Math.ceil(allEntries.length / MODES_CHUNK_SIZE) - 1);
  if (chunkCount > 0) await ensureMetaDirectory(folderAbsolutePath);
  for (let chunkIndex = 1; chunkIndex <= Math.max(chunkCount, existing?.chunkCount ?? 0); chunkIndex += 1) {
    const chunkPath = metaFilePath(folderAbsolutePath, `protection-modes.${chunkIndex}.json`);
    if (chunkIndex > chunkCount) {
      await rm(chunkPath, { force: true });
      continue;
    }
    const entries = Object.fromEntries(
      allEntries.slice(chunkIndex * MODES_CHUNK_SIZE, (chunkIndex + 1) * MODES_CHUNK_SIZE),
    );
    await writeJsonAtomically(chunkPath, { v: 1, entries });
  }
  if (allEntries.length === 0 && Object.keys(files).length === 0) {
    await deleteMeta(folderAbsolutePath, META_FILES.protectionModes);
    return;
  }
  const document: ProtectionModesFile = {
    v: 1,
    platform: process.platform,
    entries: firstChunk,
    chunkCount,
    files,
  };
  await writeMeta(folderAbsolutePath, META_FILES.protectionModes, document);
}

/** Restores one entry's original mode; entries that disappeared are skipped. */
export async function restoreMode(system: PermissionSystem, absolutePath: string, mode: number): Promise<void> {
  try {
    await system.chmod(absolutePath, mode);
  } catch (chmodError) {
    if ((chmodError as NodeJS.ErrnoException).code !== "ENOENT") throw chmodError;
  }
}

/** Gives an entry that had no recorded mode (created while protected) its owner's write bit back. */
export async function restoreUnrecorded(system: PermissionSystem, entry: ProtectableEntry): Promise<void> {
  if (system.platform === "win32") {
    if (!entry.isDirectory) await system.chmod(entry.absolutePath, 0o666);
    return;
  }
  if ((entry.mode & 0o200) === 0) await system.chmod(entry.absolutePath, entry.mode | 0o200);
}
