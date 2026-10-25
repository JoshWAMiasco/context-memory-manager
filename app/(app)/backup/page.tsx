import type { Metadata } from "next";
import { BackupWorkspace } from "@/components/backup/backup-workspace";
import { requirePageSession } from "@/server/auth/page-guard";

export const metadata: Metadata = { title: "Backup" };

/** Backups between this computer and drives, or between two drives. */
export default async function BackupPage() {
  await requirePageSession();
  return <BackupWorkspace />;
}
