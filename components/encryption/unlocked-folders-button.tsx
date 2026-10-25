"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { FolderOpen, KeyRound, Lock } from "lucide-react";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { useEncryptedFolders, useEncryptionMutations } from "@/lib/client/encryption";
import { buildStorageHref } from "@/lib/client/routes";

dayjs.extend(relativeTime);

/**
 * Locks every encrypted folder of this session, with a toast.
 *
 * @example
 * const lockAll = useLockAllEncryptedFolders();
 * <DropdownMenuItem onSelect={lockAll}>Lock all encrypted folders</DropdownMenuItem>
 */
export function useLockAllEncryptedFolders(): () => void {
  const { lockAll } = useEncryptionMutations();
  return () =>
    lockAll.mutate(undefined, {
      onSuccess: () =>
        showToastNotification({
          title: "Encrypted folders locked",
          description: "Their keys were wiped from memory.",
          tone: "success",
        }),
      onError: (lockError) =>
        showToastNotification({ title: "Couldn't lock", description: lockError.message, tone: "error" }),
    });
}

/**
 * The key icon in the top bar: how many encrypted folders this session has unlocked, a
 * menu listing them with the time left, and "Lock all encrypted folders". Hidden while none is
 * unlocked.
 *
 * @example
 * <UnlockedFoldersButton className="…" />
 */
export function UnlockedFoldersButton({ className }: { className?: string }) {
  const { data: folders } = useEncryptedFolders();
  const lockAll = useLockAllEncryptedFolders();
  const unlockedFolders = (folders ?? []).filter((folder) => folder.unlocked);
  if (unlockedFolders.length === 0) return null;
  return (
    <DropdownMenu
      className={className}
      menuClassName="mt-1 w-80"
      triggerClassName="relative flex h-9 w-9 items-center justify-center rounded-full text-success hover:bg-surface-muted"
      triggerLabel={`${unlockedFolders.length} encrypted folder${unlockedFolders.length === 1 ? "" : "s"} unlocked`}
      trigger={
        <span data-testid="unlocked-folders-button">
          <KeyRound className="h-[18px] w-[18px] stroke-[1.5]" />
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-success px-1 text-[10px] font-semibold text-on-primary"
            data-testid="unlocked-folders-count"
          >
            {unlockedFolders.length}
          </span>
        </span>
      }
    >
      <div className="px-2 py-1.5 text-xs text-foreground-muted">Unlocked for this session</div>
      {unlockedFolders.map((folder) => (
        <DropdownMenuItem
          key={`${folder.storageId}:${folder.path}`}
          href={buildStorageHref(folder.storageId, folder.path)}
          icon={<FolderOpen className="mr-2 h-4 w-4 flex-none stroke-[1]" />}
        >
          <span className="min-w-0 flex-1 truncate">{folder.folderName}</span>
          {folder.expiresAt && (
            <span className="ml-2 text-xs whitespace-nowrap text-foreground-subtle">
              locks {dayjs(folder.expiresAt).fromNow()}
            </span>
          )}
        </DropdownMenuItem>
      ))}
      <DropdownMenuDivider className="-mx-2" />
      <DropdownMenuItem onSelect={lockAll} icon={<Lock className="mr-2 h-4 w-4 stroke-[1]" />}>
        Lock all encrypted folders
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
