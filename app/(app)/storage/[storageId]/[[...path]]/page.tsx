import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ExplorerWorkspace } from "@/components/explorer/explorer-workspace";
import { isInsideFolder } from "@/lib/client/query-keys";
import { buildMemoryHref, buildStorageHref, CHANGES_PARAMETER, MEMORY_ROOT_PARAMETER } from "@/lib/client/routes";
import type { MemorySummary } from "@/lib/memory";
import { requirePageSession } from "@/server/auth/page-guard";
import { getConfig } from "@/server/config";
import { readMemory } from "@/server/memory";
import { findActiveStorage, listStoragesFor } from "@/server/storage/roots";

export const metadata: Metadata = { title: "Files" };

function decodeSegment(pathSegment: string): string {
  try {
    return decodeURIComponent(pathSegment);
  } catch {
    return pathSegment;
  }
}

async function readMemoryAt(storageId: string, memoryPath: string): Promise<MemorySummary | undefined> {
  const activeStorage = findActiveStorage(storageId);
  if (!activeStorage || memoryPath === "") return undefined;
  return readMemory(activeStorage, memoryPath).catch(() => undefined);
}

/**
 * A storage's explorer, or with `?memory=<folder>` that memory's own explorer, whose tree starts
 * at the memory. Storages the user can't open, or that are unplugged, are 404. A `memory` that
 * isn't a memory folder falls back to the storage's explorer, and a path outside the memory opens
 * the memory itself. `?changes=<sha>` (or `trash:<item id>`) opens the entry's "What changed"
 * history on that step.
 */
export default async function StoragePage({ params, searchParams }: PageProps<"/storage/[storageId]/[[...path]]">) {
  const { user } = await requirePageSession();
  const { storageId, path = [] } = await params;
  const storage = listStoragesFor(user).find((candidate) => candidate.id === decodeSegment(storageId));
  if (!storage?.available) notFound();
  const initialPath = path.map(decodeSegment).join("/");

  const searchParameters = await searchParams;
  const memoryParameter = searchParameters[MEMORY_ROOT_PARAMETER];
  const changesParameter = searchParameters[CHANGES_PARAMETER];
  const memoryPath = (typeof memoryParameter === "string" ? memoryParameter : "").replaceAll(/^\/+|\/+$/g, "");
  let memoryRoot: { path: string; memory: MemorySummary } | undefined;
  if (memoryParameter !== undefined) {
    const memory = await readMemoryAt(storage.id, memoryPath);
    if (!memory) redirect(buildStorageHref(storage.id, initialPath));
    if (!isInsideFolder(initialPath, memoryPath)) redirect(buildMemoryHref(storage.id, memoryPath));
    memoryRoot = { path: memoryPath, memory };
  }

  return (
    <ExplorerWorkspace
      key={`${storage.id}\u0000${memoryRoot?.path ?? ""}`}
      storage={storage}
      memoryRoot={memoryRoot}
      mode={getConfig().mode}
      userRole={user.role}
      initialPath={initialPath}
      initialChanges={typeof changesParameter === "string" ? changesParameter : undefined}
    />
  );
}
