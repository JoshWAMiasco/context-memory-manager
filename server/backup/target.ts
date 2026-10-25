import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import type { BackupMemory, BackupOptions } from "@/lib/api-types";
import { readMemoryFolderName } from "@/lib/backup";
import { formatSnapshotName, resolveTargetPath, sanitizeName, type PlanPart } from "@/server/backup/plan";
import type { BackupSpec } from "@/server/backup/profiles";
import { readVolumeInfo, type VolumeInfo } from "@/server/backup/volume";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { getJobQueue } from "@/server/jobs/queue";
import { findEncryptionScope, readManifest } from "@/server/meta/effective";
import { META_FILES } from "@/server/meta/schemas";
import { writeMeta } from "@/server/meta/store";
import { protectionGuard } from "@/server/protection/guard";
import { findProtectedInside } from "@/server/protection/scopes";
import { isInsideRoot, joinRelativePath, resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import type { FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess, type ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { findVersionedScope } from "@/server/versioning/scope";
import { isEncryptedTree, isVersionedTree } from "@/server/versioning/exclusivity";

/** One folder a run backs up, and where in the run's target it goes. */
export interface BackupPart {
  source: ResolvedPath;
  /** The folder inside the target it goes into: "" for the target itself, else a name of its own. */
  folder: string;
  /** That folder, relative to the destination storage. */
  targetPath: string;
}

/** Where a backup run reads and writes, checked and resolved. */
export interface BackupTarget {
  sourceStorage: ActiveStorage;
  destinationStorage: ActiveStorage;
  /** The folders being backed up: one for a folder backup, one or more for a memory backup. */
  parts: BackupPart[];
  /**
   * The folder the run writes into, relative to the destination storage: `<destination>/<source name>`
   * for a folder backup, the memory folder `<destination>/<memory folder>` for a memory backup, plus
   * `/<snapshot>` for a snapshot.
   */
  targetPath: string;
  targetAbsolutePath: string;
  /** A memory backup's memory folder (also the target, unless this is a snapshot). */
  memoryPath?: string;
  memoryAbsolutePath?: string;
  snapshotName?: string;
  volume: VolumeInfo;
}

/** The parts of a target as the planner takes them. */
export function toPlanParts(target: BackupTarget): PlanPart[] {
  return target.parts.map((part) => ({ sourceAbsolutePath: part.source.absolutePath, folder: part.folder }));
}

/**
 * The options a run plans with. A memory backup of one folder copies that folder's contents into
 * the memory folder, so the folder's own manifest is left out: the memory folder has its own
 * (`ensureMemoryFolder`).
 */
export function readRunOptions(target: BackupTarget, options: BackupOptions): BackupOptions {
  const [onlyPart] = target.parts;
  if (!target.memoryPath || target.parts.length !== 1 || onlyPart?.folder !== "") return options;
  return { ...options, excludes: [...options.excludes, `.cmm/${META_FILES.manifest}`] };
}

/** The name the source has on the destination: its folder name, or the storage's label for a storage root. */
export function readSourceName(sourceStorage: Pick<ActiveStorage, "label">, sourcePath: string): string {
  return sourcePath === "" ? sourceStorage.label : path.posix.basename(sourcePath);
}

async function exists(absolutePath: string): Promise<boolean> {
  return lstat(absolutePath).then(
    () => true,
    () => false,
  );
}

/** A snapshot folder name that isn't taken yet: the time, then `-2`, `-3`… within the same second. */
async function pickSnapshotName(parentAbsolutePath: string, now: Date): Promise<string> {
  const baseName = formatSnapshotName(now);
  if (!(await exists(joinStoragePath(parentAbsolutePath, baseName)))) return baseName;
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${baseName}-${attempt}`;
    if (!(await exists(joinStoragePath(parentAbsolutePath, candidate)))) return candidate;
  }
}

/**
 * Refuses backing up one part when it would break other rules: a destination that overlaps the
 * source, one inside an encrypted folder (backups copy bytes as they are, so plaintext would land
 * inside it), an encrypted or versioned folder backed up into a versioned one, a protected
 * destination, and a source that an encryption job is still working on.
 */
async function assertBackupAllowed(target: BackupTarget, part: BackupPart, actor: FileActor): Promise<void> {
  const { sourceStorage, destinationStorage } = target;
  const { source } = part;
  const partTargetAbsolutePath = (await resolveInStorage(destinationStorage, part.targetPath, { forCreate: true }))
    .absolutePath;
  const sourceAbsolutePath = source.realPath ?? source.absolutePath;
  // A memory backup must not overlap any of its folders anywhere in its memory folder.
  const overlapRoot = target.memoryAbsolutePath ?? target.targetAbsolutePath;
  if (isInsideRoot(sourceAbsolutePath, overlapRoot) || isInsideRoot(overlapRoot, sourceAbsolutePath)) {
    throw validationFailed("The destination can't be inside the folder being backed up, or contain it.");
  }
  const destinationRoot = (await resolveInStorage(destinationStorage, "")).rootPath;
  const encryptedAround = await findEncryptionScope(destinationRoot, partTargetAbsolutePath);
  if (encryptedAround) {
    throw validationFailed(
      `The destination is inside the encrypted folder "${encryptedAround.path}". Backups copy files exactly as they are, so choose a destination outside encrypted folders.`,
    );
  }
  const versionedAround = await findVersionedScope(destinationRoot, partTargetAbsolutePath);
  if (versionedAround && (await isEncryptedTree(source.absolutePath))) {
    throw new ApiRouteError(
      409,
      "VERSIONING_ENCRYPTION_CONFLICT",
      `Encrypted folders can't be backed up into the versioned folder "${versionedAround.path}". Choose another destination.`,
    );
  }
  if (versionedAround && (await isVersionedTree(source.absolutePath))) {
    throw new ApiRouteError(
      409,
      "NESTED_SCOPE",
      `A versioned folder can't be backed up into the versioned folder "${versionedAround.path}". Choose another destination.`,
    );
  }
  await protectionGuard({
    type: "copy",
    storageId: sourceStorage.id,
    path: source.relativePath,
    absolutePath: source.absolutePath,
    actor,
    isDirectory: true,
    destination: { storageId: destinationStorage.id, path: part.targetPath, absolutePath: partTargetAbsolutePath },
  });
  const protectedInside = findProtectedInside(destinationStorage.id, part.targetPath);
  if (protectedInside[0]) {
    throw new ApiRouteError(
      403,
      "CONTAINS_PROTECTED",
      `The destination holds the protected item "${protectedInside[0].path}", which a backup can't change. Remove its protection or choose another destination.`,
    );
  }
  const busyCryptoJob = getJobQueue()
    .listActive()
    .find(
      (job) =>
        job.type.startsWith("crypto.") &&
        job.target?.storageId === sourceStorage.id &&
        (isUnderPath(job.target.path, source.relativePath) || isUnderPath(source.relativePath, job.target.path)),
    );
  if (busyCryptoJob) {
    throw new ApiRouteError(
      409,
      "ENCRYPTION_IN_PROGRESS",
      `"${busyCryptoJob.title}" is still running in this folder. Back it up when it has finished.`,
    );
  }
}

/**
 * The folder each source of a memory backup gets inside the memory: its name (the storage's label
 * for the root), with " (2)", " (3)"… for names that repeat. Names are compared ignoring case, so
 * the folders stay apart on any drive.
 */
function readPartFolders(sourceStorage: ActiveStorage, sources: readonly ResolvedPath[]): string[] {
  const taken = new Set<string>();
  return sources.map((source) => {
    const baseName = sanitizeName(readSourceName(sourceStorage, source.relativePath));
    let folder = baseName;
    for (let attempt = 2; taken.has(folder.toLowerCase()); attempt += 1) folder = `${baseName} (${attempt})`;
    taken.add(folder.toLowerCase());
    return folder;
  });
}

/** A memory backup's folders must be folders, and none of them inside another. */
async function assertMemorySources(sources: readonly ResolvedPath[]): Promise<void> {
  for (const source of sources) {
    if (!(await stat(source.absolutePath)).isDirectory()) {
      throw validationFailed(`"${source.relativePath}" is not a folder. Only folders can be backed up.`);
    }
  }
  for (const source of sources) {
    const container = sources.find(
      (candidate) => candidate !== source && isUnderPath(source.relativePath, candidate.relativePath),
    );
    if (container) {
      throw validationFailed(
        `"${source.relativePath}" is inside "${container.relativePath || "the storage's top folder"}", which is backed up already. Choose one of them.`,
      );
    }
  }
}

function isUnderPath(candidatePath: string, folderPath: string): boolean {
  return folderPath === "" || candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`);
}

/**
 * Resolves and checks where a backup reads and writes: `read` access on the source storage and
 * `write` on the destination, both plugged in; the sources must be folders. A folder backup goes
 * into `<destination>/<source name>`. A memory backup goes into the memory folder
 * `<destination>/<memory folder>`: one folder's contents straight into it (so a memory cloned back
 * from a drive isn't nested), several folders into a folder each. A snapshot adds a new
 * `<YYYY-MM-DD_HH-mm-ss>` folder, unless `snapshotName` continues one. Then each folder is checked
 * against the rules of `assertBackupAllowed`.
 *
 * @example
 * const target = await resolveBackupTarget(actor, spec);
 */
export async function resolveBackupTarget(
  actor: FileActor,
  spec: BackupSpec,
  { snapshotName }: { snapshotName?: string } = {},
): Promise<BackupTarget> {
  const sourceStorage = requireStorageAccess(actor, spec.source.storageId, "read");
  const destinationStorage = requireStorageAccess(actor, spec.destination.storageId, "write");
  const sourcePaths = spec.memory ? spec.memory.paths : [spec.source.path];
  const sources = await Promise.all(sourcePaths.map((sourcePath) => resolveInStorage(sourceStorage, sourcePath)));
  const [firstSource] = sources;
  if (!firstSource) throw validationFailed("Choose a folder to back up.");
  if (spec.memory) await assertMemorySources(sources);
  else if (!(await stat(firstSource.absolutePath)).isDirectory()) throw validationFailed("Choose a folder to back up.");
  const destinationFolder = await resolveInStorage(destinationStorage, spec.destination.path, { forCreate: true });
  const destinationStats = await stat(destinationFolder.absolutePath).catch(() => undefined);
  if (destinationStats && !destinationStats.isDirectory()) throw validationFailed("The destination is not a folder.");

  const containerName = spec.memory
    ? readMemoryFolderName(spec.memory.name)
    : readSourceName(sourceStorage, firstSource.relativePath);
  const parentPath = resolveTargetPath(destinationFolder.relativePath, containerName, "copy");
  let chosenSnapshot: string | undefined;
  if (spec.mode === "snapshot") {
    const parent = await resolveInStorage(destinationStorage, parentPath, { forCreate: true });
    chosenSnapshot = snapshotName ?? (await pickSnapshotName(parent.absolutePath, new Date()));
  }
  const targetPath = resolveTargetPath(destinationFolder.relativePath, containerName, spec.mode, chosenSnapshot);
  const resolvedTarget = await resolveInStorage(destinationStorage, targetPath, { forCreate: true });
  const folders = sources.length > 1 ? readPartFolders(sourceStorage, sources) : [""];
  const target: BackupTarget = {
    sourceStorage,
    destinationStorage,
    parts: sources.map((source, sourceIndex) => {
      const folder = folders[sourceIndex] ?? "";
      return {
        source,
        folder,
        targetPath: folder === "" ? resolvedTarget.relativePath : joinRelativePath(resolvedTarget.relativePath, folder),
      };
    }),
    targetPath: resolvedTarget.relativePath,
    targetAbsolutePath: resolvedTarget.absolutePath,
    snapshotName: chosenSnapshot,
    volume: await readVolumeInfo(destinationStorage, resolvedTarget.rootPath),
  };
  if (spec.memory) {
    const memoryFolder = await resolveInStorage(destinationStorage, parentPath, { forCreate: true });
    target.memoryPath = memoryFolder.relativePath;
    target.memoryAbsolutePath = memoryFolder.absolutePath;
  }
  for (const part of target.parts) await assertBackupAllowed(target, part, actor);
  return target;
}

/** A memory description that says where a memory backup's folders came from. */
function describeOrigin(target: BackupTarget): string {
  const folderPaths = target.parts.map((part) => part.source.relativePath || target.sourceStorage.label);
  return `Backed up from "${target.sourceStorage.label}" on ${hostname()}: ${folderPaths.join(", ")}.`.slice(0, 2000);
}

/**
 * Makes a memory backup's folder a memory, so CMM finds it on the drive, also on another
 * computer: creates the folder, and writes its manifest unless it already is a memory. A backup of
 * one memory keeps that memory's description, icon, colour and template, so a clone looks like
 * the original under its new name; otherwise the description says where the folders came from.
 * A run calls it before copying, so even an interrupted first run leaves a memory behind.
 *
 * @example
 * await ensureMemoryFolder(target, spec.memory);
 */
export async function ensureMemoryFolder(target: BackupTarget, memory: BackupMemory): Promise<void> {
  if (!target.memoryAbsolutePath) return;
  await mkdir(target.memoryAbsolutePath, { recursive: true });
  const existing = await readManifest(target.memoryAbsolutePath);
  if (existing?.kind === "memory") return;
  const [onlyPart] = target.parts;
  const sourceManifest =
    target.parts.length === 1 && onlyPart ? await readManifest(onlyPart.source.absolutePath) : undefined;
  const original = sourceManifest?.kind === "memory" ? sourceManifest : undefined;
  await writeMeta(target.memoryAbsolutePath, META_FILES.manifest, {
    v: 1,
    kind: "memory",
    id: existing?.id ?? randomUUID(),
    name: memory.name,
    description: original?.description || describeOrigin(target),
    icon: original?.icon,
    color: original?.color,
    template: original?.template,
    createdAt: new Date().toISOString(),
  });
}
