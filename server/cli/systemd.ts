import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSandbox, type CliContext } from "@/server/cli/context";
import { SERVICE_NAME } from "@/server/cli/paths";

/**
 * Mount points for drives that are always writable: udisks2 mounts under `/media` (Ubuntu) or
 * `/run/media`, and people mount by hand under `/media` or `/mnt`. The `-` prefix lets the service
 * start when one of them doesn't exist.
 */
export const DRIVE_MOUNT_PATHS = ["/media", "/mnt", "/run/media"] as const;

/** One `ReadWritePaths=` value: `-` for "may be missing", `%` escaped (a unit specifier), quoted when it has spaces. */
function formatReadWritePath(directoryPath: string): string {
  const escapedPath = `-${directoryPath.replaceAll("%", "%%")}`;
  return /\s/.test(escapedPath) ? `"${escapedPath}"` : escapedPath;
}

/**
 * The drop-in that opens the storage roots to the hardened unit (`ProtectSystem=strict` and
 * `ProtectHome=read-only` make everything else read-only). Regenerated from `storageRoots` by
 * `cmm add-storage`, `cmm remove-storage` and `install.sh`.
 */
export function buildStorageDropIn(storageRoots: readonly string[]): string {
  const writablePaths = [...new Set([...storageRoots, ...DRIVE_MOUNT_PATHS])];
  return [
    "# Written by `cmm` from storageRoots in /etc/cmm/config.json. Don't edit it by hand:",
    "# use `sudo cmm add-storage <path>` and `sudo cmm remove-storage <path>`.",
    "[Service]",
    ...writablePaths.map((writablePath) => `ReadWritePaths=${formatReadWritePath(writablePath)}`),
    "",
  ].join("\n");
}

export function writeStorageDropIn(context: CliContext, storageRoots: readonly string[]): void {
  const dropInFile = context.paths.storageDropInFile;
  mkdirSync(path.dirname(dropInFile), { recursive: true, mode: 0o755 });
  writeFileSync(dropInFile, buildStorageDropIn(storageRoots), { mode: 0o644 });
  context.print(`Updated ${dropInFile}.`);
}

/**
 * Applies changed unit files and restarts CMM when it is running (`try-restart`). With
 * `shouldRestart` false (install.sh starts the service itself), or in a sandbox, it only says so.
 */
export async function reloadAndRestart(context: CliContext, shouldRestart: boolean): Promise<void> {
  if (isSandbox(context)) {
    context.print("Sandbox: skipped systemctl daemon-reload and restart.");
    return;
  }
  const reloadResult = await context.runCommand("systemctl", ["daemon-reload"]);
  if (reloadResult.isMissing) {
    context.warn("systemctl is not available; restart CMM yourself to apply the change.");
    return;
  }
  if (reloadResult.exitCode !== 0) context.warn(`systemctl daemon-reload failed: ${reloadResult.stderr.trim()}`);
  if (!shouldRestart) {
    context.print(`Restart CMM to apply the change: sudo systemctl restart ${SERVICE_NAME}`);
    return;
  }
  const restartResult = await context.runCommand("systemctl", ["try-restart", SERVICE_NAME]);
  if (restartResult.exitCode === 0) context.print("Restarted CMM (if it was running).");
  else context.warn(`Could not restart CMM: ${restartResult.stderr.trim() || "systemctl try-restart failed"}`);
}

/** `systemctl is-active cmm`: "active", "inactive", "failed", … or "unavailable" without systemd. */
export async function readServiceState(context: CliContext): Promise<string> {
  if (isSandbox(context)) return "unavailable (sandbox)";
  const result = await context.runCommand("systemctl", ["is-active", SERVICE_NAME]);
  if (result.isMissing) return "unavailable (no systemctl)";
  return result.stdout.trim() || "unknown";
}
