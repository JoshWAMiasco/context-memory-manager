import type { Metadata } from "next";
import { DrivesDashboard } from "@/components/shell/drives-dashboard";
import packageManifest from "@/package.json";
import { requirePageSession } from "@/server/auth/page-guard";

export const metadata: Metadata = { title: "Drives" };

/** The home page after sign-in: every storage the user can open, as cards. */
export default async function HomePage() {
  const { user } = await requirePageSession();
  return <DrivesDashboard isAdmin={user.role === "admin"} version={packageManifest.version} />;
}
