import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { chownSync, existsSync } from "node:fs";
import path from "node:path";
import { and, asc, count, eq } from "drizzle-orm";
import { findPasswordPolicyProblem } from "@/lib/auth/policy";
import {
  adoptLegacyDatabaseFile,
  DATABASE_FILE_NAME,
  openDatabase,
  type CmmDatabase,
  type CmmOrm,
} from "@/server/db/client";
import { sessions, storages, users } from "@/server/db/schema";
import { readSeededRoots, writeSeededRoots } from "@/server/storage/seeded-roots";

/**
 * Opens the server's `cmm.db` while the service may be running (WAL and a busy timeout make that
 * safe). Returns undefined before the first start, so the CLI never creates the database itself.
 */
export function openExistingDatabase(dataDirectory: string): CmmDatabase | undefined {
  adoptLegacyDatabaseFile(dataDirectory);
  const databaseFile = path.join(dataDirectory, DATABASE_FILE_NAME);
  return existsSync(databaseFile) ? openDatabase(databaseFile) : undefined;
}

/**
 * Gives `cmm.db` and its WAL files back to the service account. SQLite creates `-wal` and `-shm`
 * with the opener's owner, so a root CLI run would otherwise lock the service out of its database.
 */
export function restoreDatabaseOwnership(dataDirectory: string, owner: { userId: number; groupId: number }): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const databaseFile = path.join(dataDirectory, `${DATABASE_FILE_NAME}${suffix}`);
    if (existsSync(databaseFile)) chownSync(databaseFile, owner.userId, owner.groupId);
  }
}

export interface AdminListing {
  username: string;
  disabled: boolean;
  lastLoginAt: Date | null;
}

export function listAdmins(orm: CmmOrm): AdminListing[] {
  return orm
    .select({ username: users.username, disabled: users.disabled, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.role, "admin"))
    .orderBy(asc(users.username))
    .all();
}

/** Setup is complete once an admin exists (as in `server/auth/setup.ts`). */
export function hasAdmin(orm: CmmOrm): boolean {
  return orm.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1).get() !== undefined;
}

export function countStorages(orm: CmmOrm): number {
  return orm.select({ storageCount: count() }).from(storages).get()?.storageCount ?? 0;
}

/** Letters and digits without look-alikes (0/O, 1/l/I), for a password read off a terminal. */
const TEMPORARY_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const TEMPORARY_PASSWORD_LENGTH = 16;

/** A random 16-character temporary password with at least one capital, one small letter and one digit. */
export function generateTemporaryPassword(): string {
  for (;;) {
    const password = Array.from(
      { length: TEMPORARY_PASSWORD_LENGTH },
      () => TEMPORARY_PASSWORD_ALPHABET[randomInt(TEMPORARY_PASSWORD_ALPHABET.length)],
    ).join("");
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)) return password;
  }
}

/**
 * Sets an admin's password to `passwordHash`, marks it for change at the next sign-in and deletes
 * the admin's sessions (the server checks the sessions table on every request). Throws when the
 * user doesn't exist or isn't an admin.
 */
export function setTemporaryAdminPassword(orm: CmmOrm, username: string, passwordHash: string): AdminListing {
  const admin = orm
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.role, "admin")))
    .get();
  if (!admin) throw new Error(`There is no admin named "${username}".`);
  orm.transaction((transaction) => {
    transaction.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, admin.id)).run();
    transaction.delete(sessions).where(eq(sessions.userId, admin.id)).run();
  });
  return { username: admin.username, disabled: admin.disabled, lastLoginAt: admin.lastLoginAt };
}

/** Checks a generated password against the sign-in policy (it always passes; this guards future policy changes). */
export function findTemporaryPasswordProblem(username: string, password: string): string | undefined {
  return findPasswordPolicyProblem(username, password);
}

/**
 * Registers `rootPath` as an internal storage right away, so it appears without waiting for the
 * service to seed it from the config, and remembers it as seeded. Returns false if it was already there.
 */
export function registerInternalStorage(orm: CmmOrm, rootPath: string, label: string): boolean {
  return orm.transaction((transaction) => {
    const seededRoots = new Set(readSeededRoots(transaction));
    seededRoots.add(rootPath);
    writeSeededRoots(transaction, seededRoots);
    const existingStorage = transaction
      .select({ id: storages.id })
      .from(storages)
      .where(and(eq(storages.kind, "internal"), eq(storages.rootPath, rootPath)))
      .get();
    if (existingStorage) return false;
    transaction.insert(storages).values({ id: randomUUID(), kind: "internal", label, rootPath }).run();
    return true;
  });
}

/** Unregisters the internal storage at `rootPath`. Files are never touched. Returns false if there was none. */
export function unregisterInternalStorage(orm: CmmOrm, rootPath: string): boolean {
  const removedStorages = orm
    .delete(storages)
    .where(and(eq(storages.kind, "internal"), eq(storages.rootPath, rootPath)))
    .returning({ id: storages.id })
    .all();
  return removedStorages.length > 0;
}
