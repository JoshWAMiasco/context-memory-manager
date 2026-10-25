import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthenticationFrame } from "@/components/page-sections/authentication/authentication-frame";
import { LockScreen } from "@/components/security/lock-screen";
import { readSafeNextPath } from "@/lib/auth/next-path";
import { getAuthContext } from "@/server/auth/guard";

export const metadata: Metadata = { title: "Locked" };

export default async function LockPage({ searchParams }: PageProps<"/lock">) {
  const nextPath = readSafeNextPath((await searchParams).next);
  const authContext = await getAuthContext();
  if (!authContext) redirect("/login");
  if (!authContext.isLocked) redirect(nextPath);

  return (
    <AuthenticationFrame title="Session locked" prompt="Enter your password to continue where you left off.">
      <LockScreen username={authContext.user.username} role={authContext.user.role} nextPath={nextPath} />
    </AuthenticationFrame>
  );
}
