import type { Metadata } from "next";
import { TrashTable } from "@/components/trash/trash-table";
import { requirePageSession } from "@/server/auth/page-guard";
import { getConfig } from "@/server/config";
import { getSetting } from "@/server/settings/store";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  await requirePageSession();
  return <TrashTable mode={getConfig().mode} autoPurgeDays={getSetting("trash.autoPurgeDays")} />;
}
