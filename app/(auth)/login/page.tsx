import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthenticationFrame } from "@/components/page-sections/authentication/authentication-frame";
import { LoginPanel } from "@/components/security/login-panel";
import { readSafeNextPath } from "@/lib/auth/next-path";
import packageManifest from "@/package.json";
import { getAuthContext } from "@/server/auth/guard";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const nextPath = readSafeNextPath((await searchParams).next);
  const authContext = await getAuthContext();
  if (authContext?.isLocked) redirect(`/lock?next=${encodeURIComponent(nextPath)}`);
  if (authContext && !authContext.user.mustChangePassword) redirect(nextPath);

  const pendingPasswordChangeUsername = authContext?.user.mustChangePassword ? authContext.user.username : undefined;
  return (
    <AuthenticationFrame
      title={pendingPasswordChangeUsername ? "Choose a password" : "Sign In"}
      prompt={pendingPasswordChangeUsername ? undefined : "Sign in with the account your CMM admin gave you."}
      version={packageManifest.version}
    >
      <LoginPanel nextPath={nextPath} pendingPasswordChangeUsername={pendingPasswordChangeUsername} />
    </AuthenticationFrame>
  );
}
