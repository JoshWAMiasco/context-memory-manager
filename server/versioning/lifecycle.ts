import "server-only";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VersioningArchive } from "@/lib/api-types";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { getJobQueue } from "@/server/jobs/queue";
import { effectiveState } from "@/server/meta/effective";
import { META_FILES } from "@/server/meta/schemas";
import { deleteMeta, ensureMetaDirectory, metaFilePath } from "@/server/meta/store";
import { findProtectedInside, isScopeBusy } from "@/server/protection/scopes";
import { joinRelativePath, resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import type { FileActor } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { flushAutocommits } from "@/server/versioning/autocommit";
import { assertCanVersion } from "@/server/versioning/exclusivity";
import {
  commitAll,
  gitFailed,
  GITIGNORE_FILE,
  mergeManagedBlock,
  removeManagedBlock,
  removeTree,
  userAuthor,
  withRepo,
} from "@/server/versioning/repo";
import {
  emitVersioningChange,
  findVersionedDescendant,
  findVersionedScope,
  forgetVersionedScope,
  isInsideScope,
  readVersioning,
  recordVersionedScope,
  writeVersioning,
  type VersionedScope,
} from "@/server/versioning/scope";

export const ENABLE_MESSAGE = "CCM: enable versioning";
export const DELETE_CONFIRM_TEXT = "DELETE HISTORY";

/** Archived histories live here, ignored by git and hidden like the rest of `.ccm/`. */
const ARCHIVE_DIRECTORY = "git-archive";

export interface VersioningRequest {
  storage: ActiveStorage;
  path: string;
  actor: FileActor;
}

function gitDirectoryOf(folderAbsolutePath: string): string {
  return joinStoragePath(folderAbsolutePath, ".git");
}

async function exists(absolutePath: string): Promise<boolean> {
  return lstat(absolutePath).then(
    () => true,
    () => false,
  );
}

async function requireFolder(storage: ActiveStorage, relativePath: string): Promise<ResolvedPath> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  if (!(await stat(resolvedPath.absolutePath)).isDirectory()) throw validationFailed("Choose a folder.");
  return resolvedPath;
}

function describeFolder(storage: ActiveStorage, relativePath: string): string {
  return relativePath === "" ? storage.label : `"${path.posix.basename(relativePath)}"`;
}

/**
 * Refuses to change a folder's history while it can't be changed safely: the
 * folder (or one around it) is protected, something inside is protected, or a protection or other
 * job works on it. Encrypted folders are never versioned, so enabling, undo, redo and restore are
 * refused there too (409 `VERSIONING_ENCRYPTION_CONFLICT`); `allowsEncrypted` lets versioning be
 * turned off on a folder that somehow ended up both.
 */
export async function assertHistoryChangeAllowed(
  storage: ActiveStorage,
  resolvedPath: ResolvedPath,
  { allowsEncrypted = false }: { allowsEncrypted?: boolean } = {},
): Promise<void> {
  const { protection, encryption } = await effectiveState(resolvedPath.rootPath, resolvedPath.relativePath, {
    isDirectory: true,
  });
  const folder = describeFolder(storage, resolvedPath.relativePath);
  if (protection.mode !== "none") {
    const isLocked = protection.mode === "locked";
    throw new ApiRouteError(
      403,
      isLocked ? "PROTECTED_LOCKED" : "PROTECTED_VIEW_ONLY",
      `${folder} is ${isLocked ? "locked" : "view-only"}, so its history can't change. Remove its protection first.`,
      { mode: protection.mode, source: protection.source?.path ?? "" },
    );
  }
  const protectedInside = findProtectedInside(storage.id, resolvedPath.relativePath)[0];
  if (protectedInside) {
    throw new ApiRouteError(
      403,
      "CONTAINS_PROTECTED",
      `"${protectedInside.path}" inside is protected, so the folder's history can't change. Remove its protection first.`,
      { paths: [protectedInside.path] },
    );
  }
  if (isScopeBusy(storage.id, resolvedPath.relativePath)) {
    throw new ApiRouteError(409, "SCOPE_BUSY", "A protection change is running here. Try again when it finishes.");
  }
  const busyJob = getJobQueue()
    .listActive()
    .find(
      (job) =>
        job.target?.storageId === storage.id &&
        (isInsideScope(job.target.path, resolvedPath.relativePath) ||
          isInsideScope(resolvedPath.relativePath, job.target.path)),
    );
  if (busyJob) {
    throw new ApiRouteError(
      409,
      "SCOPE_BUSY",
      `"${busyJob.title}" is working on this folder. Try again when it finishes.`,
    );
  }
  if (encryption && !allowsEncrypted) await assertCanVersion(resolvedPath, storage.label);
}

/** Refuses enabling inside another versioned folder or git repository, or around a versioned folder. */
async function assertNotNested(storage: ActiveStorage, resolvedPath: ResolvedPath): Promise<void> {
  const enclosing = await findVersionedScope(resolvedPath.rootPath, resolvedPath.absolutePath);
  if (enclosing?.path === resolvedPath.relativePath) {
    throw new ApiRouteError(409, "ALREADY_EXISTS", "Versioning is already on for this folder.");
  }
  if (enclosing) {
    throw new ApiRouteError(
      409,
      "NESTED_SCOPE",
      `This folder is inside the versioned folder "${enclosing.path || storage.label}", whose history already covers it.`,
      { scopePath: enclosing.path },
    );
  }
  const descendantInside = await findVersionedDescendant(resolvedPath.absolutePath);
  if (descendantInside) {
    const descendant = joinRelativePath(resolvedPath.relativePath, descendantInside);
    throw new ApiRouteError(
      409,
      "NESTED_SCOPE",
      `This folder contains the versioned folder "${descendant}". Turn its versioning off first: versioned folders can't be nested.`,
      { scopePath: descendant },
    );
  }
  if (await exists(gitDirectoryOf(resolvedPath.absolutePath))) return;
  const outerRoot = await withRepo(resolvedPath.absolutePath, async (git) => {
    try {
      return (await git.raw(["rev-parse", "--show-toplevel"])).trim();
    } catch (gitError) {
      if (/not a git repository/i.test(String(gitError))) return undefined;
      throw gitFailed("check for a repository around this folder", gitError);
    }
  });
  if (!outerRoot) return;
  const outerAbsolute = path.resolve(outerRoot);
  const insideStorage = path.relative(resolvedPath.rootPath, outerAbsolute);
  const outerPath =
    insideStorage.startsWith("..") || path.isAbsolute(insideStorage)
      ? outerAbsolute
      : insideStorage.split(path.sep).join("/") || storage.label;
  throw new ApiRouteError(
    409,
    "NESTED_SCOPE",
    `This folder is inside the Git repository "${outerPath}". Version that repository with Git directly, or choose a folder outside it.`,
    { outerPath },
  );
}

/** The archived histories of a folder, newest first. */
export async function listArchives(folderAbsolutePath: string): Promise<VersioningArchive[]> {
  const archiveDirectory = metaFilePath(folderAbsolutePath, ARCHIVE_DIRECTORY);
  const names = await readdir(archiveDirectory).catch(() => []);
  return names
    .filter((name) => name.endsWith(".git"))
    .map((name) => {
      const stamp = name.slice(0, -".git".length);
      const isoStamp = stamp.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z");
      const archivedAt = Number.isNaN(Date.parse(isoStamp)) ? undefined : new Date(isoStamp).toISOString();
      return { name, archivedAt };
    })
    .toSorted((first, second) => second.name.localeCompare(first.name));
}

async function addManagedBlock(folderAbsolutePath: string): Promise<boolean> {
  const gitignorePath = joinStoragePath(folderAbsolutePath, GITIGNORE_FILE);
  const existing = await readFile(gitignorePath, "utf8").catch(() => undefined);
  await writeFile(gitignorePath, mergeManagedBlock(existing ?? ""), "utf8");
  return existing === undefined;
}

export type EnableResult = { enabled: true; scope: VersionedScope } | { needsAdoptConfirm: true };

/**
 * Turns versioning on: `git init -b main` (or keeps an existing `.git` when `adopt` is
 * confirmed, or brings back an archived history), adds CCM's `.gitignore` block, commits
 * everything as "CCM: enable versioning" and writes `.ccm/versioning.json`. Refused when git is
 * missing, the folder is protected or busy, or it would nest with another repository.
 *
 * @example
 * await enableVersioning({ storage, path: "persona", actor }, { adopt: false });
 */
export async function enableVersioning(
  { storage, path: relativePath, actor }: VersioningRequest,
  {
    adopt = false,
    restoreArchive,
    message = ENABLE_MESSAGE,
  }: { adopt?: boolean; restoreArchive?: string; message?: string } = {},
): Promise<EnableResult> {
  const resolvedPath = await requireFolder(storage, relativePath);
  await assertCanVersion(resolvedPath, storage.label);
  await assertHistoryChangeAllowed(storage, resolvedPath);
  await assertNotNested(storage, resolvedPath);
  const folderAbsolutePath = resolvedPath.absolutePath;
  const gitDirectory = gitDirectoryOf(folderAbsolutePath);
  const hasGitDirectory = await exists(gitDirectory);
  if (restoreArchive !== undefined) {
    const archive = (await listArchives(folderAbsolutePath)).find((candidate) => candidate.name === restoreArchive);
    if (!archive) throw validationFailed("That archived history no longer exists.");
    if (hasGitDirectory) throw validationFailed("This folder already has a .git folder. Remove it first.");
    await rename(metaFilePath(folderAbsolutePath, path.join(ARCHIVE_DIRECTORY, archive.name)), gitDirectory);
  } else if (hasGitDirectory && !adopt) {
    return { needsAdoptConfirm: true };
  }
  const isAdopting = hasGitDirectory || restoreArchive !== undefined;
  const createdGitignore = await addManagedBlock(folderAbsolutePath);
  await withRepo(folderAbsolutePath, async (git) => {
    try {
      if (!isAdopting) await git.raw(["init", "--quiet", "-b", "main"]);
      await commitAll(git, message, userAuthor(actor.username), { allowEmpty: true });
    } catch (gitError) {
      if (!isAdopting) await removeTree(gitDirectory).catch(() => undefined);
      throw gitFailed("turn versioning on", gitError);
    }
  });
  const versioning = await writeVersioning(folderAbsolutePath, {
    v: 1,
    enabled: true,
    enabledAt: new Date().toISOString(),
    enabledBy: actor.username,
    adopted: isAdopting,
    createdGitignore,
    undoStack: [],
    redoStack: [],
  });
  recordVersionedScope(storage.id, resolvedPath.relativePath);
  emitVersioningChange(storage.id, resolvedPath.relativePath, "enabled");
  return {
    enabled: true,
    scope: { path: resolvedPath.relativePath, absolutePath: folderAbsolutePath, versioning },
  };
}

function toArchiveName(date: Date): string {
  return `${date.toISOString().replaceAll(":", "-").replace(".", "-")}.git`;
}

/**
 * Turns versioning off. "archive" moves `.git` to `.ccm/git-archive/<time>.git`, where
 * enabling again offers it back; "delete" removes `.git` for good and needs the typed
 * `DELETE HISTORY`. Either way CCM's `.gitignore` block goes, and the file too when CCM created it
 * and nothing else is left.
 *
 * @example
 * await disableVersioning({ storage, path: "persona", actor }, { mode: "archive" });
 */
export async function disableVersioning(
  { storage, path: relativePath }: VersioningRequest,
  { mode, confirmText }: { mode: "archive" | "delete"; confirmText?: string },
): Promise<{ archive?: string }> {
  const resolvedPath = await requireFolder(storage, relativePath);
  const versioning = await readVersioning(resolvedPath.absolutePath);
  if (!versioning?.enabled) throw validationFailed("Versioning isn't on for this folder.");
  if (mode === "delete" && confirmText !== DELETE_CONFIRM_TEXT) {
    throw validationFailed(`Type ${DELETE_CONFIRM_TEXT} to delete the history.`);
  }
  await assertHistoryChangeAllowed(storage, resolvedPath, { allowsEncrypted: true });
  const folderAbsolutePath = resolvedPath.absolutePath;
  await flushAutocommits(storage.id, resolvedPath.relativePath);
  const result: { archive?: string } = {};
  await withRepo(folderAbsolutePath, async () => {
    const gitDirectory = gitDirectoryOf(folderAbsolutePath);
    if (mode === "archive") {
      await ensureMetaDirectory(folderAbsolutePath);
      await mkdir(metaFilePath(folderAbsolutePath, ARCHIVE_DIRECTORY), { recursive: true });
      result.archive = toArchiveName(new Date());
      await rename(gitDirectory, metaFilePath(folderAbsolutePath, path.join(ARCHIVE_DIRECTORY, result.archive)));
    } else {
      await removeTree(gitDirectory);
    }
    const gitignorePath = joinStoragePath(folderAbsolutePath, GITIGNORE_FILE);
    const existing = await readFile(gitignorePath, "utf8").catch(() => undefined);
    if (existing !== undefined) {
      const remaining = removeManagedBlock(existing);
      if (remaining === "" && versioning.createdGitignore) await rm(gitignorePath, { force: true });
      else if (remaining !== existing) await writeFile(gitignorePath, remaining, "utf8");
    }
  });
  await deleteMeta(folderAbsolutePath, META_FILES.versioning);
  forgetVersionedScope(storage.id, resolvedPath.relativePath);
  emitVersioningChange(storage.id, resolvedPath.relativePath, "disabled");
  return result;
}
