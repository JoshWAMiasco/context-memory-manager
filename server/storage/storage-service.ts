import "server-only";
import type { DriveEvent } from "@/server/events/bus";
import { getEventBus } from "@/server/events/bus";
import type { BackgroundService } from "@/server/services";
import { getDriveMonitor } from "@/server/storage/drives/monitor";
import { ensureSeededStorages, findActiveStorage, listActiveStorages } from "@/server/storage/roots";
import { closeAllWatchers, closeStorageWatchers } from "@/server/storage/watcher";
import { reconcileTrash } from "@/server/trash";

function reconcileSafely(storageId: string): void {
  const activeStorage = findActiveStorage(storageId);
  if (!activeStorage?.available) return;
  reconcileTrash(activeStorage).catch((reconcileError: unknown) =>
    console.error(`[cmm] trash reconcile failed for ${storageId}`, reconcileError),
  );
}

/**
 * Storages at startup and while running: seeds the default roots, repairs half-finished trash
 * moves, starts the drive monitor, repairs the trash of each drive that is plugged in, and closes
 * the watchers of a drive that is removed.
 */
export function createStorageService(): BackgroundService {
  const handleDriveAdded = (driveEvent: DriveEvent) => reconcileSafely(driveEvent.storageId);
  const handleDriveRemoved = (driveEvent: DriveEvent) => {
    closeStorageWatchers(driveEvent.storageId).catch((closeError: unknown) =>
      console.error(`[cmm] closing watchers of ${driveEvent.storageId} failed`, closeError),
    );
  };
  return {
    name: "storages",
    start: () => {
      ensureSeededStorages();
      for (const activeStorage of listActiveStorages()) reconcileSafely(activeStorage.id);
      const eventBus = getEventBus();
      eventBus.on("drive.added", handleDriveAdded);
      eventBus.on("drive.removed", handleDriveRemoved);
      getDriveMonitor().start();
    },
    stop: async () => {
      getDriveMonitor().stop();
      const eventBus = getEventBus();
      eventBus.off("drive.added", handleDriveAdded);
      eventBus.off("drive.removed", handleDriveRemoved);
      await closeAllWatchers();
    },
  };
}
