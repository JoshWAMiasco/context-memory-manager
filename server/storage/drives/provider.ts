import "server-only";

/** A drive (volume) the machine can see: plugged-in USB sticks, external disks, SD cards. */
export interface Drive {
  /** Stable across plug-ins: the volume UUID, else the serial number, else the device. */
  id: string;
  label: string;
  /** Where it is mounted, or null when it is plugged in but not mounted. */
  mountPath: string | null;
  fsType: string;
  size: number;
  used: number;
  removable: boolean;
  protocol: string;
  /** The OS device: `/dev/sdb1`, `/dev/disk4s1`, or `E:`. */
  device: string;
  /** Mounted read-only: nothing can be written to it (an NTFS drive on macOS, a locked SD card…). */
  readOnly: boolean;
}

export interface DriveProvider {
  list(): Promise<Drive[]>;
}
