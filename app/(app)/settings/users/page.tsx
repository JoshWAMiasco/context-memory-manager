import type { Metadata } from "next";
import { UsersPanel } from "@/components/settings/users-panel";
import { requirePageSession } from "@/server/auth/page-guard";

export const metadata: Metadata = { title: "Users" };

export default async function UsersSettingsPage() {
  const authContext = await requirePageSession({ roles: ["admin"] });
  return <UsersPanel currentUserId={authContext.user.id} />;
}
