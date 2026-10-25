"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { BackupJobPanel } from "@/components/backup/job-panel";
import { ProfileEditor, type ProfileEditorSeed } from "@/components/backup/profile-editor";
import { ProfilesList } from "@/components/backup/profiles-list";
import { RunDetailsModal, RunHistory } from "@/components/backup/run-history";
import { TopologyStage, type TopologyNodeId } from "@/components/backup/topology-stage";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { Tab, TabList, TabPanel, TabPanels, Tabs } from "@/components/interactive/tabs";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { Button } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import type { BackupRunSummary, StorageSummary } from "@/lib/api-types";
import { useBackupJobs, useBackupMachine, useBackupProfiles, useBackupRuns } from "@/lib/client/backup";
import { useDriveActions, useStorages } from "@/lib/client/fs";
import { isActiveJob } from "@/lib/client/jobs";

const TAB_ACTIVE = 0;
const TAB_HISTORY = 2;

/**
 * The Backup page: the live topology across the top, and below it the Active jobs,
 * Profiles and History tabs. Dragging between nodes or using a drive's menu opens the profile
 * editor with the endpoints filled in.
 *
 * @example
 * <BackupWorkspace />
 */
export function BackupWorkspace() {
  const { data: storages = [] } = useStorages();
  const { data: machine } = useBackupMachine();
  const { data: profiles = [] } = useBackupProfiles();
  const { data: runs = [] } = useBackupRuns();
  const jobs = useBackupJobs();
  const { ejectDrive, mountDrive } = useDriveActions();
  const [tabIndex, setTabIndex] = useState(TAB_ACTIVE);
  const [editorSeed, setEditorSeed] = useState<ProfileEditorSeed>();
  const [ejectTarget, setEjectTarget] = useState<StorageSummary>();
  const [detailsRun, setDetailsRun] = useState<BackupRunSummary>();
  const activeCount = jobs.filter(isActiveJob).length;

  const firstInternalId = storages.find((storage) => storage.kind === "internal" && storage.available)?.id;
  const toStorageId = (nodeId: TopologyNodeId) =>
    nodeId === "machine" ? firstInternalId : nodeId.slice("drive:".length);

  const openEditor = (seed: ProfileEditorSeed) => setEditorSeed(seed);

  return (
    <div className="flex flex-col gap-5" data-testid="backup-page">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="font-display text-xl font-medium">Backup</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Copy folders from this computer to a drive, or from one drive to another. Drag from one node to another to
            plan a backup.
          </p>
        </div>
        <Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openEditor({})}>
          New profile
        </Button>
      </div>

      <Card className="h-[55vh] min-h-[320px] overflow-hidden p-2">
        <TopologyStage
          storages={storages}
          machine={machine}
          jobs={jobs}
          profiles={profiles}
          onConnect={(source, destination) =>
            openEditor({
              source: { storageId: toStorageId(source) },
              destination: { storageId: toStorageId(destination) },
            })
          }
          onBackUpToDrive={(storageId) =>
            openEditor({ source: { storageId: firstInternalId }, destination: { storageId } })
          }
          onBackUpFromDrive={(storageId) => openEditor({ source: { storageId }, destination: { storageId: "" } })}
          onEject={setEjectTarget}
          onMount={(storage) => mountDrive.mutate(storage.id)}
          onSelectJob={(jobId) => {
            setTabIndex(TAB_HISTORY);
            const run = runs.find((candidate) => candidate.jobId === jobId);
            if (run) setDetailsRun(run);
          }}
        />
      </Card>

      <Tabs variant="underline" selectedIndex={tabIndex} onSelectedIndexChange={setTabIndex}>
        <TabList>
          <Tab>Active jobs{activeCount > 0 ? ` (${activeCount})` : ""}</Tab>
          <Tab>Profiles{profiles.length > 0 ? ` (${profiles.length})` : ""}</Tab>
          <Tab>History</Tab>
        </TabList>
        <TabPanels className="pt-4">
          <TabPanel>
            <BackupJobPanel jobs={jobs} storages={storages} />
          </TabPanel>
          <TabPanel>
            <ProfilesList
              profiles={profiles}
              jobs={jobs}
              onCreate={() => openEditor({})}
              onEdit={(profile) => openEditor({ profile })}
              onStarted={() => setTabIndex(TAB_ACTIVE)}
            />
          </TabPanel>
          <TabPanel>
            <RunHistory runs={runs} onShowDetails={setDetailsRun} />
          </TabPanel>
        </TabPanels>
      </Tabs>

      {editorSeed && (
        <ProfileEditor
          seed={editorSeed}
          storages={storages}
          onClose={() => setEditorSeed(undefined)}
          onStarted={() => setTabIndex(TAB_ACTIVE)}
        />
      )}
      {detailsRun && <RunDetailsModal run={detailsRun} onClose={() => setDetailsRun(undefined)} />}
      <ConfirmDialog
        isOpen={ejectTarget !== undefined}
        onOpenChange={(isOpen) => !isOpen && setEjectTarget(undefined)}
        title={`Eject ${ejectTarget?.label ?? "drive"}?`}
        confirmLabel="Eject"
        testId="backup-eject-dialog"
        onConfirm={async () => {
          if (!ejectTarget) return;
          await ejectDrive.mutateAsync(ejectTarget.id);
          showToastNotification({
            title: `${ejectTarget.label} ejected`,
            description: "You can unplug it now.",
            tone: "success",
          });
        }}
      >
        Files open from this drive close. Wait for the confirmation before you unplug it.
      </ConfirmDialog>
    </div>
  );
}
