import type { Metadata } from "next";
import { BackupWorkspace } from "@/components/backup/backup-workspace";
import { parseMemoryBackupSearch } from "@/lib/client/routes";
import { requirePageSession } from "@/server/auth/page-guard";

export const metadata: Metadata = { title: "Backup" };

/**
 * Backups between this computer and drives, or between two drives. With `?storage=…&folder=…`
 * (from the explorer or Folder settings) it opens the editor on a new memory backup of those folders.
 */
export default async function BackupPage({ searchParams }: PageProps<"/backup">) {
  await requirePageSession();
  return <BackupWorkspace memorySources={parseMemoryBackupSearch(await searchParams)} />;
}
