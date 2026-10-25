import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileBadges } from "@/lib/api-types";
import { stricterProtection, type ProtectionMode } from "@/lib/protection";
import { ApiRouteError } from "@/server/http/api-error";
import { META_FILES, type CryptoFile, type Manifest, type ProtectionFile } from "@/server/meta/schemas";
import { InvalidMetaError, isScope, listAncestors, metaFilePath, readMeta } from "@/server/meta/store";
import { joinStoragePath } from "@/server/storage/storage-path";

export interface EffectiveProtection {
  mode: ProtectionMode;
  /** Where the deciding mode is set: the storage-relative path, and whether it is a single-file entry. */
  source?: { path: string; isFile: boolean };
}

/** The encrypted folder an entry is in: the nearest folder, itself included, with `.cmm/crypto.json`. */
export interface EncryptionScope {
  /** Storage-relative path of the encrypted folder. */
  path: string;
  absolutePath: string;
  crypto: CryptoFile;
}

export interface EffectiveState {
  /** The folder's manifest when it is a memory. */
  memory?: Manifest;
  protection: EffectiveProtection;
  encryption?: EncryptionScope;
}

/** A damaged or unreadable `protection.json` fails closed: the folder counts as locked. */
const FAIL_CLOSED: ProtectionFile = { v: 1, mode: "locked", files: {} };

/** A folder's `protection.json`, or undefined; a damaged one reads as locked. */
export async function readProtection(folderAbsolutePath: string): Promise<ProtectionFile | undefined> {
  try {
    return await readMeta(folderAbsolutePath, META_FILES.protection);
  } catch (readError) {
    if (readError instanceof InvalidMetaError) return FAIL_CLOSED;
    throw readError;
  }
}

/** A folder's manifest, or undefined when it has none or it can't be read. */
export async function readManifest(folderAbsolutePath: string): Promise<Manifest | undefined> {
  try {
    return await readMeta(folderAbsolutePath, META_FILES.manifest);
  } catch {
    return undefined;
  }
}

function toRelative(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

/**
 * A folder's `crypto.json`, or undefined. A damaged one stops every read and write inside with
 * 409 `ENCRYPTED_LOCKED`: CMM can't tell which key the folder uses.
 */
export async function readCrypto(folderAbsolutePath: string): Promise<CryptoFile | undefined> {
  try {
    return await readMeta(folderAbsolutePath, META_FILES.crypto);
  } catch (readError) {
    if (!(readError instanceof InvalidMetaError)) throw readError;
    throw new ApiRouteError(
      409,
      "ENCRYPTED_LOCKED",
      `"${path.basename(folderAbsolutePath)}" can't be opened: its encryption settings (.cmm/crypto.json) are damaged.`,
    );
  }
}

/**
 * The encrypted folder that `folderAbsolutePath` is (or is inside), nearest first.
 *
 * @example
 * const scope = await findEncryptionScope(storage.rootPath, "/data/notes/persona/drafts");
 */
export async function findEncryptionScope(
  rootPath: string,
  folderAbsolutePath: string,
): Promise<EncryptionScope | undefined> {
  for (const candidatePath of listAncestors(rootPath, folderAbsolutePath)) {
    if (!(await isScope(candidatePath))) continue;
    const crypto = await readCrypto(candidatePath);
    if (crypto) return { path: toRelative(rootPath, candidatePath), absolutePath: candidatePath, crypto };
  }
  return undefined;
}

/** The strictest folder-level mode among `folderAbsolutePaths` (nearest first); ties keep the nearest. */
async function readInheritedProtection(rootPath: string, folderAbsolutePaths: string[]): Promise<EffectiveProtection> {
  const effective: EffectiveProtection = { mode: "none" };
  for (const folderPath of folderAbsolutePaths) {
    if (!(await isScope(folderPath))) continue;
    const folderMode = (await readProtection(folderPath))?.mode ?? "none";
    if (stricterProtection(effective.mode, folderMode) !== effective.mode) {
      effective.mode = folderMode;
      effective.source = { path: toRelative(rootPath, folderPath), isFile: false };
    }
  }
  return effective;
}

/**
 * The protection and memory state of an entry. Protection is the strictest mode among the
 * entry and its parent folders (`locked` > `view-only` > `none`); a single file can also be
 * protected through its folder's `protection.json` `files` entry. Paths that don't exist yet (a
 * file about to be created) get their parents' protection.
 *
 * @example
 * const { protection } = await effectiveState(storage.rootPath, "notes/today.md");
 */
export async function effectiveState(
  rootPath: string,
  relativePath: string,
  { isDirectory }: { isDirectory?: boolean } = {},
): Promise<EffectiveState> {
  const absolutePath = relativePath === "" ? rootPath : joinStoragePath(rootPath, ...relativePath.split("/"));
  const entryIsDirectory =
    isDirectory ??
    (await stat(absolutePath).then(
      (entryStats) => entryStats.isDirectory(),
      () => false,
    ));
  const parentPath = path.dirname(absolutePath);
  const folders = entryIsDirectory ? listAncestors(rootPath, absolutePath) : listAncestors(rootPath, parentPath);
  const protection = await readInheritedProtection(rootPath, folders);
  const encryption = await findEncryptionScope(rootPath, folders[0] ?? rootPath);
  if (!entryIsDirectory && relativePath !== "") {
    const fileMode = (await readProtection(parentPath))?.files[path.basename(absolutePath)];
    if (fileMode && stricterProtection(protection.mode, fileMode) !== protection.mode) {
      protection.mode = fileMode;
      protection.source = { path: relativePath, isFile: true };
    }
  }
  if (!entryIsDirectory) return { protection, encryption };
  const manifest = await readManifest(absolutePath);
  return { protection, encryption, memory: manifest?.kind === "memory" ? manifest : undefined };
}

function toEncryptionBadge(scope: EncryptionScope): NonNullable<FileBadges["encryption"]> {
  return { scopePath: scope.path, folderId: scope.crypto.folderId, state: scope.crypto.state, unlocked: false };
}

export async function readVersioningEnabled(folderAbsolutePath: string): Promise<boolean> {
  try {
    const versioning = JSON.parse(await readFile(metaFilePath(folderAbsolutePath, "versioning.json"), "utf8")) as {
      enabled?: unknown;
    };
    return versioning.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Badges for the entries of one folder listing: the folder's own inherited protection is
 * read once, then each child adds its own `.cmm/` (folders) or its `files` entry (files).
 * `protection` is the effective mode; `protectionSource` says whether it is set on the entry itself.
 * `includeFolder: false` reads only the children's own `.cmm/` (the storage root, the trash).
 *
 * @example
 * const badges = await readListingBadges(storage.rootPath, "notes", [{ name: "a.md", isDirectory: false }]);
 */
export async function readListingBadges(
  rootPath: string,
  folderRelativePath: string,
  children: readonly { name: string; isDirectory: boolean }[],
  { includeFolder = true }: { includeFolder?: boolean } = {},
): Promise<FileBadges[]> {
  const folderAbsolutePath =
    folderRelativePath === "" ? rootPath : joinStoragePath(rootPath, ...folderRelativePath.split("/"));
  const inherited: EffectiveProtection = includeFolder
    ? await readInheritedProtection(rootPath, listAncestors(rootPath, folderAbsolutePath))
    : { mode: "none" };
  const folderProtection =
    includeFolder && (await isScope(folderAbsolutePath)) ? await readProtection(folderAbsolutePath) : undefined;
  const inheritedEncryption = includeFolder ? await findEncryptionScope(rootPath, folderAbsolutePath) : undefined;
  return Promise.all(
    children.map(async (child): Promise<FileBadges> => {
      const childPath = joinStoragePath(folderAbsolutePath, child.name);
      let ownMode: ProtectionMode = "none";
      let manifest: Manifest | undefined;
      let encryption = inheritedEncryption;
      let isVersioned = false;
      if (child.isDirectory) {
        if (await isScope(childPath)) {
          ownMode = (await readProtection(childPath))?.mode ?? "none";
          manifest = await readManifest(childPath);
          const ownCrypto = await readCrypto(childPath).catch(() => undefined);
          if (ownCrypto && !encryption) {
            encryption = { path: toRelative(rootPath, childPath), absolutePath: childPath, crypto: ownCrypto };
          }
          isVersioned = await readVersioningEnabled(childPath);
        }
      } else {
        ownMode = folderProtection?.files[child.name] ?? "none";
      }
      const mode = stricterProtection(inherited.mode, ownMode);
      const badges: FileBadges = {
        isMemory: manifest?.kind === "memory",
        protection: mode,
        encrypted: encryption !== undefined,
        versioned: isVersioned,
      };
      if (encryption) badges.encryption = toEncryptionBadge(encryption);
      if (mode !== "none") badges.protectionSource = ownMode === mode ? "self" : "inherited";
      if (manifest?.kind === "memory") {
        badges.memory = { name: manifest.name, icon: manifest.icon, color: manifest.color };
      }
      return badges;
    }),
  );
}
