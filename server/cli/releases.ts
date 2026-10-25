import "server-only";
import { existsSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { CliError } from "@/server/cli/cli-error";

/**
 * `/opt/ccm` holds one folder per installed version plus two links that `install.sh` maintains:
 * `current` (what the unit runs) and `previous` (what `ccm rollback` returns to). Links are relative
 * (`current -> 0.2.0`), so the tree can move.
 */
export interface InstalledReleases {
  current?: string;
  previous?: string;
}

function readLink(linkPath: string): string | undefined {
  try {
    return path.basename(readlinkSync(linkPath));
  } catch {
    return undefined;
  }
}

export function readInstalledReleases(installRoot: string): InstalledReleases {
  const current = readLink(path.join(installRoot, "current"));
  const previous = readLink(path.join(installRoot, "previous"));
  return { ...(current ? { current } : {}), ...(previous ? { previous } : {}) };
}

/** Points `linkPath` at `target` by renaming a fresh link over it, so the link is never missing. */
function replaceLink(linkPath: string, target: string): void {
  const temporaryLink = `${linkPath}.${process.pid}.new`;
  rmSync(temporaryLink, { force: true });
  symlinkSync(target, temporaryLink);
  renameSync(temporaryLink, linkPath);
}

/** Swaps `current` and `previous`; running it twice goes back to where it started. Returns the versions. */
export function rollBackRelease(installRoot: string): { from: string; to: string } {
  const { current, previous } = readInstalledReleases(installRoot);
  if (!current) throw new CliError(`No current version is installed in ${installRoot}.`);
  if (!previous) throw new CliError("There is no previous version to roll back to.");
  if (!existsSync(path.join(installRoot, previous, "app", "entry.js"))) {
    throw new CliError(`The previous version ${previous} is missing from ${installRoot}.`);
  }
  replaceLink(path.join(installRoot, "current"), previous);
  replaceLink(path.join(installRoot, "previous"), current);
  return { from: current, to: previous };
}
