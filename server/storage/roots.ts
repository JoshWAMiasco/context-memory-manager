import "server-only";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type {
  RegisteredStorage,
  StorageAccessEntry,
  StorageAccessLevel,
  StorageKind,
  StorageSummary,
  UserStorageAccess,
} from "@/lib/api-types";
import type { UserRole } from "@/lib/auth/policy";
import { getConfig, type CmmConfig } from "@/server/config";
import { getDatabase } from "@/server/db/client";
import { storageAccess, storages, users } from "@/server/db/schema";
import { ApiRouteError, forbidden, notFound, validationFailed } from "@/server/http/api-error";
import { getDriveMonitor, toDriveStorageId } from "@/server/storage/drives/monitor";
import type { Drive } from "@/server/storage/drives/provider";
import { readSeededRoots, writeSeededRoots } from "@/server/storage/seeded-roots";
import { getSetting } from "@/server/settings/store";

export type StorageRow = typeof storages.$inferSelect;

/** Who is asking: enough of a user to decide storage access. */
export interface StorageActor {
  id: string;
  role: UserRole;
}

/** A storage CMM can currently offer: an internal root, or an external drive that is plugged in. */
export interface ActiveStorage {
  id: string;
  kind: StorageKind;
  label: string;
  rootPath: string;
  hidden: boolean;
  /** False when the drive is not mounted. */
  available: boolean;
  drive?: Drive;
}

/**
 * Registers the default internal storages once: Home on the desktop, `storageRoots` from the
 * config file on a server. A root an admin removed later is not added back, because each seeded
 * path is remembered.
 */
export function ensureSeededStorages(config: CmmConfig = getConfig()): void {
  const seedRoots = config.mode === "desktop" ? [{ path: homedir(), label: "Home" }] : config.storageRoots;
  const { orm } = getDatabase();
  const seededRoots = new Set(readSeededRoots(orm));
  const newRoots = seedRoots.filter((seedRoot) => !seededRoots.has(path.resolve(seedRoot.path)));
  if (newRoots.length === 0) return;
  orm.transaction((transaction) => {
    for (const newRoot of newRoots) {
      const rootPath = path.resolve(newRoot.path);
      transaction
        .insert(storages)
        .values({
          id: config.mode === "desktop" ? "home" : randomUUID(),
          kind: "internal",
          label: newRoot.label,
          rootPath,
        })
        .onConflictDoNothing()
        .run();
      seededRoots.add(rootPath);
    }
    writeSeededRoots(transaction, seededRoots);
  });
}

/** Internal roots, plus the external drives that are plugged in right now. */
export function listActiveStorages(): ActiveStorage[] {
  const storageRows = getDatabase().orm.select().from(storages).all();
  const rowsById = new Map(storageRows.map((storageRow) => [storageRow.id, storageRow]));
  const activeStorages: ActiveStorage[] = storageRows
    .filter((storageRow) => storageRow.kind === "internal")
    .map((storageRow) => ({ ...storageRow, available: true }));
  for (const drive of getDriveMonitor().listDrives()) {
    const storageRow = rowsById.get(toDriveStorageId(drive.id));
    if (!storageRow) continue;
    activeStorages.push({
      ...storageRow,
      rootPath: drive.mountPath ?? storageRow.rootPath,
      available: drive.mountPath !== null,
      drive,
    });
  }
  return activeStorages;
}

export function findActiveStorage(storageId: string): ActiveStorage | undefined {
  return listActiveStorages().find((activeStorage) => activeStorage.id === storageId);
}

function readGrantedLevels(userId: string): Map<string, StorageAccessLevel> {
  const grants = getDatabase().orm.select().from(storageAccess).where(eq(storageAccess.userId, userId)).all();
  return new Map(grants.map((grant) => [grant.storageId, grant.level]));
}

/**
 * Why nothing can be written to a drive that is mounted read-only, or undefined when it can be
 * written to. macOS mounts NTFS drives read-only, which is the usual reason.
 *
 * @example
 * readReadOnlyReason(usbStick); // '"Miasco" is formatted as NTFS, which macOS can read but not write to. …'
 */
export function readReadOnlyReason(storage: Pick<ActiveStorage, "label" | "drive">): string | undefined {
  if (!storage.drive?.readOnly) return undefined;
  if (storage.drive.fsType.toLowerCase() === "ntfs" && process.platform === "darwin") {
    return `"${storage.label}" is formatted as NTFS, which macOS can read but not write to, so CMM can only view its files. To write to it, reformat it as exFAT in Disk Utility (this erases the drive), or install an NTFS driver.`;
  }
  return `"${storage.label}" is mounted read-only, so CMM can only view its files.`;
}

/**
 * What `actor` may do in a storage. Admins write everywhere. Others need a grant, capped at read
 * for viewers; hidden storages are admin-only. External drives without a grant are visible to
 * everyone (editors write, viewers read) only when `storage.newDrivesVisibleTo` is "all". A drive
 * mounted read-only is read for everyone.
 */
export function readAccessLevel(
  actor: StorageActor,
  storage: Pick<ActiveStorage, "id" | "kind" | "hidden"> & { drive?: Pick<Drive, "readOnly"> },
  grantedLevels: ReadonlyMap<string, StorageAccessLevel> = readGrantedLevels(actor.id),
): StorageAccessLevel | undefined {
  const level = readGrantedAccessLevel(actor, storage, grantedLevels);
  return level && storage.drive?.readOnly ? "read" : level;
}

function readGrantedAccessLevel(
  actor: StorageActor,
  storage: Pick<ActiveStorage, "id" | "kind" | "hidden">,
  grantedLevels: ReadonlyMap<string, StorageAccessLevel>,
): StorageAccessLevel | undefined {
  if (actor.role === "admin") return "write";
  if (storage.hidden) return undefined;
  const roleCeiling: StorageAccessLevel = actor.role === "viewer" ? "read" : "write";
  const grantedLevel = grantedLevels.get(storage.id);
  if (grantedLevel) return grantedLevel === "write" ? roleCeiling : "read";
  if (storage.kind !== "internal" && getSetting("storage.newDrivesVisibleTo") === "all") return roleCeiling;
  return undefined;
}

/** Whether `actor` may see events about `storageId` (the storage may be unplugged by now). */
export function canSeeStorage(actor: StorageActor, storageId: string): boolean {
  if (actor.role === "admin") return true;
  const storageRow = getDatabase().orm.select().from(storages).where(eq(storages.id, storageId)).get();
  return storageRow !== undefined && readAccessLevel(actor, storageRow) !== undefined;
}

function isEjectSupported(): boolean {
  return process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";
}

function toStorageSummary(storage: ActiveStorage, level: StorageAccessLevel, actor: StorageActor): StorageSummary {
  const summary: StorageSummary = {
    id: storage.id,
    kind: storage.kind,
    label: storage.label,
    available: storage.available,
    access: level,
    hidden: storage.hidden,
  };
  if (storage.drive) {
    summary.size = storage.drive.size;
    summary.used = storage.drive.used;
    summary.canEject = storage.available && isEjectSupported();
    summary.canMount = !storage.available && process.platform === "linux";
    summary.fsType = storage.drive.fsType;
    const readOnlyReason = readReadOnlyReason(storage);
    if (readOnlyReason) summary.readOnlyReason = readOnlyReason;
  }
  if (actor.role === "admin") summary.rootPath = storage.rootPath;
  return summary;
}

/** The storages `actor` can open, internal ones first, each group by label. */
export function listStoragesFor(actor: StorageActor): StorageSummary[] {
  const grantedLevels = readGrantedLevels(actor.id);
  const kindOrder: Record<StorageKind, number> = { internal: 0, external: 1, usb: 1 };
  return listActiveStorages()
    .flatMap((activeStorage) => {
      const level = readAccessLevel(actor, activeStorage, grantedLevels);
      return level ? [toStorageSummary(activeStorage, level, actor)] : [];
    })
    .toSorted(
      (first, second) => kindOrder[first.kind] - kindOrder[second.kind] || first.label.localeCompare(second.label),
    );
}

/**
 * The storage, if `actor` has at least `level` access and it is available. Throws 404 for an
 * unknown, unplugged or unmounted storage, 403 without access.
 */
export function requireStorageAccess(actor: StorageActor, storageId: string, level: StorageAccessLevel): ActiveStorage {
  const activeStorage = findActiveStorage(storageId);
  if (!activeStorage) throw notFound("That storage is not available.");
  const grantedLevel = readAccessLevel(actor, activeStorage);
  if (!grantedLevel) throw forbidden("You don't have access to this storage.");
  if (level === "write" && grantedLevel !== "write") {
    throw forbidden(readReadOnlyReason(activeStorage) ?? "You can only view files in this storage.");
  }
  if (!activeStorage.available) throw notFound("This drive is not mounted.");
  return activeStorage;
}

/**
 * Adds a folder as an internal storage (admin only). The path must be absolute, exist, be
 * a directory and be readable; it may not already be registered or sit inside CMM's data folder.
 */
export async function addInternalRoot(rootInput: string, label: string, createdBy: string): Promise<StorageRow> {
  if (!path.isAbsolute(rootInput)) throw validationFailed("Enter an absolute folder path.");
  const rootPath = path.resolve(rootInput);
  let rootStats;
  try {
    rootStats = await stat(rootPath);
    await access(rootPath, constants.R_OK);
  } catch {
    throw validationFailed("That folder does not exist or CMM can't read it.");
  }
  if (!rootStats.isDirectory()) throw validationFailed("That path is not a folder.");
  const dataDirectory = getConfig().dataDir;
  if (rootPath === dataDirectory || rootPath.startsWith(`${dataDirectory}${path.sep}`)) {
    throw validationFailed("CMM's own data folder can't be a storage.");
  }
  const { orm } = getDatabase();
  const existingRoot = orm
    .select()
    .from(storages)
    .where(and(eq(storages.kind, "internal"), eq(storages.rootPath, rootPath)))
    .get();
  if (existingRoot) throw new ApiRouteError(409, "ALREADY_EXISTS", `That folder is already "${existingRoot.label}".`);
  return orm
    .insert(storages)
    .values({ id: randomUUID(), kind: "internal", label: label.trim(), rootPath, createdBy })
    .returning()
    .get();
}

function requireStorageRow(storageId: string): StorageRow {
  const storageRow = getDatabase().orm.select().from(storages).where(eq(storages.id, storageId)).get();
  if (!storageRow) throw notFound("That storage does not exist.");
  return storageRow;
}

/** Renames or hides a storage (admin only). */
export function updateStorage(storageId: string, changes: { label?: string; hidden?: boolean }): StorageRow {
  requireStorageRow(storageId);
  const storageChanges: Partial<Pick<StorageRow, "label" | "hidden">> = {};
  if (changes.label !== undefined) storageChanges.label = changes.label.trim();
  if (changes.hidden !== undefined) storageChanges.hidden = changes.hidden;
  return getDatabase().orm.update(storages).set(storageChanges).where(eq(storages.id, storageId)).returning().get();
}

/**
 * Unregisters a storage (admin only). Files are never touched. A drive that is still plugged in
 * comes back on its next plug-in, with default access.
 */
export function removeStorage(storageId: string): void {
  requireStorageRow(storageId);
  getDatabase().orm.delete(storages).where(eq(storages.id, storageId)).run();
}

/** Every user with their access to `storageId`, for the admin access editor. */
export function listStorageAccess(storageId: string): StorageAccessEntry[] {
  const storageRow = requireStorageRow(storageId);
  const { orm } = getDatabase();
  const grantedLevels = new Map(
    orm
      .select()
      .from(storageAccess)
      .where(eq(storageAccess.storageId, storageId))
      .all()
      .map((grant) => [grant.userId, grant.level]),
  );
  return orm
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .orderBy(users.username)
    .all()
    .map((user) => {
      const grantedLevel = grantedLevels.get(user.id);
      const userGrants = new Map<string, StorageAccessLevel>(grantedLevel ? [[storageId, grantedLevel]] : []);
      return {
        userId: user.id,
        username: user.username,
        role: user.role,
        level: readAccessLevel(user, storageRow, userGrants) ?? "none",
      };
    });
}

/** Replaces the explicit grants of `storageId`. Admins always have full access, so their entries are ignored. */
export function setStorageAccess(
  storageId: string,
  grants: readonly { userId: string; level: StorageAccessLevel | "none" }[],
): StorageAccessEntry[] {
  requireStorageRow(storageId);
  const { orm } = getDatabase();
  const knownUsers = new Map(
    orm
      .select({ id: users.id, role: users.role })
      .from(users)
      .all()
      .map((user) => [user.id, user.role]),
  );
  orm.transaction((transaction) => {
    transaction.delete(storageAccess).where(eq(storageAccess.storageId, storageId)).run();
    for (const grant of grants) {
      const userRole = knownUsers.get(grant.userId);
      if (!userRole) throw validationFailed("One of the users does not exist.");
      if (grant.level === "none" || userRole === "admin") continue;
      transaction.insert(storageAccess).values({ storageId, userId: grant.userId, level: grant.level }).run();
    }
  });
  return listStorageAccess(storageId);
}

/** Every registered storage, including remembered drives that are unplugged (admin settings). */
export function listRegisteredStorages(): RegisteredStorage[] {
  const connectedIds = new Set(
    getDriveMonitor()
      .listDrives()
      .map((drive) => toDriveStorageId(drive.id)),
  );
  const kindOrder: Record<StorageKind, number> = { internal: 0, external: 1, usb: 1 };
  return getDatabase()
    .orm.select()
    .from(storages)
    .all()
    .map((storageRow) => ({
      id: storageRow.id,
      kind: storageRow.kind,
      label: storageRow.label,
      rootPath: storageRow.rootPath,
      hidden: storageRow.hidden,
      isConnected: storageRow.kind === "internal" || connectedIds.has(storageRow.id),
    }))
    .toSorted(
      (first, second) => kindOrder[first.kind] - kindOrder[second.kind] || first.label.localeCompare(second.label),
    );
}

function requireUserRow(userId: string) {
  const userRow = getDatabase()
    .orm.select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!userRow) throw notFound("That user does not exist.");
  return userRow;
}

/** One user's grant and effective access for every registered storage. */
export function listUserStorageAccess(userId: string): UserStorageAccess[] {
  const userRow = requireUserRow(userId);
  const grantedLevels = readGrantedLevels(userId);
  return getDatabase()
    .orm.select()
    .from(storages)
    .all()
    .map((storageRow): UserStorageAccess => ({
      storageId: storageRow.id,
      label: storageRow.label,
      kind: storageRow.kind,
      level: grantedLevels.get(storageRow.id) ?? "none",
      effectiveLevel: readAccessLevel(userRow, storageRow, grantedLevels) ?? "none",
    }))
    .toSorted((first, second) => first.label.localeCompare(second.label));
}

/** Replaces one user's grants across storages; storages left out keep their grants. */
export function setUserStorageAccess(
  userId: string,
  grants: readonly { storageId: string; level: StorageAccessLevel | "none" }[],
): UserStorageAccess[] {
  requireUserRow(userId);
  const { orm } = getDatabase();
  const knownStorageIds = new Set(
    orm
      .select({ id: storages.id })
      .from(storages)
      .all()
      .map((storageRow) => storageRow.id),
  );
  orm.transaction((transaction) => {
    for (const grant of grants) {
      if (!knownStorageIds.has(grant.storageId)) throw validationFailed("One of the storages does not exist.");
      transaction
        .delete(storageAccess)
        .where(and(eq(storageAccess.userId, userId), eq(storageAccess.storageId, grant.storageId)))
        .run();
      if (grant.level !== "none")
        transaction.insert(storageAccess).values({ userId, storageId: grant.storageId, level: grant.level }).run();
    }
  });
  return listUserStorageAccess(userId);
}
