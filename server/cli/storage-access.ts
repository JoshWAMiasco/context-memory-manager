import "server-only";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { CliError } from "@/server/cli/cli-error";
import { isSandbox, readServiceOwner, type CliContext } from "@/server/cli/context";
import { SERVICE_ACCOUNT, type SystemPaths } from "@/server/cli/paths";

/** System folders that are never storages, nor is anything inside them. */
const SYSTEM_TREES = ["/proc", "/sys", "/dev", "/etc", "/boot", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/run"];
/** Folders that hold other things and may not be a storage themselves (a folder inside them is fine). */
const SYSTEM_FOLDERS = ["/", "/home", "/root", "/var", "/srv", "/opt", "/media", "/mnt", "/tmp"];

function isInside(childPath: string, parentPath: string): boolean {
  return childPath === parentPath || childPath.startsWith(parentPath === "/" ? "/" : `${parentPath}/`);
}

/**
 * Checks a folder before it becomes a storage root and returns its real path (symlinks resolved):
 * absolute, existing, a folder, not a system folder, not CMM's own data or program folder, and free
 * of characters that systemd or the config can't carry (quotes, backslashes, line breaks).
 */
export function validateStorageRoot(rootInput: string, paths: SystemPaths): string {
  if (!path.isAbsolute(rootInput)) throw new CliError(`Give an absolute path, such as /srv/cmm (got "${rootInput}").`);
  if (/["\\\n\r]/.test(rootInput)) throw new CliError("The path can't contain quotes, backslashes or line breaks.");
  let rootPath: string;
  try {
    rootPath = realpathSync(rootInput);
  } catch {
    throw new CliError(`${rootInput} does not exist. Create the folder first.`);
  }
  if (!statSync(rootPath).isDirectory()) throw new CliError(`${rootPath} is not a folder.`);
  const toSystemPath = (candidatePath: string) =>
    paths.sandboxRoot && isInside(candidatePath, paths.sandboxRoot)
      ? `/${path.relative(paths.sandboxRoot, candidatePath)}`
      : candidatePath;
  const isSystemFolder = (candidatePath: string) =>
    SYSTEM_FOLDERS.includes(candidatePath) || SYSTEM_TREES.some((systemTree) => isInside(candidatePath, systemTree));
  /* Both as given and with symlinks resolved: /etc is a link to /private/etc on macOS. */
  if (isSystemFolder(toSystemPath(path.resolve(rootInput))) || isSystemFolder(toSystemPath(rootPath))) {
    throw new CliError(`${rootPath} is a system folder. Use a folder of its own, such as /srv/cmm.`);
  }
  for (const ownFolder of [paths.dataDir, paths.installRoot, path.dirname(paths.configFile)]) {
    if (isInside(rootPath, ownFolder) || isInside(ownFolder, rootPath)) {
      throw new CliError(`${rootPath} overlaps CMM's own folder ${ownFolder}.`);
    }
  }
  return rootPath;
}

/** Parent folders the service account can't pass through (no "other" execute bit), from the top down. */
export function listClosedAncestors(rootPath: string, readMode: (folder: string) => number): string[] {
  const closedAncestors: string[] = [];
  for (let ancestor = path.dirname(rootPath); ; ancestor = path.dirname(ancestor)) {
    if ((readMode(ancestor) & 0o001) === 0) closedAncestors.unshift(ancestor);
    if (ancestor === path.dirname(ancestor)) break;
  }
  return closedAncestors;
}

function printManualAccessSteps(
  context: CliContext,
  rootPath: string | undefined,
  closedAncestors: readonly string[],
): void {
  context.warn("setfacl is not installed (package `acl`), so CMM could not grant itself access. Either install it");
  context.warn(`and run this command again, or give the ${SERVICE_ACCOUNT} group access yourself:`);
  if (rootPath) {
    context.warn(`  sudo chgrp -R ${SERVICE_ACCOUNT} '${rootPath}'`);
    context.warn(`  sudo chmod -R g+rwX '${rootPath}'`);
    context.warn(`  sudo find '${rootPath}' -type d -exec chmod g+s {} +`);
  }
  for (const ancestor of closedAncestors) context.warn(`  sudo chmod o+x '${ancestor}'   # lets CMM pass through`);
}

/**
 * The ACL entries (access and default) `setfacl -R -m` applies to a storage root: the service
 * account, and the folder's owner when that is a person. Files CMM creates belong to the service
 * account, so without the owner's entry the person whose folder it is couldn't open or `cd` into
 * them from their own terminal on the server.
 *
 * @example
 * readStorageAclEntries(1000, 999); // "u:cmm:rwX,d:u:cmm:rwX,u:1000:rwX,d:u:1000:rwX"
 */
export function readStorageAclEntries(ownerUserId: number, serviceUserId: number | undefined): string {
  const entries = [`u:${SERVICE_ACCOUNT}:rwX`];
  if (ownerUserId !== 0 && ownerUserId !== serviceUserId) entries.push(`u:${ownerUserId}:rwX`);
  return entries.flatMap((entry) => [entry, `d:${entry}`]).join(",");
}

/**
 * Lets the service account read and write `rootPath`: an ACL entry on everything inside, a default
 * ACL so new files inherit it, and execute-only entries on parent folders it can't pass through
 * (home folders are 0750 on current Ubuntu). The folder's owner gets the same entries, so files CMM
 * creates there stay open to them. A folder the service account already owns (install.sh creates
 * them so) keeps its permissions. Without `setfacl` it prints chgrp/chmod steps instead.
 */
export async function grantServiceAccess(context: CliContext, rootPath: string): Promise<void> {
  if (isSandbox(context)) {
    context.print(`Sandbox: skipped setfacl for ${rootPath}.`);
    return;
  }
  const closedAncestors = listClosedAncestors(rootPath, (folder) => statSync(folder).mode);
  const ownerUserId = statSync(rootPath).uid;
  const serviceUserId = readServiceOwner(context.paths)?.userId;
  const isOwned = ownerUserId === serviceUserId;
  if (isOwned) context.print(`${rootPath} already belongs to ${SERVICE_ACCOUNT}.`);
  if (isOwned && closedAncestors.length === 0) return;
  const entries = readStorageAclEntries(ownerUserId, serviceUserId);
  const steps: { target: string; aclArguments: string[] }[] = [
    ...(isOwned ? [] : [{ target: rootPath, aclArguments: ["-R", "-m", entries, rootPath] }]),
    ...closedAncestors.map((ancestor) => ({
      target: ancestor,
      aclArguments: ["-m", `u:${SERVICE_ACCOUNT}:--x`, ancestor],
    })),
  ];
  for (const [stepIndex, step] of steps.entries()) {
    const result = await context.runCommand("setfacl", step.aclArguments);
    if (result.isMissing) {
      printManualAccessSteps(context, isOwned ? undefined : rootPath, closedAncestors);
      return;
    }
    if (result.exitCode === 0) continue;
    const problem = `setfacl failed on ${step.target}: ${result.stderr.trim()}`;
    if (stepIndex === 0 && !isOwned) throw new CliError(problem);
    context.warn(problem);
  }
  const passThrough = closedAncestors.length > 0 ? ` (pass-through on ${closedAncestors.join(", ")})` : "";
  const owner = !isOwned && ownerUserId !== 0 ? ` and kept it open to its owner (uid ${ownerUserId})` : "";
  context.print(`Granted ${SERVICE_ACCOUNT} read and write access to ${rootPath}${owner}${passThrough}.`);
}
