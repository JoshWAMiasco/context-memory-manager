import { AlignJustify, ArrowLeft, Expand } from "lucide-react";
import { UnlockedFoldersButton } from "@/components/encryption/unlocked-folders-button";
import { BackgroundJobsButton } from "@/components/jobs/background-jobs-button";
import { AccountMenu, type AccountMenuAccount } from "@/components/layout-shell/account-menu";
import { BrandLogo } from "@/components/layout-shell/brand-logo";
import { BreadcrumbTrail } from "@/components/layout-shell/breadcrumb-trail";
import { FullScreenButton } from "@/components/layout-shell/full-screen-button";
import { MobileAccountButton } from "@/components/layout-shell/mobile-navigation";
import type { ShellAppearance } from "@/components/layout-shell/shell-appearance";
import { ShellWrappers } from "@/components/layout-shell/shell-wrappers";
import {
  CompactMenuToggle,
  HoverableSideMenuContent,
  MobileMenuOpenButton,
} from "@/components/layout-shell/side-menu-state";
import { QuickSearch } from "@/components/shell/quick-search";
import { ShellNavigation } from "@/components/shell/shell-navigation";

export interface TopBarProps {
  appearance: ShellAppearance;
  homeHref?: string;
  currentAccount: AccountMenuAccount;
}

/**
 * The fixed 65px top bar: breadcrumb, background jobs, unlocked encrypted folders, full
 * screen and the account menu, plus the logo and collapse toggle in `top-bar-with-brand` themes.
 * In `top-bar-only` themes (CMM) it also holds the logo, quick search (⌘K) and the page links
 * that the side menu used to have. On phones it keeps the logo, the job and key indicators and the
 * avatar, which opens the menu drawer; the page links move to a bottom bar. Server component; each control is a small client island. Its
 * look comes from `appearance`.
 *
 * @example
 * <TopBar appearance={SHELL_APPEARANCE} currentAccount={{ fullName: "Administrator", roleLabel: "admin" }} />
 */
export function TopBar({ appearance, homeHref = "/", currentAccount }: TopBarProps) {
  const { classNames } = appearance;
  const mobileMenuButtons = (
    <div className={classNames.mobileMenuButtons}>
      <MobileMenuOpenButton className={classNames.mobileMenuButton}>
        <AlignJustify className={classNames.mobileMenuIcon} />
      </MobileMenuOpenButton>
    </div>
  );
  const topBarItems = (
    <>
      <BreadcrumbTrail classNames={classNames} />
      <div className="flex flex-1 items-center">
        <div className={classNames.actionButtons}>
          <BackgroundJobsButton />
          <UnlockedFoldersButton />
          <FullScreenButton className={classNames.actionButton}>
            <Expand className={classNames.actionIcon} />
          </FullScreenButton>
        </div>
        <AccountMenu currentAccount={currentAccount} avatarClassName={classNames.accountAvatarButton} />
      </div>
    </>
  );

  if (appearance.layoutVariant === "top-bar-only") {
    return (
      <ShellWrappers classNameLayers={classNames.topBarWrappers} hasScrollAwareTopBar={appearance.hasScrollAwareTopBar}>
        <BrandLogo href={homeHref} classNames={classNames} />
        <BreadcrumbTrail classNames={classNames} />
        <div className={classNames.searchArea}>
          {/* On phones search lives in the bottom bar. */}
          <QuickSearch triggerClassName={classNames.searchTrigger} iconButtonClassName="hidden" />
        </div>
        <div className={classNames.actionButtons}>
          <div className="hidden items-center gap-1 md:flex">
            <ShellNavigation buttonClassName={classNames.actionButton} iconClassName={classNames.actionIcon} />
            <span className="mx-1 h-6 border-l border-line" aria-hidden="true" />
          </div>
          <BackgroundJobsButton />
          <UnlockedFoldersButton />
          <FullScreenButton className={`hidden md:flex ${classNames.actionButton}`}>
            <Expand className={classNames.actionIcon} />
          </FullScreenButton>
        </div>
        <div className="hidden md:block">
          <AccountMenu currentAccount={currentAccount} avatarClassName={classNames.accountAvatarButton} />
        </div>
        <MobileAccountButton
          currentAccount={currentAccount}
          className={`ml-2 md:hidden ${classNames.accountAvatarButton}`}
        />
      </ShellWrappers>
    );
  }

  if (appearance.layoutVariant === "side-menu-with-brand") {
    return (
      <ShellWrappers classNameLayers={classNames.topBarWrappers} hasScrollAwareTopBar={appearance.hasScrollAwareTopBar}>
        {mobileMenuButtons}
        {topBarItems}
      </ShellWrappers>
    );
  }

  return (
    <ShellWrappers classNameLayers={classNames.topBarWrappers} hasScrollAwareTopBar={appearance.hasScrollAwareTopBar}>
      <HoverableSideMenuContent className={classNames.topBarBrandArea}>
        <BrandLogo href={homeHref} classNames={classNames} />
        <CompactMenuToggle className={classNames.compactMenuToggle}>
          <ArrowLeft className="h-3.5 w-3.5 stroke-[1.3]" />
        </CompactMenuToggle>
        {mobileMenuButtons}
      </HoverableSideMenuContent>
      <ShellWrappers classNameLayers={classNames.topBarMainWrappers}>{topBarItems}</ShellWrappers>
    </ShellWrappers>
  );
}
