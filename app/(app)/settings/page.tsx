import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/page-guard";

export default async function SettingsIndexPage() {
  await requirePageSession();
  redirect("/settings/general");
}
