import { ApplicationShell } from "@/components/layout-shell/application-shell";
import { SessionProviders } from "@/components/security/session-providers";
import { UploadQueuePanel } from "@/components/explorer/upload-queue";
import { ROLE_LABELS } from "@/lib/auth/policy";
import { requirePageSession } from "@/server/auth/page-guard";
import { getAutoLockSeconds } from "@/server/settings/store";

/** Every signed-in page: requires an unlocked session without a pending password change. */
export default async function SignedInLayout({ children }: LayoutProps<"/">) {
  const { user } = await requirePageSession();
  return (
    <SessionProviders autoLockSeconds={getAutoLockSeconds()}>
      <ApplicationShell currentAccount={{ fullName: user.username, roleLabel: ROLE_LABELS[user.role] }}>
        {children}
      </ApplicationShell>
      <UploadQueuePanel />
    </SessionProviders>
  );
}
