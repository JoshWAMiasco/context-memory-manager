import "server-only";
import { stat } from "node:fs/promises";
import type { SimpleGit } from "simple-git";
import type {
  CommitDetail,
  CommitFile,
  FileDiff,
  HistoryCommit,
  HistoryCommitKind,
  HistoryPage,
} from "@/lib/api-types";
import { ApiRouteError, notFound, validationFailed } from "@/server/http/api-error";
import { resolveInStorage } from "@/server/security/path-jail";
import type { ActiveStorage } from "@/server/storage/roots";
import { ENABLE_MESSAGE } from "@/server/versioning/lifecycle";
import { EXTERNAL_AUTHOR, gitFailed, readHead, withRepo } from "@/server/versioning/repo";
import { toScopeRelative, versionedScopeOf, type VersionedScope } from "@/server/versioning/scope";

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 200;
/** Text diffs stop here; bigger files show as "changed" with their sizes. */
const DIFF_LIMIT_BYTES = 2 * 1024 * 1024;
/** Restoring or diffing reads the version into memory; nothing bigger than this. */
export const VERSION_READ_LIMIT_BYTES = 256 * 1024 * 1024;

const RECORD_SEPARATOR = "\u001E";
const FIELD_SEPARATOR = "\u001F";
const LOG_FORMAT = `${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%aI`;

/** A versioned folder and the entry a history request is about, relative to that folder. */
export interface HistoryTarget {
  storage: ActiveStorage;
  scope: VersionedScope;
  /** The entry relative to the versioned folder ("" for the folder itself). */
  relativePath: string;
}

/**
 * The versioned folder of an entry (a file, a folder, or a path that no longer exists), or 409
 * when it isn't in one.
 *
 * @example
 * const target = await resolveHistoryTarget(storage, "persona/notes.md");
 */
export async function resolveHistoryTarget(storage: ActiveStorage, entryPath: string): Promise<HistoryTarget> {
  const resolvedPath = await resolveInStorage(storage, entryPath, { forCreate: true });
  const isDirectory = await stat(resolvedPath.absolutePath).then(
    (entryStats) => entryStats.isDirectory(),
    () => false,
  );
  const scope = await versionedScopeOf(resolvedPath.rootPath, resolvedPath.relativePath, { isDirectory });
  if (!scope) throw new ApiRouteError(409, "VALIDATION_FAILED", "Versioning isn't on for this folder.");
  return { storage, scope, relativePath: toScopeRelative(scope.path, resolvedPath.relativePath) };
}

/**
 * What kind of step a commit is, from its message and author: an undo, redo, restore, outside
 * change, the enable commit, or an ordinary change.
 *
 * @example
 * classifyCommit("Undo: Edit notes.md", "alex"); // "undo"
 */
export function classifyCommit(message: string, author: string): HistoryCommitKind {
  if (message.startsWith("Undo: ")) return "undo";
  if (message.startsWith("Redo: ")) return "redo";
  if (/^Restore (folder|.+) to [0-9a-f]{7,}$/.test(message)) return "restore";
  if (author === EXTERNAL_AUTHOR.name && message.startsWith("External changes")) return "external";
  if (message.startsWith(ENABLE_MESSAGE)) return "enable";
  return "change";
}

function parseLog(output: string): HistoryCommit[] {
  return output
    .split(RECORD_SEPARATOR)
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [header = "", ...rest] = record.split("\n");
      const [sha = "", short = "", message = "", author = "", date = ""] = header.split(FIELD_SEPARATOR);
      const filesChanged = Number(/(\d+) files? changed/.exec(rest.join("\n"))?.[1] ?? 0);
      return { sha, short, message, author, date, filesChanged, kind: classifyCommit(message, author) };
    });
}

/**
 * A page of history: every commit of the versioned folder, newest first, or only those
 * touching the entry when it isn't the folder itself. `cursor` skips commits already shown.
 *
 * @example
 * const page = await readLog(target, { limit: 50 });
 */
export async function readLog(
  target: HistoryTarget,
  { limit = DEFAULT_PAGE_SIZE, cursor = 0 }: { limit?: number; cursor?: number } = {},
): Promise<HistoryPage> {
  const pageSize = Math.min(Math.max(1, limit), MAXIMUM_PAGE_SIZE);
  return withRepo(target.scope.absolutePath, async (git) => {
    if (!(await readHead(git))) return { scopePath: target.scope.path, commits: [] };
    const commits = parseLog(
      await git.raw([
        "log",
        `--format=${LOG_FORMAT}`,
        "--shortstat",
        `--skip=${cursor}`,
        `-n${pageSize + 1}`,
        "HEAD",
        ...(target.relativePath === "" ? [] : ["--", target.relativePath]),
      ]),
    );
    const page: HistoryPage = { scopePath: target.scope.path, commits: commits.slice(0, pageSize) };
    if (commits.length > pageSize) page.nextCursor = cursor + pageSize;
    return page;
  });
}

/** The full id of a commit, or 404 for anything that isn't one in this folder's history. */
export async function resolveCommit(git: SimpleGit, revision: string): Promise<string> {
  if (!/^[0-9a-f]{4,64}$/i.test(revision)) throw validationFailed("That isn't a commit id.");
  try {
    return (await git.raw(["rev-parse", "--verify", "--quiet", `${revision}^{commit}`])).trim();
  } catch {
    throw notFound("That version isn't in this folder's history.");
  }
}

async function readCommit(git: SimpleGit, sha: string): Promise<HistoryCommit> {
  const [commit] = parseLog(await git.raw(["log", `--format=${LOG_FORMAT}`, "--shortstat", "-n1", sha]));
  if (!commit) throw notFound("That version isn't in this folder's history.");
  return commit;
}

function toStoragePath(scopePath: string, scopeRelative: string): string {
  return scopePath === "" ? scopeRelative : `${scopePath}/${scopeRelative}`;
}

/** The files a commit added, modified, deleted or renamed, from `git diff-tree -z --name-status`. */
export function parseNameStatus(output: string, scopePath: string): CommitFile[] {
  const fields = output.split("\0").filter((field) => field !== "");
  const files: CommitFile[] = [];
  for (let fieldIndex = 0; fieldIndex < fields.length;) {
    const code = fields[fieldIndex] ?? "";
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const oldPath = fields[fieldIndex + 1] ?? "";
      const newPath = fields[fieldIndex + 2] ?? "";
      files.push(
        letter === "R"
          ? { status: "R", path: toStoragePath(scopePath, newPath), oldPath: toStoragePath(scopePath, oldPath) }
          : { status: "A", path: toStoragePath(scopePath, newPath) },
      );
      fieldIndex += 3;
      continue;
    }
    const filePath = fields[fieldIndex + 1] ?? "";
    const status = letter === "A" || letter === "D" ? letter : "M";
    files.push({ status, path: toStoragePath(scopePath, filePath) });
    fieldIndex += 2;
  }
  return files;
}

/**
 * One commit and the files it changed, with paths relative to the storage.
 *
 * @example
 * const { commit, files } = await readCommitFiles(target, "3f2a9c1");
 */
export async function readCommitFiles(target: HistoryTarget, revision: string): Promise<CommitDetail> {
  return withRepo(target.scope.absolutePath, async (git) => {
    const sha = await resolveCommit(git, revision);
    const output = await git.raw(["diff-tree", "--no-commit-id", "-r", "-M", "--root", "-z", "--name-status", sha]);
    return { commit: await readCommit(git, sha), files: parseNameStatus(output, target.scope.path) };
  });
}

async function readBlob(git: SimpleGit, sha: string, scopeRelative: string): Promise<Buffer | undefined> {
  const objectName = `${sha}:${scopeRelative}`;
  let size: number;
  try {
    size = Number((await git.raw(["cat-file", "-s", objectName])).trim());
  } catch {
    return undefined;
  }
  if (size > VERSION_READ_LIMIT_BYTES) {
    throw new ApiRouteError(413, "TOO_LARGE_TO_EDIT", "That version is too large to open here.");
  }
  return Buffer.from((await git.binaryCatFile(["blob", objectName])) as Buffer);
}

/**
 * A file's bytes as of a commit, or undefined when it didn't exist then.
 *
 * @example
 * const bytes = await readFileAt(target, sha, "notes.md");
 */
export async function readFileAt(
  target: HistoryTarget,
  revision: string,
  scopeRelative: string,
): Promise<Buffer | undefined> {
  return withRepo(target.scope.absolutePath, async (git) =>
    readBlob(git, await resolveCommit(git, revision), scopeRelative),
  );
}

function isBinary(bytes: Buffer): boolean {
  if (bytes.subarray(0, 8000).includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

/**
 * A file before and after a commit: the parent's version (under its old name for a
 * rename) and the commit's own. Binary or very large files come back without text.
 *
 * @example
 * const diff = await readDiff(target, sha, "notes.md");
 */
export async function readDiff(
  target: HistoryTarget,
  revision: string,
  scopeRelative: string,
  oldScopeRelative = scopeRelative,
): Promise<FileDiff> {
  const [before, after] = await withRepo(target.scope.absolutePath, async (git) => {
    const sha = await resolveCommit(git, revision);
    const parent = await git.raw(["rev-parse", "--verify", "--quiet", `${sha}^`]).then(
      (output) => output.trim() || undefined,
      () => undefined,
    );
    return [
      parent ? await readBlob(git, parent, oldScopeRelative) : undefined,
      await readBlob(git, sha, scopeRelative),
    ];
  });
  const diff: FileDiff = {
    path: toStoragePath(target.scope.path, scopeRelative),
    binary: false,
    beforeSize: before?.length,
    afterSize: after?.length,
  };
  if ((before?.length ?? 0) > DIFF_LIMIT_BYTES || (after?.length ?? 0) > DIFF_LIMIT_BYTES) {
    return { ...diff, binary: true, tooLarge: true };
  }
  if ((before && isBinary(before)) || (after && isBinary(after))) return { ...diff, binary: true };
  return { ...diff, before: before?.toString("utf8"), after: after?.toString("utf8") };
}

/** How many commits the folder has, for the Versioning tab. */
export async function countCommits(scope: Pick<VersionedScope, "absolutePath">): Promise<number> {
  return withRepo(scope.absolutePath, async (git) => {
    if (!(await readHead(git))) return 0;
    return Number((await git.raw(["rev-list", "--count", "HEAD"])).trim());
  }).catch((gitError: unknown) => {
    throw gitFailed("count the commits", gitError);
  });
}
