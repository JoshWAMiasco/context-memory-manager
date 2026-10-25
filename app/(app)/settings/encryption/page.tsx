import type { Metadata } from "next";
import { EncryptedFoldersTable } from "@/components/encryption/encrypted-folders-table";
import { SettingsPanel } from "@/components/page-sections/settings/settings-panel";
import { SettingNumberPanel } from "@/components/settings/setting-number-panel";
import { requirePageSession } from "@/server/auth/page-guard";
import { getSetting } from "@/server/settings/store";

export const metadata: Metadata = { title: "Encryption" };

/** Settings → Encryption: every encrypted folder, Lock all, and the unlock time (admins). */
export default async function EncryptionSettingsPage() {
  const authContext = await requirePageSession();
  return (
    <>
      <SettingsPanel title="Encrypted folders">
        <EncryptedFoldersTable />
      </SettingsPanel>
      {authContext.user.role === "admin" && (
        <SettingNumberPanel
          title="Unlock time"
          fields={[
            {
              settingKey: "encryption.unlockTtlMinutes",
              label: "Keep unlocked for",
              description:
                "How long an unlocked encrypted folder stays open before its key is wiped from memory. Never longer than the session; locking the session or signing out locks every folder at once.",
              initialValue: getSetting("encryption.unlockTtlMinutes"),
              minimum: 1,
              maximum: 1440,
              unit: "minutes",
            },
          ]}
        />
      )}
      <SettingsPanel title="How encryption works">
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground-muted">
          <li>Each encrypted folder has its own key, kept only in its .ccmkey key file. CCM never stores it.</li>
          <li>
            Files are always encrypted on disk (AES-256-GCM). Unlocking holds the key in memory for this session only.
          </li>
          <li>Losing the key file means losing the data. Keep it on a separate USB drive or in a password manager.</li>
          <li>
            Not encrypted: file and folder names, the folder structure, rough file sizes and the memory&rsquo;s name.
          </li>
        </ul>
      </SettingsPanel>
    </>
  );
}
