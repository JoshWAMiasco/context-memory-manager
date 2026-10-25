import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { notFound } from "@/server/http/api-error";
import { resolveInStorage } from "@/server/security/path-jail";
import { writeFileContent } from "@/server/storage/fs-ops";
import { commitScopeChanges, flushAutocommits, withoutAutocommit } from "@/server/versioning/autocommit";
import { readFileAt, resolveCommit, resolveHistoryTarget, type HistoryTarget } from "@/server/versioning/history";
import { assertHistoryChangeAllowed, type VersioningRequest } from "@/server/versioning/lifecycle";
import { commitAll, userAuthor, withRepo } from "@/server/versioning/repo";
import { emitVersioningChange, readVersioning, writeVersioning } from "@/server/versioning/scope";
import { announceRewrittenFiles, readChangedPaths, requireCleanTree } from "@/server/versioning/undo-redo";

/** `git rm` takes this many paths per call, well under any command-line limit. */
const REMOVE_BATCH_SIZE = 200;

async function prepareRestore({ storage, path: entryPath }: VersioningRequest): Promise<HistoryTarget> {
  const target = await resolveHistoryTarget(storage, entryPath);
  const scopeResolved = await resolveInStorage(storage, target.scope.path);
  await assertHistoryChangeAllowed(storage, scopeResolved);
  await flushAutocommits(storage.id, target.scope.path);
  return target;
}

/**
 * Restores one file to a version: its content as of `revision` is written through the
 * file pipeline (refused for a protected file) and committed
 * as "Restore <path> to <short>", which can be undone like any change.
 *
 * @example
 * await restoreFile({ storage, path: "persona/notes.md", actor }, "3f2a9c1");
 */
export async function restoreFile(
  request: VersioningRequest,
  revision: string,
): Promise<{ sha?: string; path: string }> {
  const target = await prepareRestore(request);
  if (target.relativePath === "") throw notFound("Choose a file to restore.");
  const { storage, actor } = request;
  const short = await withRepo(target.scope.absolutePath, async (git) =>
    (await resolveCommit(git, revision)).slice(0, 7),
  );
  const content = await readFileAt(target, revision, target.relativePath);
  if (content === undefined) throw notFound("This file doesn't exist in that version.");
  const storagePath = target.scope.path === "" ? target.relativePath : `${target.scope.path}/${target.relativePath}`;
  const resolvedTarget = await resolveInStorage(storage, storagePath, { forCreate: true });
  await withoutAutocommit(storage.id, target.scope.path, async () => {
    await mkdir(path.dirname(resolvedTarget.absolutePath), { recursive: true });
    await writeFileContent(storage, storagePath, content, actor);
  });
  const sha = await commitScopeChanges(
    target.scope,
    storage.id,
    target.scope.path,
    `Restore ${target.relativePath} to ${short}`,
    userAuthor(actor.username),
  );
  return { sha, path: storagePath };
}

/**
 * Restores the whole versioned folder to a version: `git checkout <sha> -- .`, then the
 * files added since are removed (`git rm`), committed as "Restore folder to <short>".
 *
 * @example
 * await restoreFolder({ storage, path: "persona", actor }, "3f2a9c1");
 */
export async function restoreFolder(request: VersioningRequest, revision: string): Promise<{ sha?: string }> {
  const target = await prepareRestore(request);
  const { storage, actor } = request;
  const { scope } = target;
  return withRepo(scope.absolutePath, async (git) => {
    const sha = await resolveCommit(git, revision);
    const versioning = await readVersioning(scope.absolutePath);
    if (!versioning?.enabled) throw notFound("Versioning isn't on for this folder.");
    await requireCleanTree(git);
    await git.raw(["checkout", sha, "--", "."]);
    const added = (await git.raw(["diff", "--name-only", "-z", "--diff-filter=A", sha, "HEAD"]))
      .split("\0")
      .filter((addedPath) => addedPath !== "");
    for (let start = 0; start < added.length; start += REMOVE_BATCH_SIZE) {
      await git.raw(["rm", "-q", "-r", "--ignore-unmatch", "--", ...added.slice(start, start + REMOVE_BATCH_SIZE)]);
    }
    const restoreSha = await commitAll(git, `Restore folder to ${sha.slice(0, 7)}`, userAuthor(actor.username));
    if (!restoreSha) return {};
    await writeVersioning(scope.absolutePath, {
      ...versioning,
      undoStack: [...versioning.undoStack, restoreSha],
      redoStack: [],
    });
    announceRewrittenFiles(storage.id, scope, await readChangedPaths(git, restoreSha));
    emitVersioningChange(storage.id, scope.path, "commit");
    return { sha: restoreSha };
  });
}
