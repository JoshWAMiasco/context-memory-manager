/*
 * CMM was called CCM before its public release. These are the names that version used, which CMM
 * still recognises so that storages, key files, desktop data and server installs made then keep
 * working: storages are migrated to the new names once (`server/storage/legacy-migration.ts`), and
 * an old name that is still there is hidden and protected like the new one. New data always gets
 * the CMM names. The encrypted file format keeps its original identifiers (`CCM1`,
 * `ccm/keycheck/v1`, `ccm/file/v1`, `"type": "ccm-key"`), so it needs nothing here.
 * Isomorphic: no server-only imports here.
 */

/** A folder's settings folder (now `.cmm`). */
export const LEGACY_META_DIRECTORY = ".ccm";
/** A storage's trash (now `.cmm-trash`). */
export const LEGACY_TRASH_DIRECTORY = ".ccm-trash";
/** A storage's staging folder (now `.cmm-tmp`). */
export const LEGACY_TEMPORARY_DIRECTORY = ".ccm-tmp";

export const LEGACY_RESERVED_NAMES = [
  LEGACY_META_DIRECTORY,
  LEGACY_TRASH_DIRECTORY,
  LEGACY_TEMPORARY_DIRECTORY,
] as const;

/** Key files (now `.cmmkey`). */
export const LEGACY_KEY_FILE_EXTENSION = ".ccmkey";
/** A file a backup is still copying (now `.cmm-part`). */
export const LEGACY_PART_SUFFIX = ".ccm-part";
/** Environment variables (now `CMM_…`). */
export const LEGACY_ENVIRONMENT_PREFIX = "CCM_";
/** The database in the data folder (now `cmm.db`). */
export const LEGACY_DATABASE_FILE = "ccm.db";
/** The first line of the managed `.gitignore` block in a versioned folder (now "CMM managed"). */
export const LEGACY_MANAGED_BLOCK_START = "# >>> CCM managed";
export const LEGACY_MANAGED_BLOCK_END = "# <<< CCM managed";

/**
 * Whether `segment` is one of the old hidden names (`.ccm`, `.ccm-trash`, `.ccm-tmp`, or any other
 * name starting with `.ccm`), which CMM hides and protects like its own.
 *
 * @example
 * isLegacyHiddenName(".ccm"); // true
 * isLegacyHiddenName("notes.md"); // false
 */
export function isLegacyHiddenName(segment: string): boolean {
  return segment.toLowerCase().startsWith(".ccm");
}

/**
 * Copies every `CCM_…` environment variable to its `CMM_…` name when that isn't set, so a service
 * file, launcher or shell profile written for CCM keeps working. Call it first thing in each entry.
 *
 * @example
 * adoptLegacyEnvironment(process.env);
 */
export function adoptLegacyEnvironment(environment: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith(LEGACY_ENVIRONMENT_PREFIX) || value === undefined) continue;
    const currentName = `CMM_${name.slice(LEGACY_ENVIRONMENT_PREFIX.length)}`;
    if (environment[currentName] === undefined) environment[currentName] = value;
  }
}
