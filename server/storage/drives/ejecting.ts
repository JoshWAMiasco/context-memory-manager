import "server-only";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

function getEjectingStorages(): Set<string> {
  return getGlobalSingleton("ejecting-storages", () => new Set<string>());
}

/**
 * Marks a drive's storage as being ejected, or not any more. While it is, nothing may start
 * watching it: an open watcher holds its files open, and the system then refuses to eject.
 */
export function markStorageEjecting(storageId: string, isEjecting: boolean): void {
  if (isEjecting) getEjectingStorages().add(storageId);
  else getEjectingStorages().delete(storageId);
}

/** Whether a drive's storage is being ejected right now (watchers leave it alone). */
export function isStorageEjecting(storageId: string): boolean {
  return getEjectingStorages().has(storageId);
}
