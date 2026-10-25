import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ToastViewport } from "@/components/interactive/toast-notification";
import { AuthenticationFrame } from "@/components/page-sections/authentication/authentication-frame";
import { SetupWizard } from "@/components/security/setup-wizard";
import { isSetupComplete, needsSetupCode } from "@/server/auth/setup";
import { getConfig } from "@/server/config";

export const metadata: Metadata = { title: "Set up" };

export default function SetupPage() {
  if (isSetupComplete()) redirect("/login");
  return (
    <>
      <AuthenticationFrame title="Set up CMM" prompt="First run: create the admin account.">
        <SetupWizard mode={getConfig().mode} needsSetupCode={needsSetupCode()} />
      </AuthenticationFrame>
      <ToastViewport />
    </>
  );
}
