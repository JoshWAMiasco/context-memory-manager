import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/server/db/client";
import { storages } from "@/server/db/schema";
import { getEventBus } from "@/server/events/bus";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { readTestOverride } from "@/server/runtime/test-hooks";
import { FakeDriveProvider } from "@/server/storage/drives/fake-provider";
import type { Drive, DriveProvider } from "@/server/storage/drives/provider";
import { SystemDriveProvider } from "@/server/storage/drives/system-provider";

export const DRIVE_POLL_MILLISECONDS = 2000;

/** A capacity change smaller than this is not worth a `drive.updated` event. */
const CAPACITY_CHANGE_BYTES = 1024 * 1024;

export interface DriveChanges {
  added: Drive[];
  removed: Drive[];
  updated: Drive[];
}

/** The storage id of a drive: `ext-<volume id>`, with anything unusual in the id replaced. */
export function toDriveStorageId(driveId: string): string {
  return `ext-${driveId.replaceAll(/[^\w-]/g, "_")}`;
}

/** Compares two drive lists by id: plugged in, unplugged, and changed (mount, label or capacity). */
export function diffDrives(previousDrives: ReadonlyMap<string, Drive>, nextDrives: readonly Drive[]): DriveChanges {
  const changes: DriveChanges = { added: [], removed: [], updated: [] };
  const nextIds = new Set<string>();
  for (const nextDrive of nextDrives) {
    nextIds.add(nextDrive.id);
    const previousDrive = previousDrives.get(nextDrive.id);
    if (!previousDrive) {
      changes.added.push(nextDrive);
      continue;
    }
    if (
      previousDrive.mountPath !== nextDrive.mountPath ||
      previousDrive.label !== nextDrive.label ||
      previousDrive.size !== nextDrive.size ||
      Math.abs(previousDrive.used - nextDrive.used) >= CAPACITY_CHANGE_BYTES
    ) {
      changes.updated.push(nextDrive);
    }
  }
  for (const [previousId, previousDrive] of previousDrives) {
    if (!nextIds.has(previousId)) changes.removed.push(previousDrive);
  }
  return changes;
}

/**
 * Saves a drive in `storages` (keyed by its volume id), so its label and per-user access survive
 * unplugging. A label the admin changed is kept. Returns the label to show.
 */
export function rememberDrive(drive: Drive): string {
  const { orm } = getDatabase();
  const storageId = toDriveStorageId(drive.id);
  const knownStorage = orm.select().from(storages).where(eq(storages.id, storageId)).get();
  const kind = drive.removable || /usb/i.test(drive.protocol) ? "usb" : "external";
  if (knownStorage) {
    orm
      .update(storages)
      .set({ rootPath: drive.mountPath ?? knownStorage.rootPath, kind })
      .where(eq(storages.id, storageId))
      .run();
    return knownStorage.label;
  }
  orm
    .insert(storages)
    .values({ id: storageId, kind, label: drive.label, rootPath: drive.mountPath ?? "", volumeUuid: drive.id })
    .run();
  return drive.label;
}

/**
 * Polls the drive provider and turns differences into `drive.added`, `drive.removed` and
 * `drive.updated` events. The current list is what storage listings use for external
 * drives, so an unplugged drive disappears from the Drives page on the next poll.
 */
export class DriveMonitor {
  private drives = new Map<string, Drive>();
  private pollTimer?: NodeJS.Timeout;
  private isPolling = false;

  constructor(private readonly provider: DriveProvider) {}

  listDrives(): Drive[] {
    return [...this.drives.values()];
  }

  findDriveByStorageId(storageId: string): Drive | undefined {
    return this.listDrives().find((drive) => toDriveStorageId(drive.id) === storageId);
  }

  /** Reads the drives once and applies the changes. Overlapping calls return no changes. */
  async poll(): Promise<DriveChanges> {
    if (this.isPolling) return { added: [], removed: [], updated: [] };
    this.isPolling = true;
    try {
      const nextDrives = await this.provider.list();
      const changes = diffDrives(this.drives, nextDrives);
      this.drives = new Map(nextDrives.map((drive) => [drive.id, drive]));
      const eventBus = getEventBus();
      for (const removedDrive of changes.removed) {
        eventBus.emit("drive.removed", {
          storageId: toDriveStorageId(removedDrive.id),
          label: removedDrive.label,
          available: false,
        });
      }
      for (const [eventName, changedDrives] of [
        ["drive.added", changes.added],
        ["drive.updated", changes.updated],
      ] as const) {
        for (const changedDrive of changedDrives) {
          const label = rememberDrive(changedDrive);
          eventBus.emit(eventName, {
            storageId: toDriveStorageId(changedDrive.id),
            label,
            available: changedDrive.mountPath !== null,
          });
        }
      }
      return changes;
    } finally {
      this.isPolling = false;
    }
  }

  start(intervalMilliseconds = DRIVE_POLL_MILLISECONDS): void {
    if (this.pollTimer) return;
    const pollSafely = () => {
      this.poll().catch((pollError: unknown) => console.error("[ccm] drive poll failed", pollError));
    };
    pollSafely();
    this.pollTimer = setInterval(pollSafely, intervalMilliseconds);
    this.pollTimer.unref();
  }

  stop(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
}

/** The fake provider when `CCM_TEST_FAKE_DRIVES_FILE` is set (test hooks only), else the real one. */
export function createDriveProvider(): DriveProvider {
  const fakeDrivesFile = readTestOverride("CCM_TEST_FAKE_DRIVES_FILE");
  return fakeDrivesFile ? new FakeDriveProvider(fakeDrivesFile) : new SystemDriveProvider();
}

export function getDriveMonitor(): DriveMonitor {
  return getGlobalSingleton(
    "drive-monitor",
    () => new DriveMonitor(createDriveProvider()),
    (storedValue) => typeof (storedValue as DriveMonitor | undefined)?.findDriveByStorageId === "function",
  );
}
