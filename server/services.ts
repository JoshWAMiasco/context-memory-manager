import "server-only";
import { createBackupService } from "@/server/backup";
import { createEncryptionService } from "@/server/crypto";
import { createJobService } from "@/server/jobs/job-service";
import { createProtectionService } from "@/server/protection/tamper";
import { createStorageService } from "@/server/storage/storage-service";
import { createUploadCleanupService } from "@/server/storage/upload";
import { createTrashAutoPurgeService } from "@/server/trash";
import { createVersioningService } from "@/server/versioning";

/** A long-lived task the entry starts after migrations and stops on shutdown (drive poller, job runner…). */
export interface BackgroundService {
  name: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
}

/** Every background service, in start order. */
const BACKGROUND_SERVICES: BackgroundService[] = [
  createProtectionService(),
  createEncryptionService(),
  createVersioningService(),
  createStorageService(),
  createJobService(),
  createBackupService(),
  createUploadCleanupService(),
  createTrashAutoPurgeService(),
];

const startedServices: BackgroundService[] = [];

/** Starts every registered service, in order. */
export async function startBackgroundServices(
  services: readonly BackgroundService[] = BACKGROUND_SERVICES,
): Promise<void> {
  for (const service of services) {
    await service.start();
    startedServices.push(service);
  }
}

/** Stops the started services in reverse order. A failing service is logged and does not block the others. */
export async function stopBackgroundServices(): Promise<void> {
  while (startedServices.length > 0) {
    const service = startedServices.pop();
    if (!service) continue;
    try {
      await service.stop();
    } catch (stopError) {
      console.error(`[ccm] background service "${service.name}" failed to stop`, stopError);
    }
  }
}
