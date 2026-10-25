import "server-only";
import type { SimpleGit } from "simple-git";
import type { UndoRedoPeek } from "@/lib/api-types";
import { getEventBus } from "@/server/events/bus";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { invalidateMemoryStats } from "@/server/memory";
import { resolveInStorage } from "@/server/security/path-jail";
import { flushAutocommits, rememberAppWrites } from "@/server/versioning/autocommit";
import { resolveHistoryTarget } from "@/server/versioning/history";
import { assertHistoryChangeAllowed, type VersioningRequest } from "@/server/versioning/lifecycle";
import { commitAll, readDirtyPaths, userAuthor, withRepo } from "@/server/versioning/repo";
import { emitVersioningChange, readVersioning, writeVersioning, type VersionedScope } from "@/server/versioning/scope";

/** The message without "Undo: " / "Redo: ", so undoing a redo reads "Undo: Edit notes.md". */
export function baseMessage(message: string): string {
  return message.replace(/^(?:(?:Undo|Redo): )+/, "");
}

async function readSubject(git: SimpleGit, sha: string): Promise<{ message: string; date: string }> {
  const [message = "", date = ""] = (await git.raw(["log", "-n1", "--format=%s%x1f%aI", sha])).trim().split("\u001F");
  return { message, date };
}

/** The files a commit changed, relative to the versioned folder. */
export async function readChangedPaths(git: SimpleGit, sha: string): Promise<string[]> {
  const output = await git.raw(["diff-tree", "--no-commit-id", "-r", "--root", "-z", "--name-only", sha]);
  return output.split("\0").filter((changedPath) => changedPath !== "");
}

/**
 * Tells listings and open files that git rewrote files of a versioned folder (undo, redo, restore):
 * `fs.changed` per changed file (up to 500), and the folder's stats are recomputed.
 */
export function announceRewrittenFiles(storageId: string, scope: VersionedScope, scopeRelativePaths: string[]): void {
  rememberAppWrites(scope.absolutePath, scopeRelativePaths);
  const eventBus = getEventBus();
  for (const changedPath of scopeRelativePaths.slice(0, 500)) {
    eventBus.emit("fs.changed", {
      storageId,
      path: scope.path === "" ? changedPath : `${scope.path}/${changedPath}`,
      change: "changed",
    });
  }
  eventBus.emit("fs.changed", { storageId, path: scope.path, change: "changed" });
  invalidateMemoryStats(storageId, scope.path);
}

/** Refuses an undo, redo or folder restore over changes that aren't committed yet. */
export async function requireCleanTree(git: SimpleGit): Promise<void> {
  if ((await readDirtyPaths(git)).length === 0) return;
  throw new ApiRouteError(
    409,
    "SCOPE_BUSY",
    "Some changes made outside CCM haven't been recorded yet. Try again in a few seconds.",
  );
}

/**
 * Applies `git revert --no-commit <sha>`, or aborts and answers 409 `UNDO_CONFLICT` when later
 * changes touch the same lines (the history viewer's restore is the way out then).
 */
async function revertOrConflict(git: SimpleGit, sha: string, action: "undo" | "redo"): Promise<void> {
  try {
    await git.raw(["revert", "--no-commit", sha]);
  } catch {
    await git.raw(["revert", "--abort"]).catch(() => git.raw(["reset", "--merge"]).catch(() => undefined));
    throw new ApiRouteError(
      409,
      "UNDO_CONFLICT",
      `This change can't be ${action === "undo" ? "undone" : "redone"} automatically: later changes touch the same lines. Open the history to restore a version instead.`,
    );
  }
}

async function requireScopeRequest({ storage, path: entryPath }: VersioningRequest) {
  const target = await resolveHistoryTarget(storage, entryPath);
  const scopeResolved = await resolveInStorage(storage, target.scope.path);
  await assertHistoryChangeAllowed(storage, scopeResolved);
  await flushAutocommits(storage.id, target.scope.path);
  return target.scope;
}

/**
 * Undo: reverts the newest commit on the undo stack as a new commit
 * "Undo: <message>" and remembers it for redo. History is never rewritten.
 *
 * @example
 * await undo({ storage, path: "persona/notes.md", actor });
 */
export async function undo(request: VersioningRequest): Promise<{ sha: string; message: string }> {
  const scope = await requireScopeRequest(request);
  return withRepo(scope.absolutePath, async (git) => {
    const versioning = await readVersioning(scope.absolutePath);
    const original = versioning?.undoStack.at(-1);
    if (!versioning || !original) throw validationFailed("There is nothing to undo.");
    await requireCleanTree(git);
    const label = baseMessage((await readSubject(git, original)).message);
    await revertOrConflict(git, original, "undo");
    const message = `Undo: ${label}`;
    const sha = await commitAll(git, message, userAuthor(request.actor.username), { allowEmpty: true });
    if (!sha) throw validationFailed("The undo didn't produce a commit.");
    await writeVersioning(scope.absolutePath, {
      ...versioning,
      undoStack: versioning.undoStack.slice(0, -1),
      redoStack: [...versioning.redoStack, { original, revert: sha }],
    });
    announceRewrittenFiles(request.storage.id, scope, await readChangedPaths(git, sha));
    emitVersioningChange(request.storage.id, scope.path, "commit");
    return { sha, message };
  });
}

/**
 * Redo: reverts the newest undo as a new commit "Redo: <message>"; the result can be
 * undone again. A new change clears the redo stack.
 *
 * @example
 * await redo({ storage, path: "persona", actor });
 */
export async function redo(request: VersioningRequest): Promise<{ sha: string; message: string }> {
  const scope = await requireScopeRequest(request);
  return withRepo(scope.absolutePath, async (git) => {
    const versioning = await readVersioning(scope.absolutePath);
    const entry = versioning?.redoStack.at(-1);
    if (!versioning || !entry) throw validationFailed("There is nothing to redo.");
    await requireCleanTree(git);
    const label = baseMessage((await readSubject(git, entry.original)).message);
    await revertOrConflict(git, entry.revert, "redo");
    const message = `Redo: ${label}`;
    const sha = await commitAll(git, message, userAuthor(request.actor.username), { allowEmpty: true });
    if (!sha) throw validationFailed("The redo didn't produce a commit.");
    await writeVersioning(scope.absolutePath, {
      ...versioning,
      undoStack: [...versioning.undoStack, sha],
      redoStack: versioning.redoStack.slice(0, -1),
    });
    announceRewrittenFiles(request.storage.id, scope, await readChangedPaths(git, sha));
    emitVersioningChange(request.storage.id, scope.path, "commit");
    return { sha, message };
  });
}

/**
 * What Undo and Redo would do: their labels ("Edit notes.md") and times, for tooltips like
 * "Undo: Edit notes.md · 2 min ago". `blockedReason` says why both are off right now.
 *
 * @example
 * const peek = await peekUndoRedo(scope, blockedReason);
 */
export async function peekUndoRedo(scope: VersionedScope, blockedReason?: string): Promise<UndoRedoPeek> {
  const { undoStack, redoStack } = scope.versioning;
  const undoSha = undoStack.at(-1);
  const redoEntry = redoStack.at(-1);
  const peek: UndoRedoPeek = { canUndo: false, canRedo: false };
  if (blockedReason) peek.blockedReason = blockedReason;
  if (!undoSha && !redoEntry) return peek;
  await withRepo(scope.absolutePath, async (git) => {
    if (undoSha) {
      const { message, date } = await readSubject(git, undoSha);
      Object.assign(peek, { canUndo: !blockedReason, undoLabel: baseMessage(message), undoAt: date });
    }
    if (redoEntry) {
      const { message, date } = await readSubject(git, redoEntry.revert);
      Object.assign(peek, { canRedo: !blockedReason, redoLabel: baseMessage(message), redoAt: date });
    }
  });
  return peek;
}
