import "server-only";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { JobSummary, ProtectionState } from "@/lib/api-types";
import type { ProtectionMode } from "@/lib/protection";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { getJobQueue, registerJobType, type JobContext, type JobDefinition } from "@/server/jobs/queue";
import { effectiveState, readProtection } from "@/server/meta/effective";
import { META_FILES, type ProtectionFile } from "@/server/meta/schemas";
import { deleteMeta, metaDirectoryOf, metaFilePath, writeMeta } from "@/server/meta/store";
import {
  applyReadOnly,
  createPermissionSystem,
  readRecordedFileModes,
  readRecordedModes,
  restoreMode,
  restoreUnrecorded,
  walkProtectable,
  writeRecordedModes,
  type PermissionSystem,
  type ProtectableEntry,
} from "@/server/protection/os-perms";
import { findProtectedInside, isScopeBusy, markScopeBusy, recordProtectedScope } from "@/server/protection/scopes";
import { resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import { getSetting } from "@/server/settings/store";
import type { FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess, type ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

export const PROTECTION_JOB_TYPE = "protection.apply";

export interface ProtectionJobPayload {
  storageId: string;
  path: string;
  mode: ProtectionMode;
  actor: FileActor;
}

type PermissionSystemFactory = (options: { useImmutableFlag: boolean }) => PermissionSystem;

function getPermissionSystemFactory(): { current: PermissionSystemFactory } {
  return getGlobalSingleton("protection-permission-system", () => ({ current: createPermissionSystem }));
}

/** Tests swap the permission system (for example to act as Windows). */
export function setPermissionSystemFactory(factory: PermissionSystemFactory | undefined): void {
  getPermissionSystemFactory().current = factory ?? createPermissionSystem;
}

function readPermissionSystem(useImmutableFlag = getSetting("protection.macosImmutable")): PermissionSystem {
  return getPermissionSystemFactory().current({ useImmutableFlag });
}

function toAbsolute(rootPath: string, relativePath: string): string {
  return relativePath === "" ? rootPath : joinStoragePath(rootPath, ...relativePath.split("/"));
}

function parentRelativePath(relativePath: string): string {
  const parentPath = path.posix.dirname(relativePath);
  return parentPath === "." ? "" : parentPath;
}

/** The mode inherited from parent folders (not counting the entry's own setting). */
async function readInheritedMode(
  rootPath: string,
  relativePath: string,
): Promise<{ mode: ProtectionMode; source?: string }> {
  if (relativePath === "") return { mode: "none" };
  const { protection } = await effectiveState(rootPath, parentRelativePath(relativePath), { isDirectory: true });
  return { mode: protection.mode, source: protection.source?.path };
}

/** The mode set on the entry itself. */
export async function readOwnProtection(
  rootPath: string,
  relativePath: string,
  isDirectory: boolean,
): Promise<ProtectionMode> {
  const absolutePath = toAbsolute(rootPath, relativePath);
  if (isDirectory) return (await readProtection(absolutePath))?.mode ?? "none";
  return (await readProtection(path.dirname(absolutePath)))?.files[path.basename(absolutePath)] ?? "none";
}

/**
 * Creates a folder's `.cmm/` even when the folder is already read-only (it sits inside another
 * protected folder): the folder gets its owner's write bit for a moment.
 */
async function ensureMetaWritable(folderAbsolutePath: string): Promise<void> {
  const metaDirectory = metaDirectoryOf(folderAbsolutePath);
  try {
    await mkdir(metaDirectory, { recursive: true, mode: 0o755 });
    return;
  } catch (mkdirError) {
    if ((mkdirError as NodeJS.ErrnoException).code !== "EACCES") throw mkdirError;
  }
  const folderMode = (await stat(folderAbsolutePath)).mode & 0o7777;
  await chmod(folderAbsolutePath, folderMode | 0o200);
  try {
    await mkdir(metaDirectory, { recursive: true, mode: 0o755 });
  } finally {
    await chmod(folderAbsolutePath, folderMode);
  }
}

async function isEncryptionBusy(folderAbsolutePath: string): Promise<boolean> {
  try {
    const crypto = JSON.parse(await readFile(metaFilePath(folderAbsolutePath, "crypto.json"), "utf8")) as {
      state?: unknown;
    };
    return crypto.state === "encrypting" || crypto.state === "decrypting" || crypto.state === "rekeying";
  } catch {
    return false;
  }
}

function describeActor(actor: FileActor): string {
  return actor.username ?? actor.id;
}

/** Moves recorded original modes to the nearest protected parent, which keeps the entries read-only. */
async function transferRecordsUp(
  rootPath: string,
  ancestorRelativePath: string,
  entryRelativePath: string,
  records: ReadonlyMap<string, number>,
): Promise<void> {
  if (records.size === 0) return;
  const ancestorAbsolutePath = toAbsolute(rootPath, ancestorRelativePath);
  const ancestorRecords = await readRecordedModes(ancestorAbsolutePath);
  const offset =
    ancestorRelativePath === "" ? entryRelativePath : entryRelativePath.slice(ancestorRelativePath.length + 1);
  for (const [recordPath, mode] of records) {
    ancestorRecords.set(recordPath === "" ? offset : `${offset}/${recordPath}`, mode);
  }
  await writeRecordedModes(ancestorAbsolutePath, ancestorRecords);
}

interface FolderChangeContext {
  storage: ActiveStorage;
  resolvedPath: ResolvedPath;
  mode: ProtectionMode;
  actor: FileActor;
  system: PermissionSystem;
  reportProgress?: JobContext<ProtectionJobPayload, undefined>["reportProgress"];
  signal?: AbortSignal;
}

async function collectEntries(folderAbsolutePath: string, signal?: AbortSignal): Promise<ProtectableEntry[]> {
  const entries: ProtectableEntry[] = [];
  for await (const entry of walkProtectable(folderAbsolutePath, signal)) entries.push(entry);
  return entries;
}

async function protectFolder(
  context: FolderChangeContext,
  existing: ProtectionFile | undefined,
  inheritedMode: ProtectionMode,
) {
  const { resolvedPath, mode, actor, system, reportProgress, signal } = context;
  const folderAbsolutePath = resolvedPath.absolutePath;
  const previousMode = existing?.mode ?? "none";
  await ensureMetaWritable(folderAbsolutePath);
  await writeMeta(folderAbsolutePath, META_FILES.protection, {
    v: 1,
    mode,
    setBy: describeActor(actor),
    setAt: new Date().toISOString(),
    files: existing?.files ?? {},
    immutable: existing?.immutable,
  });
  recordProtectedScope(context.storage.id, resolvedPath.relativePath, "folder", mode);
  if (inheritedMode !== "none") return;
  const entries = await collectEntries(folderAbsolutePath, signal);
  if (previousMode === "none") {
    const records = await readRecordedModes(folderAbsolutePath);
    for (const entry of entries) if (!records.has(entry.relativePath)) records.set(entry.relativePath, entry.mode);
    await writeRecordedModes(folderAbsolutePath, records);
    let done = 0;
    for (const entry of entries) {
      signal?.throwIfAborted();
      await applyReadOnly(system, entry);
      done += 1;
      reportProgress?.({ done, total: entries.length, unit: "files", currentItem: entry.relativePath });
    }
  }
  if (system.setImmutable && (mode === "locked") !== Boolean(existing?.immutable)) {
    await system.setImmutable(
      entries.map((entry) => entry.absolutePath),
      mode === "locked",
    );
    await writeMeta(folderAbsolutePath, META_FILES.protection, {
      ...(await readProtection(folderAbsolutePath)),
      immutable: mode === "locked",
    });
  }
}

async function unprotectFolder(
  context: FolderChangeContext,
  existing: ProtectionFile,
  inherited: { mode: ProtectionMode; source?: string },
) {
  const { storage, resolvedPath, reportProgress, signal } = context;
  const folderAbsolutePath = resolvedPath.absolutePath;
  const records = await readRecordedModes(folderAbsolutePath);
  const entries = await collectEntries(folderAbsolutePath, signal);
  if (existing.immutable) {
    await readPermissionSystem(true).setImmutable?.(
      entries.map((entry) => entry.absolutePath),
      false,
    );
  }
  if (inherited.mode !== "none" && inherited.source !== undefined) {
    await transferRecordsUp(resolvedPath.rootPath, inherited.source, resolvedPath.relativePath, records);
  } else {
    const nestedRows = findProtectedInside(storage.id, resolvedPath.relativePath);
    const transfers = new Map<string, Map<string, number>>();
    let done = 0;
    for (const entry of entries) {
      signal?.throwIfAborted();
      const entryPath =
        resolvedPath.relativePath === ""
          ? entry.relativePath
          : `${resolvedPath.relativePath}${entry.relativePath ? `/${entry.relativePath}` : ""}`;
      const owner = nestedRows.find(
        (row) => entryPath === row.path || (row.kind === "folder" && entryPath.startsWith(`${row.path}/`)),
      );
      const recordedMode = records.get(entry.relativePath);
      if (owner) {
        if (recordedMode !== undefined) {
          const ownerRecords = transfers.get(owner.path) ?? new Map<string, number>();
          ownerRecords.set(
            owner.kind === "file" ? "" : entryPath === owner.path ? "" : entryPath.slice(owner.path.length + 1),
            recordedMode,
          );
          transfers.set(owner.path, ownerRecords);
        }
      } else if (recordedMode === undefined) {
        await restoreUnrecorded(context.system, entry);
      } else {
        await restoreMode(context.system, entry.absolutePath, recordedMode);
      }
      done += 1;
      reportProgress?.({ done, total: entries.length, unit: "files", currentItem: entry.relativePath });
    }
    for (const [ownerPath, ownerRecords] of transfers) {
      const row = nestedRows.find((nestedRow) => nestedRow.path === ownerPath);
      const ownerAbsolutePath = toAbsolute(resolvedPath.rootPath, ownerPath);
      if (row?.kind === "file") {
        const parentAbsolutePath = path.dirname(ownerAbsolutePath);
        const fileModes = await readRecordedFileModes(parentAbsolutePath);
        const fileName = path.basename(ownerAbsolutePath);
        fileModes[fileName] ??= ownerRecords.get("") ?? 0o644;
        await writeRecordedModes(parentAbsolutePath, await readRecordedModes(parentAbsolutePath), fileModes);
      } else {
        const ownerExisting = await readRecordedModes(ownerAbsolutePath);
        for (const [recordPath, mode] of ownerRecords)
          if (!ownerExisting.has(recordPath)) ownerExisting.set(recordPath, mode);
        await writeRecordedModes(ownerAbsolutePath, ownerExisting);
      }
    }
  }
  await writeRecordedModes(folderAbsolutePath, new Map());
  if (Object.keys(existing.files).length > 0) {
    await writeMeta(folderAbsolutePath, META_FILES.protection, { v: 1, mode: "none", files: existing.files });
  } else {
    await deleteMeta(folderAbsolutePath, META_FILES.protection);
  }
  recordProtectedScope(storage.id, resolvedPath.relativePath, "folder", "none");
}

/** Applies a folder protection change (the `protection.apply` job body; tests call it directly). */
export async function changeFolderProtection(context: FolderChangeContext): Promise<void> {
  const { storage, resolvedPath, mode } = context;
  markScopeBusy(storage.id, resolvedPath.relativePath, true);
  try {
    const existing = await readProtection(resolvedPath.absolutePath);
    const inherited = await readInheritedMode(resolvedPath.rootPath, resolvedPath.relativePath);
    if (mode === "none") {
      if (existing && existing.mode !== "none") await unprotectFolder(context, existing, inherited);
    } else {
      await protectFolder(context, existing, inherited.mode);
    }
  } finally {
    markScopeBusy(storage.id, resolvedPath.relativePath, false);
  }
  getEventBus().emit("fs.changed", { storageId: storage.id, path: resolvedPath.relativePath, change: "changed" });
  await notifyProtectionChanged();
}

/** Protects or unprotects one file; runs inline, it is quick. */
export async function changeFileProtection({
  storage,
  resolvedPath,
  mode,
  actor,
  system,
}: Omit<FolderChangeContext, "reportProgress" | "signal">): Promise<void> {
  const fileAbsolutePath = resolvedPath.absolutePath;
  const parentAbsolutePath = path.dirname(fileAbsolutePath);
  const fileName = path.basename(fileAbsolutePath);
  const parentPath = parentRelativePath(resolvedPath.relativePath);
  const { protection: parentProtection } = await effectiveState(resolvedPath.rootPath, parentPath, {
    isDirectory: true,
  });
  const existing = (await readProtection(parentAbsolutePath)) ?? { v: 1 as const, mode: "none" as const, files: {} };
  const previousMode = existing.files[fileName] ?? "none";
  const fileModes = await readRecordedFileModes(parentAbsolutePath);
  const folderRecords = await readRecordedModes(parentAbsolutePath);
  if (mode !== "none") {
    await ensureMetaWritable(parentAbsolutePath);
    await writeMeta(parentAbsolutePath, META_FILES.protection, {
      ...existing,
      files: { ...existing.files, [fileName]: mode },
      ...(existing.mode === "none" ? { setBy: describeActor(actor), setAt: new Date().toISOString() } : {}),
    });
    if (parentProtection.mode === "none" && previousMode === "none") {
      const fileStats = await stat(fileAbsolutePath);
      fileModes[fileName] ??= fileStats.mode & 0o7777;
      await writeRecordedModes(parentAbsolutePath, folderRecords, fileModes);
      await applyReadOnly(system, {
        absolutePath: fileAbsolutePath,
        mode: fileStats.mode & 0o7777,
        isDirectory: false,
      });
    }
  } else if (previousMode !== "none") {
    const recordedMode = fileModes[fileName];
    delete fileModes[fileName];
    if (parentProtection.mode !== "none" && parentProtection.source && recordedMode !== undefined) {
      await transferRecordsUp(
        resolvedPath.rootPath,
        parentProtection.source.path,
        resolvedPath.relativePath,
        new Map([["", recordedMode]]),
      );
    } else if (parentProtection.mode === "none") {
      if (recordedMode === undefined) {
        const fileStats = await stat(fileAbsolutePath);
        await restoreUnrecorded(system, {
          relativePath: "",
          absolutePath: fileAbsolutePath,
          mode: fileStats.mode & 0o7777,
          isDirectory: false,
        });
      } else {
        await restoreMode(system, fileAbsolutePath, recordedMode);
      }
    }
    await writeRecordedModes(parentAbsolutePath, await readRecordedModes(parentAbsolutePath), fileModes);
    const remainingFiles = { ...existing.files };
    delete remainingFiles[fileName];
    if (existing.mode === "none" && Object.keys(remainingFiles).length === 0) {
      await deleteMeta(parentAbsolutePath, META_FILES.protection);
    } else {
      await writeMeta(parentAbsolutePath, META_FILES.protection, { ...existing, files: remainingFiles });
    }
  }
  recordProtectedScope(storage.id, resolvedPath.relativePath, "file", mode);
  getEventBus().emit("fs.changed", { storageId: storage.id, path: resolvedPath.relativePath, change: "changed" });
  await notifyProtectionChanged();
}

type ProtectionListener = () => void | Promise<void>;

function getProtectionListeners(): Set<ProtectionListener> {
  return getGlobalSingleton("protection-listeners", () => new Set<ProtectionListener>());
}

/** Called after every protection change (the tamper watcher re-reads its folders). */
export function onProtectionChanged(listener: ProtectionListener): () => void {
  getProtectionListeners().add(listener);
  return () => getProtectionListeners().delete(listener);
}

async function notifyProtectionChanged(): Promise<void> {
  for (const listener of getProtectionListeners()) await listener();
}

export interface ProtectionChangeRequest {
  storage: ActiveStorage;
  path: string;
  mode: ProtectionMode;
  actor: FileActor;
  /** Checks the actor's password again; required to remove `locked`. */
  confirmPassword?: () => Promise<void>;
}

/**
 * Changes the protection of a folder or file. Editors and admins can set view-only and
 * locked; removing view-only is open to both, removing locked only to an admin who confirms their
 * password. Viewers can't change protection. A folder change runs as a `protection.apply` job
 * (large trees take a while); a file changes at once.
 *
 * @example
 * const { job } = await requestProtectionChange({ storage, path: "persona", mode: "locked", actor });
 */
export async function requestProtectionChange({
  storage,
  path: relativePath,
  mode,
  actor,
  confirmPassword,
}: ProtectionChangeRequest): Promise<{ mode: ProtectionMode; job?: JobSummary }> {
  if (actor.role === "viewer") throw new ApiRouteError(403, "FORBIDDEN", "Viewers can't change protection.");
  const resolvedPath = await resolveInStorage(storage, relativePath);
  if (resolvedPath.relativePath === "") {
    throw validationFailed("A storage's root folder can't be protected. Protect the folders inside it.");
  }
  const isDirectory = (await stat(resolvedPath.absolutePath)).isDirectory();
  const currentMode = await readOwnProtection(resolvedPath.rootPath, resolvedPath.relativePath, isDirectory);
  if (currentMode === mode) return { mode };
  if (currentMode === "locked") {
    if (actor.role !== "admin") {
      throw new ApiRouteError(403, "FORBIDDEN", "Only an admin can unlock a locked item.");
    }
    if (!confirmPassword) {
      throw new ApiRouteError(400, "VALIDATION_FAILED", "Confirm your password to unlock this item.");
    }
    await confirmPassword();
  }
  if (isScopeBusy(storage.id, resolvedPath.relativePath)) {
    throw new ApiRouteError(409, "SCOPE_BUSY", "A protection change is already running here. Wait for it to finish.");
  }
  if (await isEncryptionBusy(isDirectory ? resolvedPath.absolutePath : path.dirname(resolvedPath.absolutePath))) {
    throw new ApiRouteError(
      409,
      "SCOPE_BUSY",
      "This folder is being encrypted or decrypted. Try again when it finishes.",
    );
  }
  if (!isDirectory) {
    await changeFileProtection({ storage, resolvedPath, mode, actor, system: readPermissionSystem() });
    return { mode };
  }
  markScopeBusy(storage.id, resolvedPath.relativePath, true);
  try {
    const job = getJobQueue().enqueue<ProtectionJobPayload>(
      ensureProtectionJobType(),
      { storageId: storage.id, path: resolvedPath.relativePath, mode, actor },
      actor.id,
    );
    return { mode, job };
  } catch (enqueueError) {
    markScopeBusy(storage.id, resolvedPath.relativePath, false);
    throw enqueueError;
  }
}

const MODE_VERBS: Record<ProtectionMode, string> = {
  none: "Remove protection from",
  "view-only": "Make view-only:",
  locked: "Lock",
};

export const protectionJob: JobDefinition<ProtectionJobPayload, undefined> = {
  run: async ({ payload, reportProgress, signal }) => {
    const storage = requireStorageAccess(payload.actor, payload.storageId, "write");
    const resolvedPath = await resolveInStorage(storage, payload.path);
    await changeFolderProtection({
      storage,
      resolvedPath,
      mode: payload.mode,
      actor: payload.actor,
      system: readPermissionSystem(),
      reportProgress,
      signal,
    });
  },
  readVolumeKeys: (payload) => [payload.storageId],
  describe: (payload) => `${MODE_VERBS[payload.mode]} "${path.posix.basename(payload.path)}"`,
  autoResume: true,
};

export function ensureProtectionJobType(): string {
  registerJobType(PROTECTION_JOB_TYPE, protectionJob);
  return PROTECTION_JOB_TYPE;
}

/**
 * The protection of a folder or file for the Folder settings panel: effective and own mode, who
 * set it, a pending tamper alert, and whether a change is running.
 *
 * @example
 * const state = await readProtectionState(storage, "persona");
 */
export async function readProtectionState(storage: ActiveStorage, relativePath: string): Promise<ProtectionState> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const isDirectory = (await stat(resolvedPath.absolutePath)).isDirectory();
  const { protection } = await effectiveState(resolvedPath.rootPath, resolvedPath.relativePath, { isDirectory });
  const scopeFolder = isDirectory ? resolvedPath.absolutePath : path.dirname(resolvedPath.absolutePath);
  const protectionFile = await readProtection(scopeFolder);
  const own = await readOwnProtection(resolvedPath.rootPath, resolvedPath.relativePath, isDirectory);
  const platform = process.platform;
  const state: ProtectionState = {
    mode: protection.mode,
    own,
    isFile: !isDirectory,
    isBusy: isScopeBusy(storage.id, resolvedPath.relativePath),
    platform: platform === "darwin" || platform === "linux" || platform === "win32" ? platform : "other",
    isStrongLockEnabled: platform === "darwin" && getSetting("protection.macosImmutable"),
  };
  if (protection.source) state.source = protection.source;
  if (isDirectory && protectionFile?.mode !== "none") {
    if (protectionFile?.setBy) state.setBy = protectionFile.setBy;
    if (protectionFile?.setAt) state.setAt = protectionFile.setAt;
  }
  if (isDirectory && protectionFile?.violation) state.violation = protectionFile.violation;
  return state;
}

/** Clears a folder's tamper alert once someone has seen it. */
export async function dismissProtectionAlert(storage: ActiveStorage, relativePath: string): Promise<void> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const protectionFile = await readProtection(resolvedPath.absolutePath);
  if (!protectionFile?.violation) return;
  await writeMeta(resolvedPath.absolutePath, META_FILES.protection, { ...protectionFile, violation: undefined });
  getEventBus().emit("fs.changed", { storageId: storage.id, path: resolvedPath.relativePath, change: "changed" });
}
