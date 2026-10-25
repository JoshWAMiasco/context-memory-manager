import "server-only";
import { chmod, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  LEGACY_MANAGED_BLOCK_START,
  LEGACY_META_DIRECTORY,
  LEGACY_TEMPORARY_DIRECTORY,
  LEGACY_TRASH_DIRECTORY,
} from "@/lib/fs/legacy-names";
import { isSystemMetadataName } from "@/lib/fs/system-files";
import { getDatabase } from "@/server/db/client";
import { settings } from "@/server/db/schema";
import { META_DIRECTORY } from "@/server/meta/store";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { TEMPORARY_DIRECTORY } from "@/server/storage/fs-ops";
import { joinStoragePath } from "@/server/storage/storage-path";
import { TRASH_DIRECTORY } from "@/server/trash";
import { GITIGNORE_FILE, mergeManagedBlock } from "@/server/versioning/repo";

/** The settings row (not an admin setting) that lists the storage roots already migrated. */
const MIGRATED_ROOTS_KEY = "internal.legacyNamesMigratedRoots";

/** Folders the walk never enters: version control, packages, and the OS's own. */
const SKIPPED_FOLDER_NAMES = new Set([".git", "node_modules"]);

export interface LegacyMigrationResult {
  /** Folders renamed from a CCM name to the CMM one. */
  renamed: number;
  /** Managed `.gitignore` blocks rewritten for the new names. */
  gitignoresUpdated: number;
  /** Paths that could not be migrated (left as they are, hidden like CMM's own). */
  failed: string[];
}

function readMigratedRoots(): Set<string> {
  const storedRow = getDatabase().orm.select().from(settings).where(eq(settings.key, MIGRATED_ROOTS_KEY)).get();
  if (!storedRow) return new Set();
  try {
    const roots: unknown = JSON.parse(storedRow.valueJson);
    return new Set(Array.isArray(roots) ? roots.filter((root): root is string => typeof root === "string") : []);
  } catch {
    return new Set();
  }
}

function recordMigratedRoot(rootPath: string): void {
  const valueJson = JSON.stringify([...readMigratedRoots(), rootPath]);
  getDatabase()
    .orm.insert(settings)
    .values({ key: MIGRATED_ROOTS_KEY, valueJson })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
    .run();
}

async function pathExists(absolutePath: string): Promise<boolean> {
  return stat(absolutePath).then(
    () => true,
    () => false,
  );
}

/**
 * Renames `fromName` to `toName` inside `folderPath`, unless `toName` already exists. A folder
 * that CMM made read-only (protection) gets its owner write bit for the rename and its mode back
 * afterwards. Returns whether it renamed.
 */
async function renameInFolder(folderPath: string, fromName: string, toName: string): Promise<boolean> {
  const fromPath = joinStoragePath(folderPath, fromName);
  const toPath = joinStoragePath(folderPath, toName);
  if (await pathExists(toPath)) return false;
  try {
    await rename(fromPath, toPath);
    return true;
  } catch (renameError) {
    const code = (renameError as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw renameError;
  }
  const folderMode = (await stat(folderPath)).mode & 0o7777;
  await chmod(folderPath, folderMode | 0o200);
  try {
    await rename(fromPath, toPath);
  } finally {
    await chmod(folderPath, folderMode).catch(() => undefined);
  }
  return true;
}

async function updateManagedGitignore(folderPath: string): Promise<boolean> {
  const gitignorePath = joinStoragePath(folderPath, GITIGNORE_FILE);
  const existing = await readFile(gitignorePath, "utf8").catch(() => undefined);
  if (existing === undefined || !existing.split(/\r?\n/).includes(LEGACY_MANAGED_BLOCK_START)) return false;
  await writeFile(gitignorePath, mergeManagedBlock(existing));
  return true;
}

/**
 * Moves one storage from CCM's names to CMM's: the storage's `.ccm-trash` and `.ccm-tmp`,
 * every folder's `.ccm` settings folder, and the managed block of each versioned folder's
 * `.gitignore`. Symlinks are not followed, and `.git`, `node_modules` and OS metadata folders are
 * not entered. A name that can't be moved is left as it is (CMM hides and protects it) and
 * reported in `failed`.
 *
 * @example
 * const { renamed, failed } = await migrateLegacyNames("/Volumes/USB STICK");
 */
export async function migrateLegacyNames(rootPath: string): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { renamed: 0, gitignoresUpdated: 0, failed: [] };
  const tryStep = async (description: string, step: () => Promise<boolean>) => {
    try {
      return await step();
    } catch (stepError) {
      result.failed.push(`${description}: ${(stepError as Error).message}`);
      return false;
    }
  };
  for (const [legacyName, currentName] of [
    [LEGACY_TRASH_DIRECTORY, TRASH_DIRECTORY],
    [LEGACY_TEMPORARY_DIRECTORY, TEMPORARY_DIRECTORY],
  ] as const) {
    if (!(await pathExists(joinStoragePath(rootPath, legacyName)))) continue;
    if (await tryStep(path.join(rootPath, legacyName), () => renameInFolder(rootPath, legacyName, currentName))) {
      result.renamed += 1;
    }
  }
  const pendingFolders = [rootPath];
  while (pendingFolders.length > 0) {
    const folderPath = pendingFolders.shift() ?? rootPath;
    const children = await readdir(folderPath, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (child.name === LEGACY_META_DIRECTORY) {
        const isRenamed = await tryStep(path.join(folderPath, child.name), () =>
          renameInFolder(folderPath, LEGACY_META_DIRECTORY, META_DIRECTORY),
        );
        if (isRenamed) result.renamed += 1;
        continue;
      }
      const lowerName = child.name.toLowerCase();
      if (lowerName.startsWith(".cmm") || lowerName.startsWith(".ccm")) continue;
      if (SKIPPED_FOLDER_NAMES.has(lowerName) || isSystemMetadataName(child.name)) continue;
      pendingFolders.push(joinStoragePath(folderPath, child.name));
    }
    if (await tryStep(path.join(folderPath, GITIGNORE_FILE), () => updateManagedGitignore(folderPath))) {
      result.gitignoresUpdated += 1;
    }
  }
  return result;
}

/**
 * Migrates a storage root once (`migrateLegacyNames`): the first call walks it, later calls in
 * this process share that walk, and a root that migrated without failures is remembered in the
 * database so it is never walked again. Never throws; problems are logged.
 *
 * @example
 * await ensureLegacyNamesMigrated(storage.rootPath);
 */
export function ensureLegacyNamesMigrated(rootPath: string): Promise<void> {
  const pending = getGlobalSingleton("legacy-migrations", () => new Map<string, Promise<void>>());
  const existing = pending.get(rootPath);
  if (existing) return existing;
  const migration = (async () => {
    try {
      if (rootPath === "" || readMigratedRoots().has(rootPath)) return;
      const { renamed, gitignoresUpdated, failed } = await migrateLegacyNames(rootPath);
      if (renamed > 0 || gitignoresUpdated > 0) {
        console.log(
          `[cmm] ${rootPath}: moved ${renamed} folder${renamed === 1 ? "" : "s"} from CCM names to CMM names` +
            (gitignoresUpdated > 0 ? `, updated ${gitignoresUpdated} .gitignore file(s)` : ""),
        );
      }
      for (const problem of failed) console.error(`[cmm] could not migrate ${problem}`);
      if (failed.length === 0) recordMigratedRoot(rootPath);
    } catch (migrationError) {
      console.error(`[cmm] migrating ${rootPath} from CCM names failed`, migrationError);
    }
  })();
  pending.set(rootPath, migration);
  return migration;
}
