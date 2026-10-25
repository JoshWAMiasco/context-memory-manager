import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getConfig } from "@/server/config";
import * as schema from "@/server/db/schema";
import { clearGlobalSingleton, getGlobalSingleton } from "@/server/runtime/global-singleton";

export const DATABASE_FILE_NAME = "ccm.db";

export type CcmOrm = BetterSQLite3Database<typeof schema>;

export interface CcmDatabase {
  connection: Database.Database;
  orm: CcmOrm;
}

/** Opens (creating if needed) the SQLite file with WAL journaling and foreign keys on. */
export function openDatabase(databaseFilePath: string): CcmDatabase {
  mkdirSync(path.dirname(databaseFilePath), { recursive: true, mode: 0o700 });
  const connection = new Database(databaseFilePath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");
  return { connection, orm: drizzle({ client: connection, schema }) };
}

/** The process-wide database in `<dataDir>/ccm.db`. */
export function getDatabase(): CcmDatabase {
  return getGlobalSingleton("database", () => openDatabase(path.join(getConfig().dataDir, DATABASE_FILE_NAME)));
}

/** Closes the process-wide database, if it was opened. */
export function closeDatabase(): void {
  const registryKey = Symbol.for("ccm.database");
  const openedDatabase = (globalThis as unknown as Record<symbol, CcmDatabase | undefined>)[registryKey];
  if (!openedDatabase) return;
  openedDatabase.connection.close();
  clearGlobalSingleton("database");
}
