import "server-only";
import { readFile, stat, statfs } from "node:fs/promises";
import { z } from "zod";
import type { Drive, DriveProvider } from "@/server/storage/drives/provider";

const fakeDrivesSchema = z.array(
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    dir: z.string().min(1).nullable(),
    /** The file system to report ("vfat" to try FAT32 limits); "fake" when left out. */
    fsType: z.string().min(1).optional(),
  }),
);

/**
 * Test drives from the JSON file named by `CMM_TEST_FAKE_DRIVES_FILE`: a list of
 * `{ id, label, dir, fsType? }`, where `dir` is the folder that stands in for the mount point (null for a
 * drive that is plugged in but not mounted). The file is re-read when its modification time
 * changes; a missing file means no drives.
 */
export class FakeDriveProvider implements DriveProvider {
  private cached?: { mtimeMs: number; drives: Drive[] };

  constructor(private readonly drivesFilePath: string) {}

  async list(): Promise<Drive[]> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(this.drivesFilePath)).mtimeMs;
    } catch {
      this.cached = undefined;
      return [];
    }
    if (this.cached?.mtimeMs !== mtimeMs) {
      const drivesText = await readFile(this.drivesFilePath, "utf8");
      let parsedDrives: ReturnType<typeof fakeDrivesSchema.safeParse>;
      try {
        parsedDrives = fakeDrivesSchema.safeParse(JSON.parse(drivesText));
      } catch {
        return this.cached?.drives ?? [];
      }
      if (!parsedDrives.success) return this.cached?.drives ?? [];
      const drives = await Promise.all(
        parsedDrives.data.map(async (fakeDrive): Promise<Drive> => {
          const fileSystem = fakeDrive.dir ? await statfs(fakeDrive.dir).catch(() => undefined) : undefined;
          const size = fileSystem ? fileSystem.blocks * fileSystem.bsize : 0;
          return {
            id: fakeDrive.id,
            label: fakeDrive.label,
            mountPath: fakeDrive.dir,
            fsType: fakeDrive.fsType ?? "fake",
            size,
            used: fileSystem ? size - fileSystem.bfree * fileSystem.bsize : 0,
            removable: true,
            protocol: "usb",
            device: `fake:${fakeDrive.id}`,
          };
        }),
      );
      this.cached = { mtimeMs, drives };
    }
    return this.cached.drives;
  }
}
