import type { Metadata } from "next";
import { SettingNumberPanel } from "@/components/settings/setting-number-panel";
import { ActiveSessionsPanel, ChangePasswordPanel, StepUpActionsPanel } from "@/components/settings/security-panels";
import { requirePageSession } from "@/server/auth/page-guard";
import { getConfig } from "@/server/config";
import { getSetting } from "@/server/settings/store";

export const metadata: Metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  const authContext = await requirePageSession();
  const isAdmin = authContext.user.role === "admin";
  return (
    <>
      <ChangePasswordPanel username={authContext.user.username} />
      {isAdmin && (
        <SettingNumberPanel
          title="Auto-lock"
          fields={[
            {
              settingKey: "security.autoLockMinutes",
              label: "Lock after",
              description: "Idle sessions lock and ask for the password again. Applies to every user.",
              initialValue: getSetting("security.autoLockMinutes"),
              minimum: 1,
              maximum: 1440,
              unit: "idle minutes",
            },
          ]}
        />
      )}
      {isAdmin && (
        <SettingNumberPanel
          title="Sign-in lockout"
          intro="After too many wrong passwords from one device for one username, sign-in, unlocking and password confirmation are blocked for that device and username until the lock time passes. Other devices are not affected."
          fields={[
            {
              settingKey: "security.signInMaxAttempts",
              label: "Maximum failed attempts",
              description: "Wrong passwords allowed before the lock (3 to 20).",
              initialValue: getSetting("security.signInMaxAttempts"),
              minimum: 3,
              maximum: 20,
              unit: "attempts",
            },
            {
              settingKey: "security.signInLockoutMinutes",
              label: "Lock duration",
              description: "How long to wait before trying again (1 minute to 24 hours).",
              initialValue: getSetting("security.signInLockoutMinutes"),
              minimum: 1,
              maximum: 1440,
              unit: "minutes",
            },
          ]}
        />
      )}
      {isAdmin && getConfig().mode === "server" && (
        <StepUpActionsPanel initialActions={getSetting("security.stepUpActions")} />
      )}
      <ActiveSessionsPanel />
    </>
  );
}
