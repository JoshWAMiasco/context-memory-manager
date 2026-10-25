import "server-only";
import { statfs } from "node:fs/promises";
import path from "node:path";
import systemInformation from "systeminformation";
import type { FileSystemSizeInfo } from "@/server/storage/drives/system-provider";
import type { ActiveStorage } from "@/server/storage/roots";

/** `fsSize()` runs `df`; its answer is reused this long. */
const FILE_SYSTEM_CACHE_MILLISECONDS = 30_000;

let cachedFileSystems: { readAt: number; fileSystems: FileSystemSizeInfo[] } | undefined;

async function listFileSystems(): Promise<FileSystemSizeInfo[]> {
  if (cachedFileSystems && Date.now() - cachedFileSystems.readAt < FILE_SYSTEM_CACHE_MILLISECONDS) {
    return cachedFileSystems.fileSystems;
  }
  const fileSystems = (await systemInformation.fsSize().catch(() => [])) as FileSystemSizeInfo[];
  cachedFileSystems = { readAt: Date.now(), fileSystems };
  return fileSystems;
}

/** The mount that holds `absolutePath`: the longest mount path it starts with. */
export function findMount<Mount extends { mount: string }>(
  mounts: readonly Mount[],
  absolutePath: string,
): Mount | undefined {
  const comparablePath = process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
  let best: Mount | undefined;
  for (const mount of mounts) {
    if (!mount.mount) continue;
    const mountPath = process.platform === "win32" ? mount.mount.toLowerCase() : mount.mount;
    const withSeparator = mountPath.endsWith(path.sep) ? mountPath : `${mountPath}${path.sep}`;
    if (comparablePath !== mountPath && !comparablePath.startsWith(withSeparator)) continue;
    if (!best || mount.mount.length > best.mount.length) best = mount;
  }
  return best;
}

export interface VolumeInfo {
  /** "exfat", "vfat", "apfs", "ext4"…, or "unknown". */
  fsType: string;
  freeBytes: number;
}

/**
 * The file system type and free space where a backup writes: the type comes from the
 * drive (external storages) or `systeminformation.fsSize()` (internal ones), free space from
 * `statfs`.
 *
 * @example
 * const { fsType, freeBytes } = await readVolumeInfo(storage, "/Volumes/USB/Backups");
 */
export async function readVolumeInfo(storage: ActiveStorage, absolutePath: string): Promise<VolumeInfo> {
  const fileSystem = await statfs(absolutePath);
  const freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
  const driveType = storage.drive?.fsType;
  if (driveType) return { fsType: driveType.toLowerCase(), freeBytes };
  const mount = findMount(await listFileSystems(), absolutePath);
  return { fsType: mount?.type ? mount.type.toLowerCase() : "unknown", freeBytes };
}
