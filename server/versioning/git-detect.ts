import "server-only";
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import type { GitDetection } from "@/lib/api-types";
import { ApiRouteError } from "@/server/http/api-error";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { areTestHooksEnabled } from "@/server/runtime/test-hooks";

/** Older git lacks `init -b` and safe command-line `safe.directory`. */
export const MINIMUM_GIT_VERSION = "2.30";
const DETECT_TIMEOUT_MILLISECONDS = 3000;
const CACHE_MILLISECONDS = 60_000;

/** Runs `<binary> --version` and resolves its output; rejects when it can't run. */
export type VersionRunner = (binary: string) => Promise<string>;

interface DetectState {
  result?: GitDetection;
  checkedAt: number;
  pending?: Promise<GitDetection>;
  /** Test runs only: pretend git isn't installed (the "no git" e2e). */
  isHiddenForTests: boolean;
}

function getDetectState(): DetectState {
  return getGlobalSingleton("git-detect", () => ({ checkedAt: 0, isHiddenForTests: false }));
}

const runVersion: VersionRunner = (binary) =>
  new Promise((resolve, reject) => {
    execFile(
      binary,
      ["--version"],
      { timeout: DETECT_TIMEOUT_MILLISECONDS, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (runError, standardOutput) => (runError ? reject(runError) : resolve(String(standardOutput))),
    );
  });

/**
 * The version in `git --version` output ("git version 2.39.3 (Apple Git-145)" → "2.39.3"), or
 * undefined for anything else (the macOS stub without developer tools prints an error instead).
 *
 * @example
 * parseGitVersion("git version 2.45.1.windows.1"); // "2.45.1"
 */
export function parseGitVersion(output: string): string | undefined {
  return /^git version (\d+\.\d+(?:\.\d+)?)/m.exec(output.trim())?.[1];
}

/** Whether `version` is at least `minimum` (both "major.minor[.patch]"). */
export function isVersionAtLeast(version: string, minimum = MINIMUM_GIT_VERSION): boolean {
  const actual = version.split(".").map(Number);
  const wanted = minimum.split(".").map(Number);
  for (let partIndex = 0; partIndex < wanted.length; partIndex += 1) {
    const difference = (actual[partIndex] ?? 0) - (wanted[partIndex] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

async function isExecutable(filePath: string): Promise<boolean> {
  return access(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK).then(
    () => true,
    () => false,
  );
}

/** The absolute path `git` resolves to on `PATH`, so every later command runs that same binary. */
async function findOnPath(environment: Record<string, string | undefined>): Promise<string | undefined> {
  const names = process.platform === "win32" ? ["git.exe", "git.cmd"] : ["git"];
  for (const directory of (environment.PATH ?? environment.Path ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      // Runtime paths from PATH: the ignore comment keeps Turbopack's file tracer from following them.
      // eslint-disable-next-line no-inline-comments
      const candidate = path.join(/* turbopackIgnore: true */ directory, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Where to look for git: `CCM_GIT_PATH`, then `PATH`, then (Windows) Git for Windows' usual folders. */
async function listCandidates(environment: Record<string, string | undefined>): Promise<string[]> {
  const candidates: string[] = [];
  if (environment.CCM_GIT_PATH) candidates.push(environment.CCM_GIT_PATH);
  const onPath = await findOnPath(environment);
  if (onPath) candidates.push(onPath);
  if (process.platform === "win32") {
    for (const programFiles of [environment.ProgramFiles, environment["ProgramFiles(x86)"]]) {
      if (programFiles) candidates.push(path.join(programFiles, "Git", "cmd", "git.exe"));
    }
  }
  return [...new Set(candidates)];
}

/**
 * Looks for git: runs `git --version` (3-second timeout) for each candidate and returns
 * the first that answers, with its version and path. A version below 2.30 is `outdated`.
 *
 * @example
 * const detection = await probeGit();
 */
export async function probeGit({
  run = runVersion,
  environment = process.env,
}: { run?: VersionRunner; environment?: Record<string, string | undefined> } = {}): Promise<GitDetection> {
  const checkedAt = new Date().toISOString();
  for (const candidate of await listCandidates(environment)) {
    const version = parseGitVersion(await run(candidate).catch(() => ""));
    if (!version) continue;
    return { installed: true, outdated: !isVersionAtLeast(version), version, path: candidate, checkedAt };
  }
  return { installed: false, outdated: false, checkedAt };
}

/**
 * Whether git is installed, cached for 60 seconds; `force` checks again ("Check again").
 *
 * @example
 * const { installed, version } = await detectGit();
 */
export async function detectGit({ force = false }: { force?: boolean } = {}): Promise<GitDetection> {
  const state = getDetectState();
  if (state.isHiddenForTests) return { installed: false, outdated: false, checkedAt: new Date().toISOString() };
  if (!force && state.result && Date.now() - state.checkedAt < CACHE_MILLISECONDS) return state.result;
  state.pending ??= probeGit().finally(() => {
    state.pending = undefined;
  });
  const result = await state.pending;
  state.result = result;
  state.checkedAt = Date.now();
  return result;
}

/**
 * The git binary to run, or 409 `GIT_NOT_INSTALLED` when git is missing or older than 2.30.
 *
 * @example
 * const gitBinary = await requireGit();
 */
export async function requireGit(): Promise<string> {
  const detection = await detectGit();
  if (!detection.installed || !detection.path) {
    throw new ApiRouteError(
      409,
      "GIT_NOT_INSTALLED",
      "Git isn't installed on this computer. Versioning needs it: see How to install Git.",
    );
  }
  if (detection.outdated) {
    throw new ApiRouteError(
      409,
      "GIT_NOT_INSTALLED",
      `Git ${detection.version} is too old. Versioning needs Git ${MINIMUM_GIT_VERSION} or newer.`,
    );
  }
  return detection.path;
}

/** Test runs only: hides git (or shows it again), as if it weren't installed. */
export function setGitHiddenForTests(isHidden: boolean): void {
  if (!areTestHooksEnabled()) return;
  const state = getDetectState();
  state.isHiddenForTests = isHidden;
  state.result = undefined;
}
