import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { CcmOrm } from "@/server/db/client";

/**
 * Where the generated SQL migrations live: `CCM_MIGRATIONS_DIR` when the entry sets it (packaged
 * builds ship them in `<app>/migrations`), otherwise `server/db/migrations` in the source tree.
 */
export function resolveMigrationsFolder(): string {
  return process.env.CCM_MIGRATIONS_DIR ?? path.join(process.cwd(), "server", "db", "migrations");
}

/** Applies every migration not yet recorded in the database. Safe to run on every start. */
export function runMigrations(orm: CcmOrm, migrationsFolder = resolveMigrationsFolder()): void {
  migrate(orm, { migrationsFolder });
}
