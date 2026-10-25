import type { Metadata } from "next";
import { StoragesSection } from "@/components/settings/storages-section";
import { requirePageSession } from "@/server/auth/page-guard";
import { getConfig } from "@/server/config";
import { getSetting } from "@/server/settings/store";

export const metadata: Metadata = { title: "Storages" };

export default async function StoragesSettingsPage() {
  await requirePageSession({ roles: ["admin"] });
  return <StoragesSection mode={getConfig().mode} newDrivesVisibleTo={getSetting("storage.newDrivesVisibleTo")} />;
}
