import "server-only";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ApiRouteError } from "@/server/http/api-error";
import { getJobQueue } from "@/server/jobs/queue";
import type { Drive } from "@/server/storage/drives/provider";
import { readParentDiskName } from "@/server/storage/drives/system-provider";
import { closeStorageWatchers } from "@/server/storage/watcher";

const runFile = promisify(execFile);

export const DRIVE_COMMAND_TIMEOUT_MILLISECONDS = 30_000;

export interface DriveCommand {
  file: string;
  args: string[];
}

function driveCommandFailed(message: string): ApiRouteError {
  return new ApiRouteError(409, "DRIVE_COMMAND_FAILED", message);
}

/** The commands that eject `drive` on `platform`, run in order. Never through a shell. */
export function buildEjectCommands(platform: NodeJS.Platform, drive: Drive): DriveCommand[] {
  if (!drive.mountPath) throw driveCommandFailed("This drive is not mounted.");
  if (platform === "darwin") return [{ file: "diskutil", args: ["eject", drive.mountPath] }];
  if (platform === "linux") {
    const diskName = readParentDiskName(path.basename(drive.device));
    return [
      { file: "udisksctl", args: ["unmount", "--no-user-interaction", "-b", drive.device] },
      { file: "udisksctl", args: ["power-off", "--no-user-interaction", "-b", `/dev/${diskName}`] },
    ];
  }
  if (platform === "win32") {
    const driveLetter = drive.mountPath.replaceAll("\\", "").toUpperCase();
    if (!/^[A-Z]:$/.test(driveLetter)) throw driveCommandFailed("This drive has no drive letter.");
    return [
      {
        file: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${driveLetter}').InvokeVerb('Eject')`,
        ],
      },
    ];
  }
  throw driveCommandFailed("Ejecting drives is not supported on this system.");
}

/** The command that mounts an unmounted drive: Linux with udisks2 only. */
export function buildMountCommand(platform: NodeJS.Platform, drive: Drive): DriveCommand {
  if (drive.mountPath) throw driveCommandFailed("This drive is already mounted.");
  if (platform !== "linux") throw driveCommandFailed("Mounting drives from CCM is only supported on Linux.");
  return { file: "udisksctl", args: ["mount", "--no-user-interaction", "-b", drive.device] };
}

async function runDriveCommands(commands: readonly DriveCommand[]): Promise<void> {
  for (const command of commands) {
    try {
      await runFile(command.file, command.args, { timeout: DRIVE_COMMAND_TIMEOUT_MILLISECONDS, windowsHide: true });
    } catch (commandError) {
      const errorCode = (commandError as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") throw driveCommandFailed(`${command.file} is not installed on this machine.`);
      const commandOutput = (commandError as { stderr?: string }).stderr?.trim();
      throw driveCommandFailed(
        commandOutput ? `The system refused: ${commandOutput}` : "The system refused the command.",
      );
    }
  }
}

/** Ejects a drive, refusing with `DRIVE_BUSY` while a job uses it. Its watchers close first. */
export async function ejectDrive(drive: Drive, storageId: string): Promise<void> {
  if (getJobQueue().isVolumeBusy(storageId)) {
    throw new ApiRouteError(409, "DRIVE_BUSY", "A copy or move is still using this drive. Wait for it or cancel it.");
  }
  const commands = buildEjectCommands(process.platform, drive);
  await closeStorageWatchers(storageId);
  await runDriveCommands(commands);
}

/** Mounts a drive with udisks2, when it is installed. */
export async function mountDrive(drive: Drive): Promise<void> {
  const command = buildMountCommand(process.platform, drive);
  const hasUdisks = await Promise.any(
    ["/usr/bin/udisksctl", "/bin/udisksctl", "/usr/local/bin/udisksctl"].map((candidatePath) => access(candidatePath)),
  ).then(
    () => true,
    () => false,
  );
  if (!hasUdisks)
    throw driveCommandFailed("udisks2 is not installed, so CCM can't mount drives. See the server guide.");
  await runDriveCommands([command]);
}
