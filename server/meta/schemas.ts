import "server-only";
import { z } from "zod";
import { MEMORY_COLORS, MEMORY_ICONS } from "@/lib/memory";

/*
 * The `.ccm/` metadata files . Every file has a version `v`; readers parse
 * older versions through `MIGRATIONS` and refuse newer ones.
 */

export const META_FILES = {
  manifest: "manifest.json",
  protection: "protection.json",
  protectionModes: "protection-modes.json",
  crypto: "crypto.json",
  versioning: "versioning.json",
} as const;

export type MetaFileName = (typeof META_FILES)[keyof typeof META_FILES];

const storedProtectionModeSchema = z.enum(["view-only", "locked"]);

export const manifestSchema = z.object({
  v: z.literal(1),
  kind: z.enum(["folder", "memory"]),
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  icon: z.enum(MEMORY_ICONS).optional(),
  color: z.enum(MEMORY_COLORS).optional(),
  template: z.string().max(64).optional(),
  createdAt: z.iso.datetime(),
});

export type Manifest = z.output<typeof manifestSchema>;

export const protectionSchema = z.object({
  v: z.literal(1),
  /** The folder's own mode; `none` (or absent) when only files inside are protected. */
  mode: z.enum(["none", "view-only", "locked"]).default("none"),
  setBy: z.string().optional(),
  setAt: z.iso.datetime().optional(),
  /** Single files in this folder, by name. */
  files: z.record(z.string(), storedProtectionModeSchema).default({}),
  /** macOS "Strong lock": `chflags uchg` was set and must be cleared before restoring. */
  immutable: z.boolean().optional(),
  /** The last change another program made inside, until someone dismisses it. */
  violation: z.object({ at: z.iso.datetime(), path: z.string() }).optional(),
});

export type ProtectionFile = z.output<typeof protectionSchema>;

export const protectionModesSchema = z.object({
  v: z.literal(1),
  platform: z.string(),
  /** Original permission bits of the folder and everything in it, by path relative to the folder ("" is the folder). */
  entries: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Further `protection-modes.<n>.json` files holding the rest of `entries` for very large trees. */
  chunkCount: z.number().int().nonnegative().default(0),
  /** Original permission bits of single protected files, by name. */
  files: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

export type ProtectionModesFile = z.output<typeof protectionModesSchema>;

export const protectionModesChunkSchema = z.object({
  v: z.literal(1),
  entries: z.record(z.string(), z.number().int().nonnegative()),
});

export const ENCRYPTION_STATES = ["encrypting", "encrypted", "decrypting", "rekeying"] as const;

const base64KeyIdSchema = z.string().regex(/^[A-Za-z0-9+/]{22}==$/);

/** An encrypted folder. It holds no key material: `keyCheck` only proves an uploaded key matches. */
export const cryptoSchema = z.object({
  v: z.literal(1),
  folderId: z.uuid(),
  algorithm: z.literal("AES-256-GCM-STREAM-v1"),
  keyId: base64KeyIdSchema,
  /** base64 HMAC-SHA256(DEK, "ccm/keycheck/v1" || keyId). */
  keyCheck: z.string().min(1).max(64),
  state: z.enum(ENCRYPTION_STATES),
  createdAt: z.iso.datetime(),
  createdBy: z.string().optional(),
  /** While re-keying: the new key. Files carry either key until the job finishes. */
  nextKey: z.object({ keyId: base64KeyIdSchema, keyCheck: z.string().min(1).max(64) }).optional(),
});

export type CryptoFile = z.output<typeof cryptoSchema>;

const shaSchema = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/);

/**
 * A versioned folder. Undo and redo never rewrite history: `undoStack` holds commits that can
 * be reverted (newest last), `redoStack` the undone ones with the revert that undid them.
 */
export const versioningSchema = z.object({
  v: z.literal(1),
  enabled: z.boolean(),
  enabledAt: z.iso.datetime().optional(),
  enabledBy: z.string().optional(),
  /** The folder already had a `.git` with history, kept as it was. */
  adopted: z.boolean().default(false),
  /** CCM created `.gitignore`, so disabling may delete it again once its managed block is gone. */
  createdGitignore: z.boolean().default(false),
  undoStack: z.array(shaSchema).default([]),
  redoStack: z.array(z.object({ original: shaSchema, revert: shaSchema })).default([]),
});

export type VersioningFile = z.output<typeof versioningSchema>;

const SCHEMAS = {
  [META_FILES.manifest]: manifestSchema,
  [META_FILES.protection]: protectionSchema,
  [META_FILES.protectionModes]: protectionModesSchema,
  [META_FILES.crypto]: cryptoSchema,
  [META_FILES.versioning]: versioningSchema,
} as const;

export type MetaData<FileName extends MetaFileName> = z.output<(typeof SCHEMAS)[FileName]>;

/** Upgrades older documents to the current version, per file. Version 1 is current for all. */
const MIGRATIONS: Record<
  MetaFileName,
  Record<number, (document: Record<string, unknown>) => Record<string, unknown>>
> = {
  [META_FILES.manifest]: {},
  [META_FILES.protection]: {},
  [META_FILES.protectionModes]: {},
  [META_FILES.crypto]: {},
  [META_FILES.versioning]: {},
};

const CURRENT_VERSION = 1;

/**
 * Validates a parsed `.ccm/` document, upgrading older versions first. Throws when it is invalid
 * or newer than this CCM understands.
 *
 * @example
 * const manifest = parseMetaDocument("manifest.json", JSON.parse(text));
 */
export function parseMetaDocument<FileName extends MetaFileName>(
  fileName: FileName,
  document: unknown,
): MetaData<FileName> {
  let current = (typeof document === "object" && document !== null ? document : {}) as Record<string, unknown>;
  let version = typeof current.v === "number" ? current.v : CURRENT_VERSION;
  if (version > CURRENT_VERSION) throw new Error(`${fileName} is version ${version}, newer than this CCM supports.`);
  while (version < CURRENT_VERSION) {
    const migrate = MIGRATIONS[fileName][version];
    if (!migrate) throw new Error(`${fileName} version ${version} can't be upgraded.`);
    current = migrate(current);
    version += 1;
  }
  return SCHEMAS[fileName].parse({ ...current, v: CURRENT_VERSION }) as MetaData<FileName>;
}

/** Validates a chunk of original permission bits. */
export function parseModesChunk(document: unknown) {
  return protectionModesChunkSchema.parse(document);
}
