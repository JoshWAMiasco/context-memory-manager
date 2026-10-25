/*
 * Applies the SQL migrations to <dataDir>/cmm.db using the normal config (CMM_DATA_DIR, CMM_MODE…).
 * The entry does this on every start; this script is for doing it by hand. Run with the
 * react-server condition so `server-only` resolves to its empty export: `npm run db:migrate`.
 */
import path from "node:path";
import { getConfig } from "@/server/config";
import { closeDatabase, DATABASE_FILE_NAME, getDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

const config = getConfig();
runMigrations(getDatabase().orm, path.resolve(__dirname, "..", "server", "db", "migrations"));
closeDatabase();
console.log(`[db:migrate] ${path.join(config.dataDir, DATABASE_FILE_NAME)} is up to date.`);
