"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { ArrowRight, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { BackupModeBadge } from "@/components/backup/backup-mode-badge";
import { BrainIcon } from "@/components/icons/cmm-icons";
import { MirrorPasswordDialog } from "@/components/backup/mirror-password-dialog";
import { RunStatusBadge } from "@/components/backup/run-history";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { Button } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import { EmptyState } from "@/components/primitives/empty-state";
import type { BackupProfile, JobSummary } from "@/lib/api-types";
import { useBackupMutations } from "@/lib/client/backup";
import { isActiveJob } from "@/lib/client/jobs";

dayjs.extend(relativeTime);

function Endpoint({ endpoint, description }: { endpoint: BackupProfile["source"]; description?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={endpoint.available ? undefined : "Not connected"}>
      <span
        className={`h-2 w-2 flex-none rounded-full ${endpoint.available ? "bg-success" : "bg-foreground-faint"}`}
        aria-hidden
      />
      <span className="truncate">
        {description ?? (endpoint.path === "" ? endpoint.label : `${endpoint.label} / ${endpoint.path}`)}
      </span>
    </span>
  );
}

/** A memory backup's source: "Home / notes", or "Home: 3 folders". */
function describeMemorySources(profile: BackupProfile): string | undefined {
  const paths = profile.memory?.paths;
  if (!paths) return undefined;
  if (paths.length === 1) return paths[0] ? `${profile.source.label} / ${paths[0]}` : profile.source.label;
  return `${profile.source.label}: ${paths.length} folders`;
}

/**
 * The Profiles tab: a card per saved backup with its source → destination, mode, last
 * run and Run, Edit and Delete. A mirror asks for the password before it runs.
 *
 * @example
 * <ProfilesList profiles={profiles} jobs={backupJobs} onCreate={openEditor} onEdit={openEditor} />
 */
export function ProfilesList({
  profiles,
  jobs,
  onCreate,
  onEdit,
  onStarted,
}: {
  profiles: BackupProfile[];
  jobs: JobSummary[];
  onCreate: () => void;
  onEdit: (profile: BackupProfile) => void;
  onStarted: () => void;
}) {
  const { runBackup, deleteProfile } = useBackupMutations();
  const [mirrorTarget, setMirrorTarget] = useState<BackupProfile>();
  const [deleteTarget, setDeleteTarget] = useState<BackupProfile>();
  const [runError, setRunError] = useState<{ profileId: string; message: string }>();

  const run = async (profile: BackupProfile, password?: string) => {
    setRunError(undefined);
    await runBackup.mutateAsync({ request: { profileId: profile.id }, password });
    onStarted();
  };

  if (profiles.length === 0) {
    return (
      <EmptyState
        className="py-10"
        icon={<Zap className="h-10 w-10 stroke-[1]" />}
        title="No backup profiles yet"
        description="A profile remembers what to back up, where to, and how. It can run on its own when its drive is plugged in."
        action={
          <Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={onCreate}>
            New profile
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button variant="primary" size="small" leadingIcon={<Plus className="h-4 w-4" />} onClick={onCreate}>
          New profile
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2" data-testid="backup-profiles">
        {profiles.map((profile) => {
          const isRunning = jobs.some((job) => isActiveJob(job) && job.transfer?.profileId === profile.id);
          const canRun = profile.source.available && profile.destination.available && !isRunning;
          return (
            <Card
              key={profile.id}
              className="grid grid-cols-1 gap-3 p-4"
              data-testid="backup-profile-card"
              data-profile-id={profile.id}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    {profile.memory && <BrainIcon className="h-4 w-4 flex-none text-accent" />}
                    <span className="truncate">{profile.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-foreground-muted">
                    <Endpoint endpoint={profile.source} description={describeMemorySources(profile)} />
                    <ArrowRight className="h-3.5 w-3.5 flex-none" aria-hidden />
                    <Endpoint endpoint={profile.destination} />
                  </div>
                  {profile.memory && profile.memory.paths.length > 1 && (
                    <div
                      className="mt-1 truncate text-xs text-foreground-subtle"
                      title={profile.memory.paths.join("\n")}
                    >
                      {profile.memory.paths.map((memoryPath) => memoryPath || profile.source.label).join(", ")}
                    </div>
                  )}
                </div>
                <BackupModeBadge mode={profile.mode} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-subtle">
                {profile.lastRun ? (
                  <>
                    <RunStatusBadge status={profile.lastRun.status} />
                    <span>Last run {dayjs(profile.lastRun.startedAt).fromNow()}</span>
                    <span>
                      {profile.lastRun.filesCopied.toLocaleString()} copied ·{" "}
                      {profile.lastRun.filesSkipped.toLocaleString()} unchanged
                    </span>
                  </>
                ) : (
                  <span>Never run</span>
                )}
                {profile.autoRunOnConnect && <span>Runs when the drive is plugged in</span>}
              </div>
              {runError?.profileId === profile.id && (
                <p className="text-sm text-danger" role="alert">
                  {runError.message}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="small"
                  variant="secondary"
                  leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setDeleteTarget(profile)}
                >
                  Delete
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  leadingIcon={<Pencil className="h-3.5 w-3.5" />}
                  onClick={() => onEdit(profile)}
                >
                  Edit
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  leadingIcon={<Play className="h-3.5 w-3.5" />}
                  disabled={!canRun || runBackup.isPending}
                  title={isRunning ? "Already running" : canRun ? undefined : "Connect both drives to run this backup"}
                  onClick={() => {
                    if (profile.mode === "mirror") {
                      setMirrorTarget(profile);
                      return;
                    }
                    run(profile).catch((error: unknown) =>
                      setRunError({
                        profileId: profile.id,
                        message: error instanceof Error ? error.message : "It didn't start.",
                      }),
                    );
                  }}
                >
                  {isRunning ? "Running…" : "Run"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      {mirrorTarget && (
        <MirrorPasswordDialog
          name={mirrorTarget.name}
          onConfirm={(password) => run(mirrorTarget, password)}
          onClose={() => setMirrorTarget(undefined)}
        />
      )}
      <ConfirmDialog
        isOpen={deleteTarget !== undefined}
        onOpenChange={(isOpen) => !isOpen && setDeleteTarget(undefined)}
        title={`Delete "${deleteTarget?.name ?? "profile"}"?`}
        confirmLabel="Delete profile"
        confirmVariant="danger"
        testId="delete-profile-dialog"
        onConfirm={async () => {
          if (deleteTarget) await deleteProfile.mutateAsync(deleteTarget.id);
        }}
      >
        The profile is removed. Backups it already made, and their History, stay.
      </ConfirmDialog>
    </div>
  );
}
