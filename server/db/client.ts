import "server-only";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { LEGACY_DATABASE_FILE } from "@/lib/fs/legacy-names";
import { getConfig } from "@/server/config";
import * as schema from "@/server/db/schema";
import { clearGlobalSingleton, getGlobalSingleton } from "@/server/runtime/global-singleton";

export const DATABASE_FILE_NAME = "cmm.db";

/**
 * Renames a CCM-era `ccm.db` (and its `-wal` and `-shm` files) in `dataDirectory` to `cmm.db`,
 * when there is no `cmm.db` yet. Call it before opening the database.
 *
 * @example
 * adoptLegacyDatabaseFile(getConfig().dataDir);
 */
export function adoptLegacyDatabaseFile(dataDirectory: string): void {
  const databaseFile = path.join(dataDirectory, DATABASE_FILE_NAME);
  const legacyFile = path.join(dataDirectory, LEGACY_DATABASE_FILE);
  // eslint-disable-next-line no-inline-comments
  if (existsSync(/* turbopackIgnore: true */ databaseFile)) return;
  // eslint-disable-next-line no-inline-comments
  if (!existsSync(/* turbopackIgnore: true */ legacyFile)) return;
  for (const suffix of ["-wal", "-shm", ""]) {
    const legacyPath = `${legacyFile}${suffix}`;
    // eslint-disable-next-line no-inline-comments
    if (!existsSync(/* turbopackIgnore: true */ legacyPath)) continue;
    // eslint-disable-next-line no-inline-comments
    renameSync(/* turbopackIgnore: true */ legacyPath, `${databaseFile}${suffix}`);
  }
}

export type CmmOrm = BetterSQLite3Database<typeof schema>;

export interface CmmDatabase {
  connection: Database.Database;
  orm: CmmOrm;
}

/** Opens (creating if needed) the SQLite file with WAL journaling and foreign keys on. */
export function openDatabase(databaseFilePath: string): CmmDatabase {
  mkdirSync(path.dirname(databaseFilePath), { recursive: true, mode: 0o700 });
  const connection = new Database(databaseFilePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  return { connection, orm: drizzle({ client: connection, schema }) };
}

/** The process-wide database in `<dataDir>/cmm.db`. */
export function getDatabase(): CmmDatabase {
  return getGlobalSingleton("database", () => {
    const { dataDir } = getConfig();
    adoptLegacyDatabaseFile(dataDir);
    return openDatabase(path.join(dataDir, DATABASE_FILE_NAME));
  });
}

/** Closes the process-wide database, if it was opened. */
export function closeDatabase(): void {
  const registryKey = Symbol.for("cmm.database");
  const openedDatabase = (globalThis as unknown as Record<symbol, CmmDatabase | undefined>)[registryKey];
  if (!openedDatabase) return;
  openedDatabase.connection.close();
  clearGlobalSingleton("database");
}
