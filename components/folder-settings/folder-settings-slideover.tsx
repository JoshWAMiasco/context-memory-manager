"use client";

import { GitBranch, KeyRound, Settings2, Shield } from "lucide-react";
import { ModalBody } from "@/components/interactive/modal";
import { Slideover } from "@/components/interactive/slideover";
import { Tab, TabList, TabPanel, TabPanels, Tabs } from "@/components/interactive/tabs";
import type { FolderSettingsTab } from "@/components/explorer/explorer-context";
import { GeneralTab } from "@/components/folder-settings/general-tab";
import { EncryptionTab } from "@/components/folder-settings/encryption-tab";
import { ProtectionTab } from "@/components/folder-settings/protection-tab";
import { VersioningTab } from "@/components/folder-settings/versioning-tab";
import { readBaseName } from "@/lib/client/query-keys";

const TABS: FolderSettingsTab[] = ["general", "protection", "encryption", "versioning"];

/**
 * Folder settings: General (memory fields, convert, location), Protection, Encryption
 * and Versioning. Opens from the context menu, the folder
 * overview, or Cmd/Ctrl+, with a folder selected.
 *
 * @example
 * <FolderSettingsSlideover path="persona" initialTab="protection" onClose={close} />
 */
export function FolderSettingsSlideover({
  path: folderPath,
  initialTab = "general",
  onClose,
}: {
  path: string;
  initialTab?: FolderSettingsTab;
  onClose: () => void;
}) {
  return (
    <Slideover
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={`Folder settings: ${readBaseName(folderPath)}`}
      size="large"
    >
      <ModalBody className="flex-1 overflow-y-auto">
        <div data-testid="folder-settings">
          <Tabs variant="underline" defaultSelectedIndex={Math.max(0, TABS.indexOf(initialTab))}>
            <TabList>
              <Tab icon={<Settings2 className="mr-2 h-4 w-4" />}>General</Tab>
              <Tab icon={<Shield className="mr-2 h-4 w-4" />}>Protection</Tab>
              <Tab icon={<KeyRound className="mr-2 h-4 w-4" />}>Encryption</Tab>
              <Tab icon={<GitBranch className="mr-2 h-4 w-4" />}>Versioning</Tab>
            </TabList>
            <TabPanels className="mt-5">
              <TabPanel>
                <GeneralTab path={folderPath} />
              </TabPanel>
              <TabPanel>
                <ProtectionTab path={folderPath} />
              </TabPanel>
              <TabPanel>
                <EncryptionTab path={folderPath} />
              </TabPanel>
              <TabPanel>
                <VersioningTab path={folderPath} />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </div>
      </ModalBody>
    </Slideover>
  );
}
