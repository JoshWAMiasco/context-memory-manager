import "server-only";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { desc, eq, or } from "drizzle-orm";
import type {
  BackupEndpoint,
  BackupMemory,
  BackupMode,
  BackupOptions,
  BackupProfile,
  BackupProfileInput,
} from "@/lib/api-types";
import type { StorageAccessLevel } from "@/lib/api-types";
import { readMemoryFolderName } from "@/lib/backup";
import { readLatestRun } from "@/server/backup/runs";
import { getDatabase } from "@/server/db/client";
import { backupProfiles, storages } from "@/server/db/schema";
import { ApiRouteError, forbidden, notFound } from "@/server/http/api-error";
import { joinRelativePath, normalizeRelativePath, resolveInStorage } from "@/server/security/path-jail";
import { findActiveStorage, readAccessLevel, readReadOnlyReason, type StorageActor } from "@/server/storage/roots";

export type BackupProfileRow = typeof backupProfiles.$inferSelect;

/** Everything a run needs to know about what to back up, from a profile or an ad-hoc request. */
export interface BackupSpec {
  source: BackupEndpoint;
  destination: BackupEndpoint;
  mode: BackupMode;
  options: BackupOptions;
  autoResume: boolean;
  /** A memory backup: these folders of the source storage go into a new memory folder (`source.path` is unused). */
  memory?: BackupMemory;
}

function readStorageLabel(storageId: string): string {
  return (
    getDatabase().orm.select({ label: storages.label }).from(storages).where(eq(storages.id, storageId)).get()?.label ??
    "Unknown storage"
  );
}

export function readExcludes(profileRow: BackupProfileRow): string[] {
  try {
    const excludes: unknown = JSON.parse(profileRow.excludesJson);
    return Array.isArray(excludes) ? excludes.filter((exclude): exclude is string => typeof exclude === "string") : [];
  } catch {
    return [];
  }
}

function readMemory(profileRow: BackupProfileRow): BackupMemory | undefined {
  if (profileRow.memoryName === null || profileRow.memoryPathsJson === null) return undefined;
  try {
    const paths: unknown = JSON.parse(profileRow.memoryPathsJson);
    if (!Array.isArray(paths)) return undefined;
    return {
      name: profileRow.memoryName,
      paths: paths.filter((memoryPath): memoryPath is string => typeof memoryPath === "string"),
    };
  } catch {
    return undefined;
  }
}

/** The run settings saved in a profile. */
export function toBackupSpec(profileRow: BackupProfileRow): BackupSpec {
  const memory = readMemory(profileRow);
  return {
    source: { storageId: profileRow.sourceStorageId, path: profileRow.sourcePath },
    destination: { storageId: profileRow.destinationStorageId, path: profileRow.destinationPath },
    mode: profileRow.mode,
    options: {
      compare: profileRow.compare,
      verify: profileRow.verify,
      includeGit: profileRow.includeGit,
      excludes: readExcludes(profileRow),
      keepSnapshots: profileRow.keepSnapshots,
    },
    autoResume: profileRow.autoResume,
    ...(memory ? { memory } : {}),
  };
}

/** A profile as the Backup page shows it: storage labels, whether each is plugged in, and its last run. */
export function toBackupProfile(profileRow: BackupProfileRow): BackupProfile {
  const spec = toBackupSpec(profileRow);
  const describeEndpoint = (endpoint: BackupEndpoint) => ({
    ...endpoint,
    label: readStorageLabel(endpoint.storageId),
    available: findActiveStorage(endpoint.storageId)?.available === true,
  });
  const profile: BackupProfile = {
    id: profileRow.id,
    name: profileRow.name,
    source: describeEndpoint(spec.source),
    destination: describeEndpoint(spec.destination),
    mode: profileRow.mode,
    ...spec.options,
    ...(spec.memory ? { memory: spec.memory } : {}),
    autoRunOnConnect: profileRow.autoRunOnConnect,
    autoResume: profileRow.autoResume,
    lastRunAt: profileRow.lastRunAt?.toISOString() ?? null,
    createdAt: profileRow.createdAt.toISOString(),
    updatedAt: profileRow.updatedAt.toISOString(),
  };
  const lastRun = readLatestRun(profileRow.id);
  if (lastRun) profile.lastRun = lastRun;
  return profile;
}

/**
 * Checks that `actor` may use a storage for a backup: `read` on the source, `write` on the
 * destination. A drive that is unplugged right now still counts (a profile can name it), so this
 * reads the saved storage, not the plugged-in list; a plugged-in drive mounted read-only can't be
 * a destination. The path must be a valid storage path.
 */
export function requireEndpointAccess(actor: StorageActor, endpoint: BackupEndpoint, level: StorageAccessLevel): void {
  const storageRow = getDatabase().orm.select().from(storages).where(eq(storages.id, endpoint.storageId)).get();
  if (!storageRow) throw notFound("That storage does not exist.");
  const grantedLevel = readAccessLevel(actor, storageRow);
  if (!grantedLevel) throw forbidden(`You don't have access to "${storageRow.label}".`);
  if (level === "write" && grantedLevel !== "write")
    throw forbidden(`You can only read files in "${storageRow.label}".`);
  const activeStorage = level === "write" ? findActiveStorage(endpoint.storageId) : undefined;
  const readOnlyReason = activeStorage ? readReadOnlyReason(activeStorage) : undefined;
  if (readOnlyReason) throw forbidden(readOnlyReason);
  normalizeRelativePath(endpoint.path);
}

/**
 * Checks a request's source: `read` on the source storage, and every folder path of a memory
 * backup valid. Returns the request's memory with its paths normalized and duplicates removed.
 */
export function requireSourceAccess(
  actor: StorageActor,
  { source, memory }: { source: BackupEndpoint; memory?: BackupMemory },
): BackupMemory | undefined {
  requireEndpointAccess(actor, source, "read");
  if (!memory) return undefined;
  const paths = [...new Set(memory.paths.map((memoryPath) => normalizeRelativePath(memoryPath).join("/")))];
  return { name: memory.name.trim(), paths };
}

/**
 * A memory backup creates its memory folder on its first run, so a new memory (or one renamed, or
 * moved to another destination) can't take the name of a folder that is already there. Checked
 * only while the destination is plugged in.
 */
async function requireNewMemoryFolder(input: BackupProfileInput): Promise<void> {
  if (!input.memory) return;
  const destinationStorage = findActiveStorage(input.destination.storageId);
  if (!destinationStorage?.available) return;
  const folderName = readMemoryFolderName(input.memory.name);
  const memoryPath = joinRelativePath(normalizeRelativePath(input.destination.path).join("/"), folderName);
  const { absolutePath } = await resolveInStorage(destinationStorage, memoryPath, { forCreate: true });
  if (
    await lstat(absolutePath).then(
      () => true,
      () => false,
    )
  ) {
    throw new ApiRouteError(
      409,
      "ALREADY_EXISTS",
      `"${destinationStorage.label}" already has a folder named "${folderName}" there. Give the memory another name, or choose another destination folder.`,
    );
  }
}

/** Whether saving `input` over `profileRow` points the memory backup at another memory folder. */
function movesMemoryFolder(profileRow: BackupProfileRow, input: BackupProfileInput): boolean {
  const saved = readMemory(profileRow);
  if (!input.memory || !saved) return input.memory !== undefined;
  return (
    readMemoryFolderName(saved.name) !== readMemoryFolderName(input.memory.name) ||
    profileRow.destinationStorageId !== input.destination.storageId ||
    profileRow.destinationPath !== normalizeRelativePath(input.destination.path).join("/")
  );
}

function toProfileValues(input: BackupProfileInput) {
  return {
    name: input.name.trim(),
    sourceStorageId: input.source.storageId,
    sourcePath: input.memory ? "" : normalizeRelativePath(input.source.path).join("/"),
    memoryName: input.memory?.name.trim() ?? null,
    memoryPathsJson: input.memory ? JSON.stringify(input.memory.paths) : null,
    destinationStorageId: input.destination.storageId,
    destinationPath: normalizeRelativePath(input.destination.path).join("/"),
    mode: input.mode,
    compare: input.compare,
    verify: input.verify,
    includeGit: input.includeGit,
    excludesJson: JSON.stringify(input.excludes),
    autoRunOnConnect: input.autoRunOnConnect,
    autoResume: input.autoResume,
    keepSnapshots: input.mode === "snapshot" ? input.keepSnapshots : null,
    updatedAt: new Date(),
  };
}

/** The profiles `actor` made (admins see every profile), newest first. */
export function listProfiles(actor: StorageActor): BackupProfile[] {
  const query = getDatabase().orm.select().from(backupProfiles);
  const profileRows =
    actor.role === "admin"
      ? query.orderBy(desc(backupProfiles.createdAt)).all()
      : query.where(eq(backupProfiles.createdBy, actor.id)).orderBy(desc(backupProfiles.createdAt)).all();
  return profileRows.map(toBackupProfile);
}

/** A profile `actor` may see (their own, or any for admins), else 404. */
export function requireProfile(actor: StorageActor, profileId: string): BackupProfileRow {
  const profileRow = getDatabase().orm.select().from(backupProfiles).where(eq(backupProfiles.id, profileId)).get();
  if (!profileRow || (actor.role !== "admin" && profileRow.createdBy !== actor.id)) {
    throw notFound("That backup profile does not exist.");
  }
  return profileRow;
}

/**
 * Saves a new profile after checking `read` on its source and `write` on its destination. A
 * memory backup's memory folder must not exist yet.
 *
 * @example
 * await createProfile(actor, { name: "Notes → USB", source, destination, mode: "copy", … });
 */
export async function createProfile(actor: StorageActor, input: BackupProfileInput): Promise<BackupProfile> {
  const memory = requireSourceAccess(actor, input);
  requireEndpointAccess(actor, input.destination, "write");
  const checkedInput = { ...input, memory };
  await requireNewMemoryFolder(checkedInput);
  const profileRow = getDatabase()
    .orm.insert(backupProfiles)
    .values({ id: randomUUID(), ...toProfileValues(checkedInput), createdBy: actor.id })
    .returning()
    .get();
  return toBackupProfile(profileRow);
}

/**
 * Replaces a profile's settings (the editor always sends all of them). A memory backup that would
 * now write to another memory folder must not find one there yet.
 */
export async function updateProfile(
  actor: StorageActor,
  profileId: string,
  input: BackupProfileInput,
): Promise<BackupProfile> {
  const savedRow = requireProfile(actor, profileId);
  const memory = requireSourceAccess(actor, input);
  requireEndpointAccess(actor, input.destination, "write");
  const checkedInput = { ...input, memory };
  if (movesMemoryFolder(savedRow, checkedInput)) await requireNewMemoryFolder(checkedInput);
  const profileRow = getDatabase()
    .orm.update(backupProfiles)
    .set(toProfileValues(checkedInput))
    .where(eq(backupProfiles.id, profileId))
    .returning()
    .get();
  return toBackupProfile(profileRow);
}

/** Deletes a profile. Its History rows stay, without the link. */
export function deleteProfile(actor: StorageActor, profileId: string): void {
  requireProfile(actor, profileId);
  getDatabase().orm.delete(backupProfiles).where(eq(backupProfiles.id, profileId)).run();
}

/** Notes when a profile last started a run (auto-run waits an hour after it). */
export function markProfileRun(profileId: string, startedAt = new Date()): void {
  getDatabase().orm.update(backupProfiles).set({ lastRunAt: startedAt }).where(eq(backupProfiles.id, profileId)).run();
}

/** Profiles that run when `storageId` is plugged in: auto-run is on and it is their source or destination. */
export function findAutoRunProfiles(storageId: string): BackupProfileRow[] {
  return getDatabase()
    .orm.select()
    .from(backupProfiles)
    .where(or(eq(backupProfiles.sourceStorageId, storageId), eq(backupProfiles.destinationStorageId, storageId)))
    .all()
    .filter((profileRow) => profileRow.autoRunOnConnect);
}
