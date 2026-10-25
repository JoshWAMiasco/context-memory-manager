import "server-only";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { formatSnapshotName, resolveTargetPath } from "@/server/backup/plan";
import type { BackupSpec } from "@/server/backup/profiles";
import { readVolumeInfo, type VolumeInfo } from "@/server/backup/volume";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { getJobQueue } from "@/server/jobs/queue";
import { findEncryptionScope } from "@/server/meta/effective";
import { protectionGuard } from "@/server/protection/guard";
import { findProtectedInside } from "@/server/protection/scopes";
import { isInsideRoot, resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import type { FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess, type ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { findVersionedScope } from "@/server/versioning/scope";
import { isEncryptedTree, isVersionedTree } from "@/server/versioning/exclusivity";

/** Where a backup run reads and writes, checked and resolved. */
export interface BackupTarget {
  sourceStorage: ActiveStorage;
  destinationStorage: ActiveStorage;
  /** The folder being backed up. */
  source: ResolvedPath;
  /** The folder the files go into: `<destination>/<source name>[/<snapshot>]`, relative to the destination storage. */
  targetPath: string;
  targetAbsolutePath: string;
  snapshotName?: string;
  volume: VolumeInfo;
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
 * Refuses backups that would break other rules: a destination that overlaps the source, one
 * inside an encrypted folder (backups copy bytes as they are, so plaintext would land inside it),
 * an encrypted or versioned folder backed up into a versioned one, a protected destination
 *, and a source that an encryption job is still working on.
 */
async function assertBackupAllowed(target: BackupTarget, actor: FileActor): Promise<void> {
  const { source, sourceStorage, destinationStorage, targetPath, targetAbsolutePath } = target;
  const sourceAbsolutePath = source.realPath ?? source.absolutePath;
  if (isInsideRoot(sourceAbsolutePath, targetAbsolutePath) || isInsideRoot(targetAbsolutePath, sourceAbsolutePath)) {
    throw validationFailed("The destination can't be inside the folder being backed up, or contain it.");
  }
  const destinationRoot = (await resolveInStorage(destinationStorage, "")).rootPath;
  const encryptedAround = await findEncryptionScope(destinationRoot, targetAbsolutePath);
  if (encryptedAround) {
    throw validationFailed(
      `The destination is inside the encrypted folder "${encryptedAround.path}". Backups copy files exactly as they are, so choose a destination outside encrypted folders.`,
    );
  }
  const versionedAround = await findVersionedScope(destinationRoot, targetAbsolutePath);
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
    destination: { storageId: destinationStorage.id, path: targetPath, absolutePath: targetAbsolutePath },
  });
  const protectedInside = findProtectedInside(destinationStorage.id, targetPath);
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

function isUnderPath(candidatePath: string, folderPath: string): boolean {
  return folderPath === "" || candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`);
}

/**
 * Resolves and checks where a backup reads and writes: `read` access on the
 * source storage and `write` on the destination, both plugged in; the source must be a folder;
 * the target is `<destination>/<source name>` (plus a new `<YYYY-MM-DD_HH-mm-ss>` folder for a
 * snapshot, unless `snapshotName` continues one); then the safety rules of `assertBackupAllowed`.
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
  const source = await resolveInStorage(sourceStorage, spec.source.path);
  if (!(await stat(source.absolutePath)).isDirectory()) throw validationFailed("Choose a folder to back up.");
  const destinationFolder = await resolveInStorage(destinationStorage, spec.destination.path, { forCreate: true });
  const destinationStats = await stat(destinationFolder.absolutePath).catch(() => undefined);
  if (destinationStats && !destinationStats.isDirectory()) throw validationFailed("The destination is not a folder.");

  const sourceName = readSourceName(sourceStorage, source.relativePath);
  const parentPath = resolveTargetPath(destinationFolder.relativePath, sourceName, "copy");
  let chosenSnapshot: string | undefined;
  if (spec.mode === "snapshot") {
    const parent = await resolveInStorage(destinationStorage, parentPath, { forCreate: true });
    chosenSnapshot = snapshotName ?? (await pickSnapshotName(parent.absolutePath, new Date()));
  }
  const targetPath = resolveTargetPath(destinationFolder.relativePath, sourceName, spec.mode, chosenSnapshot);
  const resolvedTarget = await resolveInStorage(destinationStorage, targetPath, { forCreate: true });
  const target: BackupTarget = {
    sourceStorage,
    destinationStorage,
    source,
    targetPath: resolvedTarget.relativePath,
    targetAbsolutePath: resolvedTarget.absolutePath,
    snapshotName: chosenSnapshot,
    volume: await readVolumeInfo(destinationStorage, resolvedTarget.rootPath),
  };
  await assertBackupAllowed(target, actor);
  return target;
}
