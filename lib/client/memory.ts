"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FileEntry, JobSummary, ProtectionState } from "@/lib/api-types";
import type {
  MemoryColor,
  MemoryIcon,
  MemoryListing,
  MemoryStats,
  MemorySummary,
  MemoryTemplateSummary,
} from "@/lib/memory";
import type { ProtectionMode } from "@/lib/protection";
import { requestJson } from "@/lib/client/api";
import { QUERY_KEYS, readParentPath } from "@/lib/client/query-keys";

function buildQuery(storageId: string, entryPath: string): string {
  return new URLSearchParams({ storageId, path: entryPath }).toString();
}

export interface MemoryFieldsInput {
  name: string;
  description?: string;
  icon?: MemoryIcon;
  color?: MemoryColor;
}

/**
 * A folder's memory settings (`null` for a plain folder).
 *
 * @example
 * const { data: memory } = useMemory(storageId, "persona");
 */
export function useMemory(storageId: string, folderPath: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.folderState(storageId, folderPath), "memory"],
    queryFn: async ({ signal }) =>
      (
        await requestJson<{ memory: MemorySummary | null }>(`/api/memory?${buildQuery(storageId, folderPath)}`, {
          signal,
        })
      ).memory,
  });
}

/**
 * File count, size, notes and recent files of a folder (refreshed when anything inside changes).
 *
 * @example
 * const { data: stats } = useFolderStats(storageId, "persona");
 */
export function useFolderStats(storageId: string, folderPath: string) {
  return useQuery({
    queryKey: [...QUERY_KEYS.folderState(storageId, folderPath), "stats"],
    queryFn: ({ signal }) =>
      requestJson<MemoryStats>(`/api/memory/stats?${buildQuery(storageId, folderPath)}`, { signal }),
  });
}

/**
 * The protection of a folder or file, for the Folder settings panel.
 *
 * @example
 * const { data: protection } = useProtection(storageId, "persona");
 */
export function useProtection(storageId: string, entryPath: string, isEnabled = true) {
  return useQuery({
    queryKey: [...QUERY_KEYS.folderState(storageId, entryPath), "protection"],
    queryFn: ({ signal }) =>
      requestJson<ProtectionState>(`/api/protection?${buildQuery(storageId, entryPath)}`, { signal }),
    enabled: isEnabled,
  });
}

/**
 * The memory folders on the internal storages the user can open, for the dashboard (fetched again
 * each time it mounts).
 *
 * @example
 * const { data } = useMemories(); // data.memories: [{ storageId, storageLabel, path, memory }]
 */
export function useMemories() {
  return useQuery({
    queryKey: QUERY_KEYS.memories(),
    queryFn: ({ signal }) => requestJson<MemoryListing>("/api/memory/list", { signal }),
    // Folders are moved, renamed and deleted elsewhere: check again on every visit.
    staleTime: 0,
  });
}

/** The memory templates (they never change while CMM runs). */
export function useMemoryTemplates() {
  return useQuery({
    queryKey: QUERY_KEYS.memoryTemplates(),
    queryFn: async () => (await requestJson<{ templates: MemoryTemplateSummary[] }>("/api/memory/templates")).templates,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Creating, converting and updating memories, changing protection and dismissing tamper alerts.
 * Each refreshes the affected listings and folder state.
 *
 * @example
 * const { createMemory } = useMemoryMutations();
 * await createMemory.mutateAsync({ storageId, parentPath: "", name: "Persona", template: "llm-persona" });
 */
export function useMemoryMutations() {
  const queryClient = useQueryClient();
  const refresh = (storageId: string, entryPath: string) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(storageId, readParentPath(entryPath)) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stat(storageId, entryPath) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderState(storageId) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.memories() });
  };
  const createMemory = useMutation({
    mutationFn: (
      input: MemoryFieldsInput & { storageId: string; parentPath: string; folderName?: string; template?: string },
    ) => requestJson<{ entry: FileEntry; memory: MemorySummary }>("/api/memory", { method: "POST", body: input }),
    onSuccess: (result, input) => {
      refresh(input.storageId, result.entry.path);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.directory(input.storageId, result.entry.path) });
    },
  });
  const convertMemory = useMutation({
    mutationFn: (
      input: { storageId: string; path: string } & (({ to: "memory" } & MemoryFieldsInput) | { to: "folder" }),
    ) => requestJson<{ memory: MemorySummary | null }>("/api/memory/convert", { method: "POST", body: input }),
    onSuccess: (_result, input) => {
      if (input.to === "folder") {
        // Leaves the dashboard's list at once, without waiting for the listing to be fetched again.
        queryClient.setQueryData<MemoryListing>(
          QUERY_KEYS.memories(),
          (listing) =>
            listing && {
              ...listing,
              memories: listing.memories.filter(
                (location) => !(location.storageId === input.storageId && location.path === input.path),
              ),
            },
        );
      }
      refresh(input.storageId, input.path);
    },
  });
  const updateMemory = useMutation({
    mutationFn: (input: Partial<MemoryFieldsInput> & { storageId: string; path: string }) =>
      requestJson<{ memory: MemorySummary }>("/api/memory", { method: "PATCH", body: input }),
    onSuccess: (_result, input) => refresh(input.storageId, input.path),
  });
  const setProtection = useMutation({
    mutationFn: (input: { storageId: string; path: string; mode: ProtectionMode; password?: string }) =>
      requestJson<{ mode: ProtectionMode; job?: JobSummary }>("/api/protection", { method: "PUT", body: input }),
    onSuccess: (_result, input) => refresh(input.storageId, input.path),
  });
  const dismissAlert = useMutation({
    mutationFn: (input: { storageId: string; path: string }) =>
      requestJson<{ ok: true }>("/api/protection/alert", { method: "DELETE", body: input }),
    onSuccess: (_result, input) => refresh(input.storageId, input.path),
  });
  return { createMemory, convertMemory, updateMemory, setProtection, dismissAlert };
}
