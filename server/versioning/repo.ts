import "server-only";
import { chmod, readdir, rm } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { ApiRouteError } from "@/server/http/api-error";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { requireGit } from "@/server/versioning/git-detect";
import { joinStoragePath } from "@/server/storage/storage-path";

/** Commits are made by CCM; the author is the user, or "External" for changes made outside CCM. */
export const COMMITTER = { name: "CCM", email: "ccm@local" } as const;
export const EXTERNAL_AUTHOR = { name: "External", email: "external@ccm.local" } as const;

export interface CommitAuthor {
  name: string;
  email: string;
}

/** The author for a user's change: `<username> <username@ccm.local>`. */
export function userAuthor(username: string | undefined): CommitAuthor {
  const name = username?.trim() || "CCM user";
  return { name, email: `${name.replaceAll(/[^\w.-]/g, "_")}@ccm.local` };
}

/** Git can take a while on large folders; nothing should hang forever. */
const COMMAND_TIMEOUT_MILLISECONDS = 120_000;

export const GITIGNORE_FILE = ".gitignore";
export const MANAGED_BLOCK_START = "# >>> CCM managed";
export const MANAGED_BLOCK_END = "# <<< CCM managed";

/**
 * What CCM keeps out of history: its trash and staging areas, and its own `.ccm/` settings except
 * the memory manifest. Protection, encryption state and the versioning stacks change on their own
 * and must never come back through an undo or restore.
 */
export const MANAGED_IGNORE_LINES = [
  ".ccm-trash/",
  ".ccm-tmp/",
  ".ccm-tmp*",
  "*.ccm-tmp",
  ".ccm/*",
  "!.ccm/manifest.json",
] as const;

/**
 * Adds CCM's block to a `.gitignore`, or replaces an older copy of it; the user's own
 * lines stay as they are.
 *
 * @example
 * mergeManagedBlock("node_modules/\n"); // "node_modules/\n\n# >>> CCM managed\n…\n# <<< CCM managed\n"
 */
export function mergeManagedBlock(existing: string): string {
  const block = [MANAGED_BLOCK_START, ...MANAGED_IGNORE_LINES, MANAGED_BLOCK_END].join("\n");
  const withoutBlock = removeManagedBlock(existing).replace(/\s*$/, "");
  return withoutBlock === "" ? `${block}\n` : `${withoutBlock}\n\n${block}\n`;
}

/** Removes CCM's block from a `.gitignore`, keeping everything else. */
export function removeManagedBlock(existing: string): string {
  const lines = existing.split(/\r?\n/);
  const start = lines.indexOf(MANAGED_BLOCK_START);
  const end = lines.indexOf(MANAGED_BLOCK_END, start);
  if (start === -1 || end === -1) return existing;
  const kept = [...lines.slice(0, start), ...lines.slice(end + 1)];
  const text = kept.join("\n").replaceAll(/\n{3,}/g, "\n\n");
  return text.trim() === "" ? "" : `${text.replace(/\s*$/, "")}\n`;
}

/**
 * The environment git runs with: no prompts, no system or user config (so a personal
 * `commit.gpgsign`, hook path or ignore file can't change what CCM records), CCM as committer.
 */
function buildEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_COMMITTER_NAME: COMMITTER.name,
    GIT_COMMITTER_EMAIL: COMMITTER.email,
    LANG: "C",
    LC_ALL: "C",
  };
  // GIT_CEILING_DIRECTORIES lets an admin stop git from treating a repository above the storages as theirs.
  for (const name of [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "GIT_CEILING_DIRECTORIES",
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

/**
 * `-c` settings for every command: exact bytes (no line-ending conversion, which matters
 * for ciphertext), no signing, unquoted UTF-8 paths, and no hooks or fsmonitor, so a repository
 * CCM adopts can't run its own programs.
 */
function buildConfig(scopeAbsolutePath: string): string[] {
  return [
    "core.autocrlf=false",
    "core.safecrlf=false",
    "commit.gpgsign=false",
    "core.quotepath=false",
    "core.fsmonitor=false",
    `core.hooksPath=${devNull}`,
    "gc.autoDetach=false",
    "advice.detachedHead=false",
    "init.defaultBranch=main",
    `safe.directory=${scopeAbsolutePath.split(path.sep).join("/")}`,
  ];
}

/**
 * A git client for one folder. Only the settings above are allowed past simple-git's safety
 * checks; anything else that runs programs stays blocked.
 *
 * @example
 * const git = await openGit("/data/notes/persona");
 */
export async function openGit(scopeAbsolutePath: string): Promise<SimpleGit> {
  const binary = await requireGit();
  const environment = buildEnvironment();
  return simpleGit({
    baseDir: scopeAbsolutePath,
    binary,
    maxConcurrentProcesses: 1,
    trimmed: false,
    config: buildConfig(scopeAbsolutePath),
    timeout: { block: COMMAND_TIMEOUT_MILLISECONDS },
    unsafe: {
      allowUnsafeCustomBinary: true,
      allowUnsafeHooksPath: true,
      allowUnsafeFsMonitor: true,
      allowUnsafeConfigPaths: true,
    },
    // simple-git 4 refuses GIT_* variables it isn't told about; these are CCM's own, listed above.
    allowEnvironment: Object.keys(environment).filter((name) => name.startsWith("GIT_")),
  }).env(environment);
}

function getRepoLocks(): Map<string, Promise<unknown>> {
  return getGlobalSingleton("versioning-repo-locks", () => new Map<string, Promise<unknown>>());
}

/**
 * Runs `task` with the folder's repository to itself: git commands of one repository
 * never overlap (two would fight over `index.lock`), while different folders run in parallel.
 *
 * @example
 * const sha = await withRepo(scopePath, (git) => commitAll(git, "Edit notes.md", author));
 */
export async function withRepo<Result>(
  scopeAbsolutePath: string,
  task: (git: SimpleGit) => Promise<Result>,
): Promise<Result> {
  const locks = getRepoLocks();
  const previous = locks.get(scopeAbsolutePath) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => task(await openGit(scopeAbsolutePath)));
  const settled = run.catch(() => undefined);
  locks.set(scopeAbsolutePath, settled);
  void settled.then(() => {
    if (locks.get(scopeAbsolutePath) === settled) locks.delete(scopeAbsolutePath);
  });
  return run;
}

/** 500 `GIT_COMMAND_FAILED` with git's own message, for failures CCM can't explain better. */
export function gitFailed(action: string, gitError: unknown): ApiRouteError {
  const detail = gitError instanceof Error ? gitError.message.trim().split("\n").slice(0, 3).join(" ") : "";
  return new ApiRouteError(500, "GIT_COMMAND_FAILED", `Git couldn't ${action}.${detail ? ` ${detail}` : ""}`);
}

/** The current commit, or undefined in a repository without commits. */
export async function readHead(git: SimpleGit): Promise<string | undefined> {
  try {
    return (await git.raw(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Whether anything is staged (after `git add -A`). */
async function hasStagedChanges(git: SimpleGit): Promise<boolean> {
  const status = await git.raw(["status", "--porcelain", "-z", "--untracked-files=no"]);
  return status.split("\0").some((line) => line.length > 2 && line[0] !== " " && line[0] !== "?");
}

/**
 * Stages everything and commits it (`git add -A`); returns the new commit, or undefined when
 * nothing changed. `allowEmpty` always commits (the enable commit, an undo that changes nothing).
 *
 * @example
 * const sha = await commitAll(git, "Edit notes.md", userAuthor("alex"));
 */
export async function commitAll(
  git: SimpleGit,
  message: string,
  author: CommitAuthor,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Promise<string | undefined> {
  await git.raw(["add", "-A"]);
  if (!allowEmpty && !(await hasStagedChanges(git))) return undefined;
  await git.raw([
    "commit",
    "--quiet",
    "--no-verify",
    ...(allowEmpty ? ["--allow-empty"] : []),
    `--author=${author.name} <${author.email}>`,
    "-m",
    message,
  ]);
  return readHead(git);
}

/** The paths (relative to the folder) with uncommitted changes, untracked ones included. */
export async function readDirtyPaths(git: SimpleGit): Promise<string[]> {
  const entries = (await git.raw(["status", "--porcelain", "-z", "--untracked-files=all"])).split("\0");
  const paths: string[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex] ?? "";
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    // A rename lists its old path as the next entry.
    if (entry[0] === "R" || entry[0] === "C") entryIndex += 1;
  }
  return paths;
}

/**
 * Deletes a folder tree, making read-only entries writable first when the platform refuses (git
 * stores objects read-only, and Windows won't delete those).
 */
export async function removeTree(absolutePath: string): Promise<void> {
  try {
    await rm(absolutePath, { recursive: true, force: true, maxRetries: 3 });
  } catch (removeError) {
    if ((removeError as NodeJS.ErrnoException).code !== "EPERM") throw removeError;
    await makeWritable(absolutePath);
    await rm(absolutePath, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function makeWritable(absolutePath: string): Promise<void> {
  await chmod(absolutePath, 0o700).catch(() => undefined);
  const children = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  for (const child of children) {
    const childPath = joinStoragePath(absolutePath, child.name);
    if (child.isDirectory()) await makeWritable(childPath);
    else await chmod(childPath, 0o600).catch(() => undefined);
  }
}
