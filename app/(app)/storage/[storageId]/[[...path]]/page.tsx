import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExplorerWorkspace } from "@/components/explorer/explorer-workspace";
import { requirePageSession } from "@/server/auth/page-guard";
import { getConfig } from "@/server/config";
import { listStoragesFor } from "@/server/storage/roots";

export const metadata: Metadata = { title: "Files" };

function decodeSegment(pathSegment: string): string {
  try {
    return decodeURIComponent(pathSegment);
  } catch {
    return pathSegment;
  }
}

/** A storage's explorer. Storages the user can't open, or that are unplugged, are 404. */
export default async function StoragePage({ params }: PageProps<"/storage/[storageId]/[[...path]]">) {
  const { user } = await requirePageSession();
  const { storageId, path = [] } = await params;
  const storage = listStoragesFor(user).find((candidate) => candidate.id === decodeSegment(storageId));
  if (!storage?.available) notFound();
  return (
    <ExplorerWorkspace
      key={storage.id}
      storage={storage}
      mode={getConfig().mode}
      userRole={user.role}
      initialPath={path.map(decodeSegment).join("/")}
    />
  );
}
