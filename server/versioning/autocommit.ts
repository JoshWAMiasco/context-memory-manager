import "server-only";
import { LEGACY_META_DIRECTORY } from "@/lib/fs/legacy-names";
import path from "node:path";
import { readOperationRoot, registerAfter, type FileOperation } from "@/server/storage/pipeline";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { commitAll, userAuthor, withRepo, type CommitAuthor } from "@/server/versioning/repo";
import {
  emitVersioningChange,
  forgetVersionedScope,
  isInsideScope,
  readVersioning,
  recordVersionedScope,
  toScopeRelative,
  versionedScopeOf,
  writeVersioning,
  type VersionedScope,
} from "@/server/versioning/scope";

export const AUTOCOMMIT_HOOK_NAME = "versioning";

/** Changes within this window go into one commit. */
const DEFAULT_BATCH_MILLISECONDS = 2000;
/** How long a path CMM wrote counts as "ours" for the external-change watcher. */
const APP_WRITE_MEMORY_MILLISECONDS = 30_000;

type ChangeKind =
  | "write"
  | "create"
  | "mkdir"
  | "rename"
  | "move"
  | "copy"
  | "delete"
  | "restore"
  | "upload"
  | "replace";

interface PendingChange {
  kind: ChangeKind;
  message: string;
  author: CommitAuthor;
}

interface PendingBatch {
  storageId: string;
  scopePath: string;
  scopeAbsolutePath: string;
  changes: PendingChange[];
  timer?: NodeJS.Timeout;
}

interface AutocommitState {
  batches: Map<string, PendingBatch>;
  /** Folders whose changes are being committed by a restore, undo or redo itself. */
  suppressed: Set<string>;
  /** Per folder: storage-relative paths CMM changed recently, with when. */
  appWrites: Map<string, Map<string, number>>;
  batchMilliseconds: number;
}

function getState(): AutocommitState {
  return getGlobalSingleton("versioning-autocommit", () => ({
    batches: new Map(),
    suppressed: new Set(),
    appWrites: new Map(),
    batchMilliseconds: DEFAULT_BATCH_MILLISECONDS,
  }));
}

function toKey(storageId: string, scopePath: string): string {
  return `${storageId}\u0000${scopePath}`;
}

/** Tests only: a shorter (or longer) batching window. */
export function setAutocommitBatchMilliseconds(milliseconds: number): void {
  getState().batchMilliseconds = milliseconds;
}

/** Remembers that CMM changed `relativePaths` (storage-relative) in the folder at `scopeAbsolutePath`. */
export function rememberAppWrites(scopeAbsolutePath: string, relativePaths: string[]): void {
  const appWrites = getState().appWrites;
  const folderWrites = appWrites.get(scopeAbsolutePath) ?? new Map<string, number>();
  const now = Date.now();
  for (const [writtenPath, writtenAt] of folderWrites) {
    if (now - writtenAt > APP_WRITE_MEMORY_MILLISECONDS) folderWrites.delete(writtenPath);
  }
  for (const relativePath of relativePaths) folderWrites.set(relativePath, now);
  appWrites.set(scopeAbsolutePath, folderWrites);
}

/**
 * Whether CMM itself changed `scopeRelativePath` (or a folder around it) in the last 30 seconds,
 * so the external-change watcher doesn't call it an outside change.
 */
export function wasWrittenByApp(scopeAbsolutePath: string, scopeRelativePath: string): boolean {
  const folderWrites = getState().appWrites.get(scopeAbsolutePath);
  if (!folderWrites) return false;
  const now = Date.now();
  for (const [writtenPath, writtenAt] of folderWrites) {
    if (now - writtenAt > APP_WRITE_MEMORY_MILLISECONDS) continue;
    if (writtenPath === scopeRelativePath || scopeRelativePath.startsWith(`${writtenPath}/`)) return true;
  }
  return false;
}

/**
 * Runs `task` while the folder's own after-hooks are ignored: a restore, undo or redo writes files
 * through the pipeline and then makes its own commit with its own message.
 *
 * @example
 * await withoutAutocommit(storageId, scopePath, () => writeFileContent(…));
 */
export async function withoutAutocommit<Result>(
  storageId: string,
  scopePath: string,
  task: () => Promise<Result>,
): Promise<Result> {
  const key = toKey(storageId, scopePath);
  getState().suppressed.add(key);
  try {
    return await task();
  } finally {
    getState().suppressed.delete(key);
  }
}

function describePath(scopePath: string, relativePath: string): string {
  return isInsideScope(scopePath, relativePath) ? toScopeRelative(scopePath, relativePath) || "." : `/${relativePath}`;
}

function describeChange(operation: FileOperation, scopePath: string): PendingChange | undefined {
  const author = userAuthor(operation.actor.username);
  const source = describePath(scopePath, operation.path);
  const destination = operation.destination ? describePath(scopePath, operation.destination.path) : "";
  switch (operation.type) {
    case "write":
    case "create":
      if (operation.origin === "upload") return { kind: "upload", message: `Upload ${source}`, author };
      if (operation.origin === "replace") return { kind: "replace", message: `Replace ${source} (uploaded)`, author };
      return operation.type === "write"
        ? { kind: "write", message: `Edit ${source}`, author }
        : { kind: "create", message: `Create ${source}`, author };
    case "mkdir":
      return { kind: "mkdir", message: `New folder ${source}`, author };
    case "rename":
      return { kind: "rename", message: `Rename ${source} → ${destination}`, author };
    case "move":
      return { kind: "move", message: `Move ${source} → ${destination}`, author };
    case "copy":
      return { kind: "copy", message: `Copy ${source} → ${destination}`, author };
    case "delete":
      return { kind: "delete", message: `Moved ${source} to Trash`, author };
    case "restore":
      return { kind: "restore", message: `Restore ${source} from Trash`, author };
    default:
      return undefined;
  }
}

const PLURAL_MESSAGES: Partial<Record<ChangeKind, (count: number) => string>> = {
  upload: (count) => `Upload ${count} files`,
  write: (count) => `Edit ${count} files`,
  create: (count) => `Create ${count} files`,
  mkdir: (count) => `New ${count} folders`,
  delete: (count) => `Moved ${count} items to Trash`,
  restore: (count) => `Restore ${count} items from Trash`,
};

/**
 * One commit message for a batch of changes: the change's own message ("Edit notes.md"),
 * a count when they are all of one kind ("Upload 3 files"), else the first with how many more.
 *
 * @example
 * buildCommitMessage([{ kind: "write", message: "Edit a.md", … }]); // "Edit a.md"
 */
export function buildCommitMessage(changes: readonly Pick<PendingChange, "kind" | "message">[]): string {
  const unique = changes.filter(
    (change, changeIndex) => changes.findIndex((other) => other.message === change.message) === changeIndex,
  );
  const first = unique[0];
  if (!first) return "Update files";
  if (unique.length === 1) return first.message;
  const plural = unique.every((change) => change.kind === first.kind) ? PLURAL_MESSAGES[first.kind] : undefined;
  if (plural) return plural(unique.length);
  return `${first.message} and ${unique.length - 1} more change${unique.length === 2 ? "" : "s"}`;
}

/**
 * Commits whatever changed in a versioned folder and puts the commit on the undo stack, clearing
 * redo (a new change makes the undone ones unreachable). Returns the commit, if any.
 */
export async function commitScopeChanges(
  scope: Pick<VersionedScope, "absolutePath">,
  storageId: string,
  scopePath: string,
  message: string,
  author: CommitAuthor,
): Promise<string | undefined> {
  return withRepo(scope.absolutePath, async (git) => {
    const versioning = await readVersioning(scope.absolutePath);
    if (!versioning?.enabled) return undefined;
    const sha = await commitAll(git, message, author);
    if (!sha) return undefined;
    await writeVersioning(scope.absolutePath, {
      ...versioning,
      undoStack: [...versioning.undoStack, sha],
      redoStack: [],
    });
    emitVersioningChange(storageId, scopePath, "commit");
    return sha;
  });
}

async function flushBatch(key: string): Promise<void> {
  const state = getState();
  const batch = state.batches.get(key);
  if (!batch) return;
  state.batches.delete(key);
  clearTimeout(batch.timer);
  const author = batch.changes[0]?.author ?? userAuthor(undefined);
  try {
    await commitScopeChanges(
      { absolutePath: batch.scopeAbsolutePath },
      batch.storageId,
      batch.scopePath,
      buildCommitMessage(batch.changes),
      author,
    );
  } catch (commitError) {
    console.warn(`[cmm] versioning: couldn't commit changes in "${batch.scopePath}"`, commitError);
  }
}

/**
 * Commits a folder's pending changes now instead of after the batching window (before an undo,
 * a restore or turning versioning off).
 */
export async function flushAutocommits(storageId: string, scopePath: string): Promise<void> {
  await flushBatch(toKey(storageId, scopePath));
}

/** Whether a folder has changes waiting for their auto-commit. */
export function hasPendingAutocommit(storageId: string, scopePath: string): boolean {
  return getState().batches.has(toKey(storageId, scopePath));
}

/** Commits every pending batch (shutdown, tests). */
export async function flushAllAutocommits(): Promise<void> {
  await Promise.all([...getState().batches.keys()].map((key) => flushBatch(key)));
}

function queueChange(scope: VersionedScope, storageId: string, change: PendingChange): void {
  const state = getState();
  const key = toKey(storageId, scope.path);
  if (state.suppressed.has(key)) return;
  const batch = state.batches.get(key) ?? {
    storageId,
    scopePath: scope.path,
    scopeAbsolutePath: scope.absolutePath,
    changes: [],
  };
  batch.changes.push(change);
  batch.timer ??= setTimeout(() => void flushBatch(key), state.batchMilliseconds);
  state.batches.set(key, batch);
}

/** Keeps the versioned-folder index right when a folder is renamed, moved or trashed. */
async function updateIndex(operation: FileOperation): Promise<void> {
  if (!operation.isDirectory || !["rename", "move", "delete"].includes(operation.type)) return;
  forgetVersionedScope(operation.storageId, operation.path, { withDescendants: true });
  const destination = operation.destination;
  if (!destination) return;
  const scope = await versionedScopeOf(readOperationRoot(destination), destination.path, { isDirectory: true });
  if (scope?.path === destination.path) recordVersionedScope(destination.storageId, scope.path);
}

/**
 * The versioning after-hook: every change inside a versioned folder is queued and
 * committed after 2 seconds, together with whatever else changed in that folder meanwhile. A move
 * between two versioned folders is recorded in both. Ciphertext is committed as it is.
 *
 * @example
 * registerAfter(AUTOCOMMIT_HOOK_NAME, autocommitAfterHook);
 */
export async function autocommitAfterHook(operation: FileOperation): Promise<void> {
  if (["read", "list", "stat"].includes(operation.type)) return;
  if (operation.path.split("/").some((segment) => segment === ".cmm" || segment === LEGACY_META_DIRECTORY)) return;
  await updateIndex(operation);
  const isDirectory = operation.isDirectory === true;
  const targets: { storageId: string; scope: VersionedScope }[] = [];
  const sourceScope = await versionedScopeOf(readOperationRoot(operation), operation.path, { isDirectory });
  if (sourceScope && sourceScope.path !== operation.path)
    targets.push({ storageId: operation.storageId, scope: sourceScope });
  const destination = operation.destination;
  if (destination) {
    const destinationScope = await versionedScopeOf(
      readOperationRoot(destination),
      path.posix.dirname(destination.path),
      {
        isDirectory: true,
      },
    );
    const isSameScope = sourceScope?.absolutePath === destinationScope?.absolutePath && targets.length > 0;
    if (destinationScope && !isSameScope) targets.push({ storageId: destination.storageId, scope: destinationScope });
  }
  for (const { storageId, scope } of targets) {
    const change = describeChange(operation, scope.path);
    if (!change) continue;
    rememberAppWrites(
      scope.absolutePath,
      [operation.path, destination?.path]
        .filter((changedPath): changedPath is string => changedPath !== undefined)
        .filter((changedPath) => isInsideScope(scope.path, changedPath))
        .map((changedPath) => toScopeRelative(scope.path, changedPath)),
    );
    queueChange(scope, storageId, change);
  }
}

/** Registers the versioning after-hook in the file operation pipeline (idempotent). */
export function registerAutocommitHook(): void {
  registerAfter(AUTOCOMMIT_HOOK_NAME, autocommitAfterHook);
}
