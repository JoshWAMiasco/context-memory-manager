import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, or } from "drizzle-orm";
import type { BackupEndpoint, BackupMode, BackupOptions, BackupProfile, BackupProfileInput } from "@/lib/api-types";
import type { StorageAccessLevel } from "@/lib/api-types";
import { readLatestRun } from "@/server/backup/runs";
import { getDatabase } from "@/server/db/client";
import { backupProfiles, storages } from "@/server/db/schema";
import { forbidden, notFound } from "@/server/http/api-error";
import { normalizeRelativePath } from "@/server/security/path-jail";
import { findActiveStorage, readAccessLevel, type StorageActor } from "@/server/storage/roots";

export type BackupProfileRow = typeof backupProfiles.$inferSelect;

/** Everything a run needs to know about what to back up, from a profile or an ad-hoc request. */
export interface BackupSpec {
  source: BackupEndpoint;
  destination: BackupEndpoint;
  mode: BackupMode;
  options: BackupOptions;
  autoResume: boolean;
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

/** The run settings saved in a profile. */
export function toBackupSpec(profileRow: BackupProfileRow): BackupSpec {
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
 * reads the saved storage, not the plugged-in list. The path must be a valid storage path.
 */
export function requireEndpointAccess(actor: StorageActor, endpoint: BackupEndpoint, level: StorageAccessLevel): void {
  const storageRow = getDatabase().orm.select().from(storages).where(eq(storages.id, endpoint.storageId)).get();
  if (!storageRow) throw notFound("That storage does not exist.");
  const grantedLevel = readAccessLevel(actor, storageRow);
  if (!grantedLevel) throw forbidden(`You don't have access to "${storageRow.label}".`);
  if (level === "write" && grantedLevel !== "write")
    throw forbidden(`You can only read files in "${storageRow.label}".`);
  normalizeRelativePath(endpoint.path);
}

function toProfileValues(input: BackupProfileInput) {
  return {
    name: input.name.trim(),
    sourceStorageId: input.source.storageId,
    sourcePath: normalizeRelativePath(input.source.path).join("/"),
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
 * Saves a new profile after checking `read` on its source and `write` on its destination.
 *
 * @example
 * createProfile(actor, { name: "Notes → USB", source, destination, mode: "copy", … });
 */
export function createProfile(actor: StorageActor, input: BackupProfileInput): BackupProfile {
  requireEndpointAccess(actor, input.source, "read");
  requireEndpointAccess(actor, input.destination, "write");
  const profileRow = getDatabase()
    .orm.insert(backupProfiles)
    .values({ id: randomUUID(), ...toProfileValues(input), createdBy: actor.id })
    .returning()
    .get();
  return toBackupProfile(profileRow);
}

/** Replaces a profile's settings (the editor always sends all of them). */
export function updateProfile(actor: StorageActor, profileId: string, input: BackupProfileInput): BackupProfile {
  requireProfile(actor, profileId);
  requireEndpointAccess(actor, input.source, "read");
  requireEndpointAccess(actor, input.destination, "write");
  const profileRow = getDatabase()
    .orm.update(backupProfiles)
    .set(toProfileValues(input))
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
