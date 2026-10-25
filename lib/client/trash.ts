"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TrashListResponse } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { QUERY_KEYS } from "@/lib/client/query-keys";

/**
 * Every trash item the user can see, newest first, with the total size (Drives page, Trash page).
 *
 * @example
 * const { data: trash } = useTrash();
 */
export function useTrash() {
  return useQuery({
    queryKey: QUERY_KEYS.trash(),
    queryFn: ({ signal }) => requestJson<TrashListResponse>("/api/trash", { signal }),
  });
}

/**
 * Restore, delete permanently, move to the computer's trash, and empty. Permanent deletes ask for
 * the `delete-permanent` step-up through the shared modal.
 *
 * @example
 * const { restoreItems } = useTrashActions();
 * await restoreItems.mutateAsync([item.id]);
 */
export function useTrashActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trash() }),
      queryClient.invalidateQueries({ queryKey: ["fs"] }),
    ]);
  const runBulk = (action: "restore" | "purge" | "os-trash", itemIds: string[]) =>
    itemIds.length === 1
      ? requestJson(`/api/trash/${encodeURIComponent(itemIds[0] ?? "")}/${action}`, { method: "POST" })
      : requestJson("/api/trash/bulk", { method: "POST", body: { action, itemIds } });
  const restoreItems = useMutation({
    mutationFn: (itemIds: string[]) => runBulk("restore", itemIds),
    onSettled: refresh,
  });
  const purgeItems = useMutation({ mutationFn: (itemIds: string[]) => runBulk("purge", itemIds), onSettled: refresh });
  const moveToComputerTrash = useMutation({
    mutationFn: (itemIds: string[]) => runBulk("os-trash", itemIds),
    onSettled: refresh,
  });
  const emptyTrash = useMutation({
    mutationFn: ({ storageId, confirmText }: { storageId: string; confirmText: string }) =>
      requestJson<{ removed: number }>("/api/trash", { method: "DELETE", body: { storageId, confirmText } }),
    onSettled: refresh,
  });
  return { restoreItems, purgeItems, moveToComputerTrash, emptyTrash };
}
