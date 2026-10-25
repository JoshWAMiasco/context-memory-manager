import "server-only";
import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { VersioningStatus } from "@/lib/api-types";
import { ApiRouteError } from "@/server/http/api-error";
import { readManifest } from "@/server/meta/effective";
import { resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import type { BackgroundService } from "@/server/services";
import { readOperationRoot, registerGuard, type FileOperation } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";
import { joinStoragePath } from "@/server/storage/storage-path";
import { flushAllAutocommits, flushAutocommits, registerAutocommitHook } from "@/server/versioning/autocommit";
import { closeVersioningWatches, followVersionedScopes } from "@/server/versioning/external-snapshots";
import { detectGit } from "@/server/versioning/git-detect";
import { countCommits, resolveHistoryTarget } from "@/server/versioning/history";
import { assertCanVersion, registerExclusivityGuard } from "@/server/versioning/exclusivity";
import { assertHistoryChangeAllowed, listArchives, type VersioningRequest } from "@/server/versioning/lifecycle";
import { commitAll, userAuthor, withRepo } from "@/server/versioning/repo";
import { emitVersioningChange, readVersioning, versionedScopeOf, writeVersioning } from "@/server/versioning/scope";
import { peekUndoRedo, readChangedPaths } from "@/server/versioning/undo-redo";

export const VERSIONING_GUARD_NAME = "versioning";

/** Counting `.git`'s size stops here (a very large history only needs a rough number). */
const SIZE_ENTRY_LIMIT = 200_000;

async function measureFolder(absolutePath: string): Promise<number> {
  let total = 0;
  let entryCount = 0;
  const pending = [absolutePath];
  for (let folder = pending.pop(); folder !== undefined && entryCount < SIZE_ENTRY_LIMIT; folder = pending.pop()) {
    for (const child of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      entryCount += 1;
      const childPath = joinStoragePath(folder, child.name);
      if (child.isDirectory()) pending.push(childPath);
      else if (child.isFile()) total += (await lstat(childPath).catch(() => undefined))?.size ?? 0;
    }
  }
  return total;
}

async function readBlockedReason(
  storage: ActiveStorage,
  resolvedPath: ResolvedPath,
  { forEnabling = false }: { forEnabling?: boolean } = {},
): Promise<string | undefined> {
  try {
    if (forEnabling) await assertCanVersion(resolvedPath, storage.label);
    await assertHistoryChangeAllowed(storage, resolvedPath);
    return undefined;
  } catch (blockError) {
    if (blockError instanceof ApiRouteError) return blockError.message;
    throw blockError;
  }
}

/**
 * The Versioning tab's state for a folder or file: the versioned folder it is in, with
 * its enable date, commit count, `.git` size and what Undo and Redo would do; or, when it isn't
 * versioned, whether it has a `.git` to adopt, its archived histories and why it can't be enabled.
 *
 * @example
 * const status = await readVersioningStatus(storage, "persona");
 */
export async function readVersioningStatus(storage: ActiveStorage, entryPath: string): Promise<VersioningStatus> {
  const resolvedPath = await resolveInStorage(storage, entryPath);
  const isDirectory = (await stat(resolvedPath.absolutePath)).isDirectory();
  const scope = await versionedScopeOf(resolvedPath.rootPath, resolvedPath.relativePath, { isDirectory });
  const folderPath =
    scope?.path ??
    (isDirectory ? resolvedPath.relativePath : path.posix.dirname(resolvedPath.relativePath).replace(/^\.$/, ""));
  const folderResolved = await resolveInStorage(storage, folderPath);
  const manifest = await readManifest(folderResolved.absolutePath);
  const folderName = manifest?.name ?? (folderPath === "" ? storage.label : path.posix.basename(folderPath));
  const archives = await listArchives(folderResolved.absolutePath);
  const hasGitFolder = await lstat(joinStoragePath(folderResolved.absolutePath, ".git")).then(
    () => true,
    () => false,
  );
  if (!scope) {
    const status: VersioningStatus = { versioned: false, scopePath: folderPath, folderName, hasGitFolder, archives };
    const blockedReason = await readBlockedReason(storage, folderResolved, { forEnabling: true });
    if (blockedReason) status.blockedReason = blockedReason;
    return status;
  }
  const gitAvailable = (await detectGit()).installed;
  const blockedReason = gitAvailable
    ? await readBlockedReason(storage, folderResolved)
    : "Git isn't installed on this computer.";
  return {
    versioned: true,
    scopePath: scope.path,
    folderName,
    enabledAt: scope.versioning.enabledAt,
    enabledBy: scope.versioning.enabledBy,
    adopted: scope.versioning.adopted,
    commitCount: gitAvailable ? await countCommits(scope) : undefined,
    gitSizeBytes: await measureFolder(joinStoragePath(scope.absolutePath, ".git")),
    hasGitFolder,
    archives,
    peek: gitAvailable ? await peekUndoRedo(scope, blockedReason) : { canUndo: false, canRedo: false, blockedReason },
  };
}

/**
 * "Create snapshot…": commits the folder now with the user's own message, also when
 * nothing changed (a named point in history). A snapshot that changed files can be undone.
 *
 * @example
 * await createSnapshot({ storage, path: "persona", actor }, "Before the big rewrite");
 */
export async function createSnapshot({ storage, path: entryPath, actor }: VersioningRequest, message: string) {
  const target = await resolveHistoryTarget(storage, entryPath);
  const { scope } = target;
  await flushAutocommits(storage.id, scope.path);
  return withRepo(scope.absolutePath, async (git) => {
    const sha = await commitAll(git, message.trim(), userAuthor(actor.username), { allowEmpty: true });
    const versioning = await readVersioning(scope.absolutePath);
    if (sha && versioning && (await readChangedPaths(git, sha)).length > 0) {
      await writeVersioning(scope.absolutePath, {
        ...versioning,
        undoStack: [...versioning.undoStack, sha],
        redoStack: [],
      });
    }
    emitVersioningChange(storage.id, scope.path, "commit");
    return { sha };
  });
}

/** Whether a path goes through the `.git` folder of a versioned folder. */
async function touchesManagedGit(operation: FileOperation): Promise<boolean> {
  for (const target of [operation, operation.destination]) {
    if (!target) continue;
    const segments = target.path.split("/");
    const gitIndex = segments.findIndex((segment) => segment.toLowerCase() === ".git");
    if (gitIndex === -1) continue;
    const ownerPath = segments.slice(0, gitIndex).join("/");
    const scope = await versionedScopeOf(readOperationRoot(target), ownerPath, { isDirectory: true });
    if (scope?.path === ownerPath) return true;
  }
  return false;
}

/**
 * Keeps hands off a versioned folder's `.git`: CCM manages it, so changing, moving or deleting
 * anything in it through CCM is refused (reading is allowed).
 */
export async function versioningGuard(operation: FileOperation): Promise<void> {
  if (["read", "list", "stat"].includes(operation.type)) return;
  if (!(await touchesManagedGit(operation))) return;
  throw new ApiRouteError(
    403,
    "FORBIDDEN",
    "CCM keeps this folder's history in .git. Change it from Folder settings → Versioning instead.",
  );
}

/**
 * The versioning service: registers the `.git` guard, the guard that keeps versioned and
 * encrypted folders apart, and the auto-commit after-hook, and
 * watches versioned folders for changes made outside CCM. Pending commits are made on shutdown.
 *
 * @example
 * const BACKGROUND_SERVICES = [createVersioningService(), …];
 */
export function createVersioningService(): BackgroundService {
  let stopFollowing: (() => void) | undefined;
  return {
    name: "versioning",
    start: () => {
      registerGuard(VERSIONING_GUARD_NAME, versioningGuard);
      registerExclusivityGuard();
      registerAutocommitHook();
      stopFollowing = followVersionedScopes();
    },
    stop: async () => {
      stopFollowing?.();
      await flushAllAutocommits();
      await closeVersioningWatches();
    },
  };
}
