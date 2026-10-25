import "server-only";
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { CliError } from "@/server/cli/cli-error";
import type { SystemPaths } from "@/server/cli/paths";

export interface CommandResult {
  /** undefined when the command could not run at all. */
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  /** True when the program is not installed (ENOENT). */
  isMissing: boolean;
}

export type CommandRunner = (command: string, commandArguments: readonly string[]) => Promise<CommandResult>;

/** Everything a command touches outside its own logic, so tests can swap it. */
export interface CliContext {
  paths: SystemPaths;
  /** The real user id (`process.getuid()`); undefined on Windows. */
  userId: number | undefined;
  runCommand: CommandRunner;
  print: (line: string) => void;
  warn: (line: string) => void;
}

/** Runs a program without a shell and collects its output; never throws for a non-zero exit. */
export const runSystemCommand: CommandRunner = (command, commandArguments) =>
  new Promise((resolve) => {
    execFile(command, [...commandArguments], { encoding: "utf8" }, (runError, stdout, stderr) => {
      const errorCode = (runError as NodeJS.ErrnoException | null)?.code;
      resolve({
        exitCode: runError ? (typeof errorCode === "number" ? errorCode : undefined) : 0,
        stdout,
        stderr,
        isMissing: errorCode === "ENOENT",
      });
    });
  });

export function isSandbox(context: CliContext): boolean {
  return context.paths.sandboxRoot !== undefined;
}

/** The service account's user and group ids, read from the data folder `install.sh` gives it (0750 ccm:ccm). */
export function readServiceOwner(paths: SystemPaths): { userId: number; groupId: number } | undefined {
  try {
    const dataStats = statSync(paths.dataDir);
    return { userId: dataStats.uid, groupId: dataStats.gid };
  } catch {
    return undefined;
  }
}

/** True when ownership should be handed to the service account: running as root on a real install. */
export function shouldChangeOwnership(context: CliContext): boolean {
  return context.userId === 0 && !isSandbox(context);
}

/** Commands that change system files need root (skipped in a sandbox). */
export function requireRoot(context: CliContext, commandLine: string): void {
  if (isSandbox(context) || context.userId === 0) return;
  throw new CliError(`This needs root. Run: sudo ${commandLine}`);
}

/** Commands that only touch CCM's data folder run as root or as the service account that owns it. */
export function requireRootOrServiceAccount(context: CliContext, commandLine: string): void {
  if (isSandbox(context) || context.userId === 0) return;
  const serviceOwner = readServiceOwner(context.paths);
  if (serviceOwner && context.userId === serviceOwner.userId) return;
  throw new CliError(`This needs root or the ccm user. Run: sudo ${commandLine}`);
}
