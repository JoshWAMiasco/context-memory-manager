"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommitDetail, FileDiff, GitDetection, HistoryPage, VersioningStatus } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { QUERY_KEYS } from "@/lib/client/query-keys";

function buildQuery(fields: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) if (value !== undefined) searchParams.set(name, String(value));
  return searchParams.toString();
}

/**
 * Whether git is installed. `checkAgain()` skips the server's 60-second cache.
 *
 * @example
 * const { data: git, checkAgain } = useGitStatus();
 */
export function useGitStatus(isEnabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEYS.gitStatus(),
    queryFn: ({ signal }) => requestJson<GitDetection>("/api/versioning/git-status", { signal }),
    enabled: isEnabled,
  });
  const checkAgain = async () => {
    const detection = await requestJson<GitDetection>("/api/versioning/git-status?force=1");
    queryClient.setQueryData(QUERY_KEYS.gitStatus(), detection);
    return detection;
  };
  return { ...query, checkAgain };
}

/** The offline "How to install Git" notes. */
export function useGitInstallHelp(isEnabled: boolean) {
  return useQuery({
    queryKey: ["git-install-help"],
    queryFn: ({ signal }) => requestJson<{ markdown: string }>("/api/versioning/help", { signal }),
    enabled: isEnabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * The versioning state of a folder or file: its versioned folder, commits, undo and redo.
 *
 * @example
 * const { data: status } = useVersioningStatus(storageId, "persona");
 */
export function useVersioningStatus(storageId: string, entryPath: string, isEnabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.versioning(storageId, "status", entryPath),
    queryFn: ({ signal }) =>
      requestJson<VersioningStatus>(`/api/versioning/status?${buildQuery({ storageId, path: entryPath })}`, {
        signal,
      }),
    enabled: isEnabled,
  });
}

/** History, newest first, 50 commits a page: of the whole versioned folder or one entry in it. */
export function useVersioningLog(storageId: string, entryPath: string, isEnabled = true) {
  return useInfiniteQuery({
    queryKey: QUERY_KEYS.versioning(storageId, "log", entryPath),
    queryFn: ({ signal, pageParam }) =>
      requestJson<HistoryPage>(
        `/api/versioning/log?${buildQuery({ storageId, path: entryPath, cursor: pageParam, limit: 50 })}`,
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: isEnabled,
  });
}

/** One commit and its changed files. */
export function useCommitDetail(storageId: string, scopePath: string, sha: string | undefined) {
  return useQuery({
    queryKey: QUERY_KEYS.versioning(storageId, "commit", scopePath, sha ?? ""),
    queryFn: ({ signal }) =>
      requestJson<CommitDetail>(
        `/api/versioning/commit/${encodeURIComponent(sha ?? "")}?${buildQuery({ storageId, path: scopePath })}`,
        { signal },
      ),
    enabled: sha !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** A file before and after a commit; decrypted in memory on the server for encrypted folders. */
export function useFileDiff(
  storageId: string,
  file: { path: string; oldPath?: string } | undefined,
  sha: string | undefined,
) {
  return useQuery({
    queryKey: QUERY_KEYS.versioning(storageId, "diff", sha ?? "", file?.path ?? "", file?.oldPath ?? ""),
    queryFn: ({ signal }) =>
      requestJson<FileDiff>(
        `/api/versioning/diff?${buildQuery({ storageId, path: file?.path, sha, oldPath: file?.oldPath })}`,
        { signal },
      ),
    enabled: file !== undefined && sha !== undefined,
    retry: false,
  });
}

interface EntryInput {
  storageId: string;
  path: string;
}

/**
 * Every versioning action. Each refreshes the storage's versioning queries and listings
 * (an undo or restore rewrites files).
 *
 * @example
 * const { undo } = useVersioningMutations();
 * await undo.mutateAsync({ storageId, path: "persona/notes.md" });
 */
export function useVersioningMutations() {
  const queryClient = useQueryClient();
  const refresh = (storageId: string) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.versioning(storageId) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storageDirectories(storageId) });
    void queryClient.invalidateQueries({ queryKey: ["fs", "stat", storageId] });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderState(storageId) });
  };
  return {
    refresh,
    enable: useMutation({
      mutationFn: (input: EntryInput & { adopt?: boolean; restoreArchive?: string }) =>
        requestJson<{ enabled: true; scopePath: string } | { needsAdoptConfirm: true }>("/api/versioning/enable", {
          method: "POST",
          body: input,
        }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
    disable: useMutation({
      mutationFn: (input: EntryInput & { mode: "archive" | "delete"; confirmText?: string }) =>
        requestJson<{ archive?: string }>("/api/versioning/disable", { method: "POST", body: input }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
    snapshot: useMutation({
      mutationFn: (input: EntryInput & { message: string }) =>
        requestJson<{ sha?: string }>("/api/versioning/snapshot", { method: "POST", body: input }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
    undo: useMutation({
      mutationFn: (input: EntryInput) =>
        requestJson<{ sha: string; message: string }>("/api/versioning/undo", { method: "POST", body: input }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
    redo: useMutation({
      mutationFn: (input: EntryInput) =>
        requestJson<{ sha: string; message: string }>("/api/versioning/redo", { method: "POST", body: input }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
    restoreFile: useMutation({
      mutationFn: (input: EntryInput & { sha: string }) =>
        requestJson<{ sha?: string; path: string }>("/api/versioning/restore-file", { method: "POST", body: input }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
    restoreFolder: useMutation({
      mutationFn: (input: EntryInput & { sha: string }) =>
        requestJson<{ sha?: string }>("/api/versioning/restore-folder", { method: "POST", body: input }),
      onSettled: (_result, _error, input) => refresh(input.storageId),
    }),
  };
}
