/*
 * Backup modes, options and the profile input schema, shared by the server and the browser.
 * Isomorphic.
 */
import { z } from "zod";
import type { BackupMode } from "@/lib/api-types";

export const BACKUP_MODES = ["copy", "mirror", "snapshot"] as const satisfies readonly BackupMode[];

export const BACKUP_MODE_LABELS: Record<BackupMode, string> = {
  copy: "Copy",
  mirror: "Mirror",
  snapshot: "Snapshot",
};

export const BACKUP_MODE_DESCRIPTIONS: Record<BackupMode, string> = {
  copy: "Copies new and changed files. Nothing on the destination is removed.",
  mirror:
    "Makes the destination match the source: new and changed files are copied, and files that exist only on the destination are moved to its Trash.",
  snapshot: "Copies everything into a new dated folder each run, so older versions stay as they were.",
};

export const MIRROR_WARNING = "Files that exist only on the destination are moved to its Trash.";

/** The name of the run's job and History row when no profile is used. */
export const ADHOC_BACKUP_NAME = "Ad-hoc backup";

const MAX_PATH_LENGTH = 4096;
const MAX_EXCLUDES = 100;

export const backupEndpointSchema = z.object({
  storageId: z.string().min(1, "Choose a storage."),
  path: z.string().max(MAX_PATH_LENGTH).default(""),
});

export const backupOptionsSchema = z.object({
  compare: z.enum(["size-mtime", "checksum"]).default("size-mtime"),
  verify: z.boolean().default(false),
  includeGit: z.boolean().default(true),
  excludes: z
    .array(z.string().trim().min(1).max(200))
    .max(MAX_EXCLUDES, `Use at most ${MAX_EXCLUDES} exclude patterns.`)
    .default([]),
  keepSnapshots: z.number().int().min(1).max(1000).nullable().default(null),
});

/** A profile as the editor saves it (`POST /api/backup/profiles`). */
export const backupProfileInputSchema = backupOptionsSchema.extend({
  name: z.string().trim().min(1, "Give the backup a name.").max(100),
  source: backupEndpointSchema,
  destination: backupEndpointSchema,
  mode: z.enum(BACKUP_MODES),
  autoRunOnConnect: z.boolean().default(false),
  autoResume: z.boolean().default(true),
});

/** A backup run without a profile (`POST /api/backup/run { adhoc }`, `POST /api/backup/preview`). */
export const adhocBackupSchema = backupOptionsSchema.extend({
  source: backupEndpointSchema,
  destination: backupEndpointSchema,
  mode: z.enum(BACKUP_MODES),
  autoResume: z.boolean().default(true),
});

export type AdhocBackup = z.output<typeof adhocBackupSchema>;
