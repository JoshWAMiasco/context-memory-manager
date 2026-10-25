import "server-only";
import systemInformation from "systeminformation";
import type { Drive, DriveProvider } from "@/server/storage/drives/provider";

/** The `systeminformation.blockDevices()` fields CMM reads. */
export interface BlockDeviceInfo {
  name: string;
  identifier?: string;
  type: string;
  fsType: string;
  mount: string;
  size: number | string;
  uuid?: string;
  label?: string;
  model?: string;
  serial?: string;
  removable: boolean;
  protocol?: string;
  device?: string;
}

/** The `systeminformation.fsSize()` fields CMM reads. */
export interface FileSystemSizeInfo {
  fs: string;
  type: string;
  size: number;
  used: number;
  mount: string;
  /** False for a read-only mount, null when the OS doesn't say (Windows). */
  rw?: boolean | null;
}

const BLOCK_DEVICE_REFRESH_MILLISECONDS = 30_000;

const EXTERNAL_PROTOCOL_PATTERN = /usb|thunderbolt|firewire|sd|mmc/i;
const SYSTEM_LABEL_PATTERN = /^(recovery|efi|system reserved|preboot|vm|update|boot|esp|msr)$/i;
const SKIPPED_FS_TYPES = new Set(["swap", "linux_raid_member", "lvm2_member", "crypto_luks", "squashfs", "iso9660"]);

function isSystemMountPath(platform: NodeJS.Platform, mountPath: string): boolean {
  if (mountPath === "/" || mountPath.startsWith("/boot")) return true;
  if (platform === "darwin") {
    return (
      mountPath.startsWith("/System/Volumes/") ||
      mountPath.startsWith("/private/var/") ||
      mountPath.startsWith("/Volumes/com.apple.") ||
      mountPath === "/Volumes/Recovery"
    );
  }
  if (platform === "linux") {
    return ["/usr", "/var", "/home", "/opt", "/srv", "/snap", "/tmp", "/proc", "/sys", "/dev", "/run"].some(
      (systemPath) => mountPath === systemPath || (mountPath.startsWith(`${systemPath}/`) && systemPath !== "/run"),
    );
  }
  return false;
}

/** Where removable media appear on each OS. */
function isRemovableMediaPath(platform: NodeJS.Platform, mountPath: string): boolean {
  if (platform === "darwin") return mountPath.startsWith("/Volumes/");
  if (platform === "linux") return /^\/(media|run\/media|mnt)\//.test(mountPath);
  return false;
}

/** The Linux whole-disk device of a partition: sdb1 → sdb, nvme0n1p2 → nvme0n1, mmcblk0p1 → mmcblk0. */
export function readParentDiskName(partitionName: string): string {
  const numberedMatch = /^(.*\d)p\d+$/.exec(partitionName);
  if (numberedMatch?.[1]) return numberedMatch[1];
  return partitionName.replace(/\d+$/, "");
}

function readDeviceName(platform: NodeJS.Platform, blockDevice: BlockDeviceInfo): string {
  if (platform === "win32") return blockDevice.mount || blockDevice.name;
  if (platform === "linux") return blockDevice.name.startsWith("/dev/") ? blockDevice.name : `/dev/${blockDevice.name}`;
  return blockDevice.name.startsWith("/dev/") ? blockDevice.name : `/dev/${blockDevice.identifier ?? blockDevice.name}`;
}

/** The physical disk a partition belongs to: /dev/disk4s1 → /dev/disk4, /dev/sdb1 → /dev/sdb. Windows drive letters stand alone. */
export function readPhysicalDiskName(platform: NodeJS.Platform, deviceName: string): string {
  if (platform === "win32") return deviceName;
  if (platform === "darwin") return deviceName.replace(/s\d+$/, "");
  const baseName = deviceName.replace(/^\/dev\//, "");
  return `/dev/${readParentDiskName(baseName)}`;
}

/** Unmounted partitions smaller than this are boot or helper partitions, not storage. */
export const MINIMUM_UNMOUNTED_PARTITION_BYTES = 32 * 1024 * 1024;

function formatCapacity(sizeBytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = sizeBytes;
  let unitIndex = 0;
  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }
  return `${Number(size.toFixed(size >= 10 ? 0 : 1))} ${units[unitIndex]}`;
}

interface DriveCandidate {
  drive: Drive;
  physicalDisk: string;
}

/**
 * Picks the drives CMM offers as external storages from what `systeminformation` reports
 *. Kept in one pure function so each OS is covered by recorded fixtures.
 *
 * - A volume counts when it is removable, on a USB/Thunderbolt/SD bus, or mounted where the OS
 *   puts removable media. System volumes (`/`, `/boot*`, `/System/Volumes/*`, recovery, EFI, the
 *   Windows system drive) never count.
 * - One physical drive is one entry: when any partition of a disk is mounted, only its mounted
 *   partitions are listed. Otherwise the largest unmounted partition is listed, so Linux can offer
 *   "Mount". Unmounted partitions under 32 MB (boot and helper partitions) are ignored.
 * - A volume without a label is named after the drive model and size ("UDisk 4 GB"), never the
 *   device path.
 * - A volume mounted read-only (macOS mounts NTFS that way) is `readOnly`.
 */
export function classifyDrives(
  platform: NodeJS.Platform,
  blockDevices: readonly BlockDeviceInfo[],
  fileSystemSizes: readonly FileSystemSizeInfo[],
  windowsSystemDrive = "C:",
): Drive[] {
  const sizesByMountPath = new Map(fileSystemSizes.map((fileSystemSize) => [fileSystemSize.mount, fileSystemSize]));
  const disksByName = new Map(
    blockDevices
      .filter((blockDevice) => blockDevice.type === "disk" || blockDevice.type === "virtual")
      .map((blockDevice) => [readDeviceName(platform, blockDevice), blockDevice]),
  );
  const candidates: DriveCandidate[] = [];
  for (const blockDevice of blockDevices) {
    const fsType = (blockDevice.fsType ?? "").toLowerCase();
    if (fsType === "" || SKIPPED_FS_TYPES.has(fsType)) continue;
    if (platform !== "win32" && blockDevice.type !== "part" && blockDevice.type !== "disk") continue;
    const label = (blockDevice.label ?? "").trim();
    if (SYSTEM_LABEL_PATTERN.test(label)) continue;
    const protocol = blockDevice.protocol ?? "";
    if (/disk image/i.test(protocol)) continue;

    const mountPath = blockDevice.mount ? blockDevice.mount : null;
    let isExternal: boolean;
    if (platform === "win32") {
      if (!mountPath || mountPath.toUpperCase() === windowsSystemDrive.toUpperCase()) continue;
      isExternal = true;
    } else {
      if (mountPath && isSystemMountPath(platform, mountPath)) continue;
      const isRemovable = blockDevice.removable || EXTERNAL_PROTOCOL_PATTERN.test(protocol);
      isExternal = mountPath ? isRemovable || isRemovableMediaPath(platform, mountPath) : isRemovable;
    }
    if (!isExternal) continue;
    const partitionSize = Number(blockDevice.size) || 0;
    if (!mountPath && partitionSize < MINIMUM_UNMOUNTED_PARTITION_BYTES) continue;

    const device = readDeviceName(platform, blockDevice);
    const physicalDisk = readPhysicalDiskName(platform, device);
    const fileSystemSize = mountPath ? sizesByMountPath.get(mountPath) : undefined;
    const size = fileSystemSize?.size ?? partitionSize;
    const model = (disksByName.get(physicalDisk)?.model ?? "").trim();
    const mountName = mountPath ? (mountPath.split(/[/\\]/).findLast(Boolean) ?? mountPath) : "";
    const fallbackLabel = `${model || (blockDevice.removable ? "USB drive" : "External drive")}${size > 0 ? ` ${formatCapacity(size)}` : ""}`;
    candidates.push({
      physicalDisk,
      drive: {
        id: (blockDevice.uuid || blockDevice.serial || device).trim(),
        label: label || (platform === "darwin" || platform === "linux" ? mountName : "") || fallbackLabel,
        mountPath: platform === "win32" && mountPath ? `${mountPath}\\` : mountPath,
        fsType,
        size,
        used: fileSystemSize?.used ?? 0,
        removable: blockDevice.removable,
        protocol,
        device,
        readOnly: fileSystemSize?.rw === false,
      },
    });
  }

  const drivesById = new Map<string, Drive>();
  const physicalDisks = new Set(candidates.map((candidate) => candidate.physicalDisk));
  for (const physicalDisk of physicalDisks) {
    const diskCandidates = candidates.filter((candidate) => candidate.physicalDisk === physicalDisk);
    const mountedCandidates = diskCandidates.filter((candidate) => candidate.drive.mountPath !== null);
    const chosenCandidates =
      mountedCandidates.length > 0
        ? mountedCandidates
        : diskCandidates.toSorted((first, second) => second.drive.size - first.drive.size).slice(0, 1);
    for (const candidate of chosenCandidates) drivesById.set(candidate.drive.id, candidate.drive);
  }
  return [...drivesById.values()];
}

/**
 * Lists drives through `systeminformation`. `fsSize()` is cheap (one `df`) and runs on every poll;
 * `blockDevices()` is slow (about a second on macOS, more on Windows), so it is re-read only when
 * the set of mounts changes, or every 30 seconds to notice drives that are plugged in but not
 * mounted.
 */
export class SystemDriveProvider implements DriveProvider {
  private cachedBlockDevices?: { devices: BlockDeviceInfo[]; readAt: number; mountKey: string };

  async list(): Promise<Drive[]> {
    const fileSystemSizes = (await systemInformation.fsSize()) as FileSystemSizeInfo[];
    const mountKey = fileSystemSizes
      .map((fileSystemSize) => fileSystemSize.mount)
      .toSorted()
      .join("|");
    const now = Date.now();
    if (
      !this.cachedBlockDevices ||
      this.cachedBlockDevices.mountKey !== mountKey ||
      now - this.cachedBlockDevices.readAt > BLOCK_DEVICE_REFRESH_MILLISECONDS
    ) {
      this.cachedBlockDevices = {
        devices: (await systemInformation.blockDevices()) as BlockDeviceInfo[],
        readAt: now,
        mountKey,
      };
    }
    return classifyDrives(
      process.platform,
      this.cachedBlockDevices.devices,
      fileSystemSizes,
      process.env.SystemDrive ?? "C:",
    );
  }
}
