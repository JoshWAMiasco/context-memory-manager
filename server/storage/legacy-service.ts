import "server-only";
import type { BackgroundService } from "@/server/services";
import { ensureLegacyNamesMigrated } from "@/server/storage/legacy-migration";
import { ensureSeededStorages, listActiveStorages } from "@/server/storage/roots";

/**
 * Starts first: moves every internal storage from CCM's folder names to CMM's (once each) before
 * the encryption, protection and versioning services read them. Drives are migrated by the drive
 * monitor when they appear.
 */
export function createLegacyNamesService(): BackgroundService {
  return {
    name: "legacy-names",
    start: async () => {
      ensureSeededStorages();
      for (const storage of listActiveStorages()) await ensureLegacyNamesMigrated(storage.rootPath);
    },
    stop: () => undefined,
  };
}
