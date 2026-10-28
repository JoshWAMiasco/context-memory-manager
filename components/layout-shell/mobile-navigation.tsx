"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArchiveRestore,
  ServerCog,
  Expand,
  KeyRound,
  LayoutGrid,
  Lock,
  Menu,
  Power,
  Search,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { useLockAllEncryptedFolders } from "@/components/encryption/unlocked-folders-button";
import { Slideover } from "@/components/interactive/slideover";
import { lockNow, readInitials, signOut, type AccountMenuAccount } from "@/components/layout-shell/account-menu";
import { ThemeSwitch } from "@/components/layout-shell/theme-switch";
import { openQuickSearch } from "@/components/shell/quick-search";
import { useIsTyping } from "@/hooks/use-is-typing";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useEncryptedFolders } from "@/lib/client/encryption";
import { mergeClassNames } from "@/utilities/merge-class-names";

const drawerListeners = new Set<() => void>();
let isDrawerOpen = false;

function setDrawerOpen(isOpen: boolean): void {
  if (isDrawerOpen === isOpen) return;
  isDrawerOpen = isOpen;
  for (const listener of drawerListeners) listener();
}

function useIsDrawerOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      drawerListeners.add(listener);
      return () => drawerListeners.delete(listener);
    },
    () => isDrawerOpen,
    () => false,
  );
}

const PAGE_LINKS: { href: string; title: string; icon: LucideIcon }[] = [
  { href: "/", title: "Drives", icon: LayoutGrid },
  { href: "/backup", title: "Backup", icon: ArchiveRestore },
  { href: "/trash", title: "Trash", icon: Trash2 },
  // After the bottom bar's links (it shows the first three), so Jobs is in the drawer only.
  { href: "/jobs", title: "Jobs", icon: ServerCog },
  { href: "/settings", title: "Settings", icon: Settings },
];

function isActiveLink(currentPathname: string, linkHref: string): boolean {
  if (linkHref === "/") return currentPathname === "/" || currentPathname.startsWith("/storage/");
  return currentPathname === linkHref || currentPathname.startsWith(`${linkHref}/`);
}

/**
 * The avatar in the top bar on phones: opens the menu drawer instead of the account dropdown.
 *
 * @example
 * <MobileAccountButton currentAccount={account} className="md:hidden …" />
 */
export function MobileAccountButton({
  currentAccount,
  className,
}: {
  currentAccount: AccountMenuAccount;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Menu for ${currentAccount.fullName}`}
      onClick={() => setDrawerOpen(true)}
      className={className}
      data-testid="mobile-account-button"
    >
      <span className="flex h-full w-full items-center justify-center bg-brand/15 font-display text-xs font-semibold text-brand">
        {readInitials(currentAccount.fullName)}
      </span>
    </button>
  );
}

function DrawerItem({
  icon: ItemIcon,
  href,
  onSelect,
  isActive = false,
  testId,
  children,
}: {
  icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
  isActive?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const className = mergeClassNames(
    "flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-muted",
    isActive && "bg-brand/10 text-brand",
  );
  const content = (
    <>
      <ItemIcon className="h-[18px] w-[18px] flex-none stroke-[1.3]" />
      {children}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={className}
        aria-current={isActive ? "page" : undefined}
        onClick={() => setDrawerOpen(false)}
        data-testid={testId}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      onClick={() => {
        setDrawerOpen(false);
        onSelect?.();
      }}
    >
      {content}
    </button>
  );
}

/**
 * The menu drawer on phones, from the right: who is signed in, the theme, the pages, full screen,
 * Lock now, "Lock all encrypted folders" while any is unlocked, Sign out and the version. It holds
 * what the top bar has on wider screens, which doesn't fit on a phone.
 *
 * @example
 * <MobileMenuDrawer currentAccount={account} applicationVersion="1.1.4" />
 */
export function MobileMenuDrawer({
  currentAccount,
  applicationVersion,
}: {
  currentAccount: AccountMenuAccount;
  applicationVersion?: string;
}) {
  const isOpen = useIsDrawerOpen();
  const currentPathname = usePathname();
  const { data: encryptedFolders } = useEncryptedFolders();
  const lockAllEncryptedFolders = useLockAllEncryptedFolders();
  const unlockedCount = (encryptedFolders ?? []).filter((folder) => folder.unlocked).length;
  return (
    <Slideover isOpen={isOpen} onOpenChange={setDrawerOpen} side="right" size="small" panelClassName="h-dvh max-w-80">
      <div className="flex min-h-full flex-col" data-testid="mobile-menu-drawer">
        <div className="flex items-center gap-3 border-b border-line/60 px-4 py-4">
          <span className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full border-2 border-brand/50 bg-brand/15 font-display text-sm font-semibold text-brand">
            {readInitials(currentAccount.fullName)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{currentAccount.fullName}</div>
            <div className="text-xs text-foreground-muted">{currentAccount.roleLabel}</div>
          </div>
        </div>
        <div className="border-b border-line/60 px-4 py-3">
          <div className="mb-1.5 text-xs text-foreground-subtle">Theme</div>
          <ThemeSwitch />
        </div>
        <nav aria-label="Pages" className="grid gap-0.5 border-b border-line/60 p-2">
          {PAGE_LINKS.map((pageLink) => (
            <DrawerItem
              key={pageLink.href}
              icon={pageLink.icon}
              href={pageLink.href}
              isActive={isActiveLink(currentPathname, pageLink.href)}
              testId={`drawer-${pageLink.title.toLowerCase()}`}
            >
              {pageLink.title}
            </DrawerItem>
          ))}
        </nav>
        <div className="grid gap-0.5 border-b border-line/60 p-2">
          <DrawerItem icon={Expand} onSelect={() => void document.documentElement.requestFullscreen?.()}>
            Full screen
          </DrawerItem>
          <DrawerItem icon={Lock} onSelect={() => void lockNow()} testId="drawer-lock">
            Lock now
          </DrawerItem>
          {unlockedCount > 0 && (
            <DrawerItem icon={KeyRound} onSelect={lockAllEncryptedFolders}>
              Lock all encrypted folders ({unlockedCount})
            </DrawerItem>
          )}
          <DrawerItem icon={Power} onSelect={() => void signOut()} testId="drawer-sign-out">
            Sign out
          </DrawerItem>
        </div>
        {applicationVersion && (
          <div className="mt-auto px-4 py-4 font-mono text-xs text-foreground-subtle" data-testid="drawer-version">
            CMM {applicationVersion}
          </div>
        )}
      </div>
    </Slideover>
  );
}

const BOTTOM_ITEM_CLASS_NAMES =
  "flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-foreground-muted transition-colors";

/**
 * The bottom bar on phones, like other mobile apps: Drives, Search, Backup, Trash and Menu (the
 * drawer with the account and system actions). Hidden from the `md` breakpoint up, where the top
 * bar has room for them, and on touch screens while the keyboard is up, so the room above the
 * keyboard goes to what is being typed in (the terminal and its key bar).
 *
 * @example
 * <MobileBottomBar />
 */
export function MobileBottomBar() {
  const currentPathname = usePathname();
  const isOpen = useIsDrawerOpen();
  const isTouch = useMediaQuery("(pointer: coarse)");
  const isTyping = useIsTyping();
  if (isTouch && isTyping) return null;
  return (
    <nav
      aria-label="Main menu"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      data-testid="mobile-bottom-bar"
    >
      {PAGE_LINKS.slice(0, 1).map((pageLink) => (
        <BottomLink key={pageLink.href} pageLink={pageLink} isActive={isActiveLink(currentPathname, pageLink.href)} />
      ))}
      <button
        type="button"
        onClick={openQuickSearch}
        className={mergeClassNames(BOTTOM_ITEM_CLASS_NAMES, "hover:text-brand")}
        data-testid="bottom-search"
      >
        <Search className="h-5 w-5 stroke-[1.4]" />
        Search
      </button>
      {PAGE_LINKS.slice(1, 3).map((pageLink) => (
        <BottomLink key={pageLink.href} pageLink={pageLink} isActive={isActiveLink(currentPathname, pageLink.href)} />
      ))}
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setDrawerOpen(true)}
        className={mergeClassNames(BOTTOM_ITEM_CLASS_NAMES, "hover:text-brand", isOpen && "text-brand")}
        data-testid="bottom-menu"
      >
        <Menu className="h-5 w-5 stroke-[1.4]" />
        Menu
      </button>
    </nav>
  );
}

function BottomLink({
  pageLink,
  isActive,
}: {
  pageLink: { href: string; title: string; icon: LucideIcon };
  isActive: boolean;
}) {
  return (
    <Link
      href={pageLink.href}
      aria-current={isActive ? "page" : undefined}
      className={mergeClassNames(BOTTOM_ITEM_CLASS_NAMES, isActive ? "text-brand" : "hover:text-brand")}
      data-testid={`bottom-${pageLink.title.toLowerCase()}`}
    >
      <pageLink.icon className="h-5 w-5 stroke-[1.4]" />
      {pageLink.title}
    </Link>
  );
}
