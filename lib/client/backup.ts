"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BackupMachine,
  BackupPreview,
  BackupProfile,
  BackupProfileInput,
  BackupRunSummary,
  JobSummary,
} from "@/lib/api-types";
import type { AdhocBackup } from "@/lib/backup";
import { requestJson } from "@/lib/client/api";
import { useJobs } from "@/lib/client/jobs";
import { QUERY_KEYS } from "@/lib/client/query-keys";

export const BACKUP_JOB_TYPE = "backup.run";

/** What to run or preview: a saved profile, or settings from the editor. */
export type BackupRequest = { profileId: string } | { adhoc: AdhocBackup };

/** The backup profiles this user made (admins: all), with their last run. */
export function useBackupProfiles() {
  return useQuery({
    queryKey: QUERY_KEYS.backup("profiles"),
    queryFn: ({ signal }) =>
      requestJson<{ profiles: BackupProfile[] }>("/api/backup/profiles", { signal }).then(({ profiles }) => profiles),
  });
}

/** Backup History, newest first. */
export function useBackupRuns() {
  return useQuery({
    queryKey: QUERY_KEYS.backup("runs"),
    queryFn: ({ signal }) =>
      requestJson<{ runs: BackupRunSummary[] }>("/api/backup/runs", { signal }).then(({ runs }) => runs),
  });
}

/** The computer in the middle of the topology; capacity is read again every 30 seconds. */
export function useBackupMachine() {
  return useQuery({
    queryKey: QUERY_KEYS.backup("machine"),
    queryFn: ({ signal }) => requestJson<BackupMachine>("/api/backup/machine", { signal }),
    refetchInterval: 30_000,
  });
}

/** Every backup job this user can see (newest first), kept live by server events. */
export function useBackupJobs(): JobSummary[] {
  const { data: jobs } = useJobs();
  return (jobs ?? []).filter((job) => job.type === BACKUP_JOB_TYPE);
}

/**
 * Saving, deleting, previewing and running backups. Mirror runs (and mirrors that run on their
 * own when a drive is plugged in) send the user's password.
 *
 * @example
 * const { runBackup } = useBackupMutations();
 * await runBackup.mutateAsync({ request: { profileId }, password });
 */
export function useBackupMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backup() });
  const saveProfile = useMutation({
    mutationFn: ({
      profileId,
      input,
      password,
    }: {
      profileId?: string;
      input: BackupProfileInput;
      password?: string;
    }) =>
      requestJson<{ profile: BackupProfile }>(
        profileId ? `/api/backup/profiles/${encodeURIComponent(profileId)}` : "/api/backup/profiles",
        { method: profileId ? "PATCH" : "POST", body: { ...input, password } },
      ).then(({ profile }) => profile),
    onSettled: refresh,
  });
  const deleteProfile = useMutation({
    mutationFn: (profileId: string) =>
      requestJson<{ ok: true }>(`/api/backup/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" }),
    onSettled: refresh,
  });
  const previewBackup = useMutation({
    mutationFn: (request: BackupRequest) =>
      requestJson<{ preview: BackupPreview }>("/api/backup/preview", { method: "POST", body: request }).then(
        ({ preview }) => preview,
      ),
  });
  const runBackup = useMutation({
    mutationFn: ({ request, password }: { request: BackupRequest; password?: string }) =>
      requestJson<{ job: JobSummary }>("/api/backup/run", { method: "POST", body: { ...request, password } }).then(
        ({ job }) => job,
      ),
    onSettled: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs() });
    },
  });
  return { saveProfile, deleteProfile, previewBackup, runBackup };
}
