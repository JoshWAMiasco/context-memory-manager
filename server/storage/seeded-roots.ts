import "server-only";
import { eq } from "drizzle-orm";
import type { CcmOrm } from "@/server/db/client";
import { settings } from "@/server/db/schema";

/**
 * The settings row remembering every config root that was registered once, so a root an admin
 * removed is not added back on the next start. Not an admin setting: never exposed through
 * `/api/settings`. The `ccm` CLI updates it too when it adds or removes a storage.
 */
const SEEDED_ROOTS_KEY = "internal.storageSeededRoots";

type SettingsWriter = Pick<CcmOrm, "insert">;

export function readSeededRoots(orm: Pick<CcmOrm, "select">): string[] {
  const seededRow = orm.select().from(settings).where(eq(settings.key, SEEDED_ROOTS_KEY)).get();
  return seededRow ? (JSON.parse(seededRow.valueJson) as string[]) : [];
}

export function writeSeededRoots(writer: SettingsWriter, seededRoots: Iterable<string>): void {
  const valueJson = JSON.stringify([...seededRoots]);
  writer
    .insert(settings)
    .values({ key: SEEDED_ROOTS_KEY, valueJson })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
    .run();
}
