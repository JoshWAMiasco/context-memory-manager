import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge } from "@/components/primitives/badge";
import { FormSectionRow } from "@/components/primitives/form-section-row";
import { SettingsPanel } from "@/components/page-sections/settings/settings-panel";
import { SettingNumberPanel } from "@/components/settings/setting-number-panel";
import { SettingSwitchPanel } from "@/components/settings/setting-switch-panel";
import { THEME_IDENTITY } from "@/configuration/theme-identity";
import packageManifest from "@/package.json";
import { requirePageSession } from "@/server/auth/page-guard";
import { getConfig } from "@/server/config";
import { getSetting } from "@/server/settings/store";

export const metadata: Metadata = { title: "General settings" };

function ReadOnlyValue({ children, testIdentifier }: { children: ReactNode; testIdentifier?: string }) {
  return (
    <div
      className="rounded-md border border-line/60 bg-surface-subtle px-3 py-2 font-mono text-xs break-all"
      data-testid={testIdentifier}
    >
      {children}
    </div>
  );
}

export default async function GeneralSettingsPage() {
  const authContext = await requirePageSession();
  const config = getConfig();
  return (
    <>
      <SettingsPanel title="Application">
        <FormSectionRow label="Name" description="Shown in the window title and the top bar." labelWidth="large">
          <ReadOnlyValue>
            {THEME_IDENTITY.themeDisplayName} ({THEME_IDENTITY.productName})
          </ReadOnlyValue>
        </FormSectionRow>
        <FormSectionRow
          label="Mode"
          description="Desktop runs inside the CMM app; server runs as a service on your network."
          labelWidth="large"
        >
          <Badge tone="primary" variant="outline" data-testid="settings-mode">
            {config.mode === "server" ? "Server" : "Desktop"}
          </Badge>
        </FormSectionRow>
        <FormSectionRow
          label="Data directory"
          description="Where CMM keeps its database. Your files stay in their storages."
          labelWidth="large"
        >
          <ReadOnlyValue testIdentifier="settings-data-dir">{config.dataDir}</ReadOnlyValue>
        </FormSectionRow>
        <FormSectionRow label="Version" labelWidth="large">
          <ReadOnlyValue>{packageManifest.version}</ReadOnlyValue>
        </FormSectionRow>
      </SettingsPanel>
      {authContext.user.role === "admin" && (
        <SettingNumberPanel
          title="Trash"
          fields={[
            {
              settingKey: "trash.autoPurgeDays",
              label: "Delete items after",
              description:
                "Items in the trash longer than this are deleted for good once a day. 0 keeps them until you delete them.",
              initialValue: getSetting("trash.autoPurgeDays"),
              minimum: 0,
              maximum: 3650,
              unit: "days (0 = never)",
            },
          ]}
        />
      )}
      {authContext.user.role === "admin" && (
        <SettingNumberPanel
          title="Viewer and editor"
          fields={[
            {
              settingKey: "editor.maxEditBytes",
              label: "Edit files up to",
              description: "Larger text files open view-only. Very large files make the editor slow.",
              initialValue: getSetting("editor.maxEditBytes"),
              minimum: 1,
              maximum: 50,
              unit: "MB",
              scale: 1024 * 1024,
            },
            {
              settingKey: "viewer.csvMaxRows",
              label: "Show CSV rows up to",
              description: "The table viewer stops reading a CSV or TSV file after this many rows.",
              initialValue: getSetting("viewer.csvMaxRows"),
              minimum: 1000,
              maximum: 1_000_000,
              unit: "rows",
            },
          ]}
        />
      )}
      {authContext.user.role === "admin" && process.platform === "darwin" && (
        <SettingSwitchPanel
          title="Strong lock (macOS)"
          settingKey="protection.macosImmutable"
          label="Also set the macOS immutable flag on locked folders"
          description="Locked folders get chflags uchg on top of read-only permissions, so even a program that changes permissions can't edit or delete their files until an admin unlocks them in CMM. Applies to folders locked from now on."
          initialValue={getSetting("protection.macosImmutable")}
        />
      )}
    </>
  );
}
