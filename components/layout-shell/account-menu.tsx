"use client";

import { KeyRound, Lock, Power, Settings } from "lucide-react";
import { useLockAllEncryptedFolders } from "@/components/encryption/unlocked-folders-button";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { ThemeSwitch } from "@/components/layout-shell/theme-switch";
import { requestJson } from "@/lib/client/api";
import { useEncryptedFolders } from "@/lib/client/encryption";
import {
  beginLeavingPage,
  navigateWithFullReload,
  postSessionMessage,
  readCurrentPagePath,
} from "@/lib/client/session-channel";

export interface AccountMenuAccount {
  fullName: string;
  roleLabel: string;
}

function readInitials(fullName: string): string {
  const nameParts = fullName
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  return nameParts
    .slice(0, 2)
    .map((namePart) => namePart[0]?.toUpperCase() ?? "")
    .join("");
}

async function lockNow() {
  const nextPath = readCurrentPagePath();
  beginLeavingPage();
  await requestJson("/api/auth/lock", { method: "POST", handleSessionErrors: false }).catch(() => undefined);
  postSessionMessage({ type: "locked" });
  navigateWithFullReload(`/lock?next=${encodeURIComponent(nextPath)}`);
}

async function signOut() {
  beginLeavingPage();
  await requestJson("/api/auth/logout", { method: "POST", handleSessionErrors: false }).catch(() => undefined);
  postSessionMessage({ type: "signed-out" });
  navigateWithFullReload("/login");
}

/**
 * The avatar menu at the right of the top bar: the signed-in username and role, the theme (Dark,
 * Light or System), Settings, Lock now,
 * "Lock all encrypted folders" while any is unlocked, and Sign out. `avatarClassName` styles the round avatar button, which shows the initials.
 *
 * @example
 * <AccountMenu currentAccount={{ fullName: "alice", roleLabel: "Admin" }} />
 */
export function AccountMenu({
  currentAccount,
  avatarClassName = "image-fit h-[36px] w-[36px] overflow-hidden rounded-full border-[3px] border-line/70",
}: {
  currentAccount: AccountMenuAccount;
  avatarClassName?: string;
}) {
  const { data: encryptedFolders } = useEncryptedFolders();
  const lockAllEncryptedFolders = useLockAllEncryptedFolders();
  const unlockedCount = (encryptedFolders ?? []).filter((folder) => folder.unlocked).length;
  return (
    <DropdownMenu
      className="ml-5"
      menuClassName="mt-1 w-64"
      triggerClassName={avatarClassName}
      triggerLabel={`Account menu for ${currentAccount.fullName}`}
      trigger={
        <span
          data-testid="account-menu"
          className="flex h-full w-full items-center justify-center bg-brand/15 font-display text-xs font-semibold text-brand"
        >
          {readInitials(currentAccount.fullName)}
        </span>
      }
    >
      <div className="px-2 py-1.5">
        <div className="font-medium">{currentAccount.fullName}</div>
        <div className="mt-0.5 text-xs text-foreground-muted">{currentAccount.roleLabel}</div>
      </div>
      <div className="px-2 pt-1 pb-2">
        <div className="mb-1.5 text-xs text-foreground-subtle">Theme</div>
        <ThemeSwitch />
      </div>
      <DropdownMenuDivider className="-mx-2" />
      <DropdownMenuItem href="/settings/security" icon={<Settings className="mr-2 h-4 w-4 stroke-[1]" />}>
        Settings
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void lockNow()} icon={<Lock className="mr-2 h-4 w-4 stroke-[1]" />}>
        Lock now
      </DropdownMenuItem>
      {unlockedCount > 0 && (
        <DropdownMenuItem onSelect={lockAllEncryptedFolders} icon={<KeyRound className="mr-2 h-4 w-4 stroke-[1]" />}>
          Lock all encrypted folders ({unlockedCount})
        </DropdownMenuItem>
      )}
      <DropdownMenuDivider className="-mx-2" />
      <DropdownMenuItem onSelect={() => void signOut()} icon={<Power className="mr-2 h-4 w-4 stroke-[1]" />}>
        Sign out
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
