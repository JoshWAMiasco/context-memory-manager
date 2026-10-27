import type { ReactNode } from "react";
import { ToastViewport } from "@/components/interactive/toast-notification";
import type { AccountMenuAccount } from "@/components/layout-shell/account-menu";
import { MobileBottomBar, MobileMenuDrawer } from "@/components/layout-shell/mobile-navigation";
import { PageLoadingOverlay } from "@/components/layout-shell/page-loading-overlay";
import { ScrollAwareElement } from "@/components/layout-shell/scroll-aware-element";
import { ShellWrappers } from "@/components/layout-shell/shell-wrappers";
import { SideMenu } from "@/components/layout-shell/side-menu";
import { PageContentFrame, SideMenuFrame, SideMenuStateProvider } from "@/components/layout-shell/side-menu-state";
import { TopBar } from "@/components/layout-shell/top-bar";
import { SHELL_APPEARANCE } from "@/configuration/shell-appearance";
import { SIDE_MENU_NAVIGATION, type SideMenuEntry } from "@/configuration/side-menu-navigation";

const APPLICATION_HOME_HREF = "/";

/** Shown when no signed-in user is passed. */
const PLACEHOLDER_ACCOUNT: AccountMenuAccount = { fullName: "Administrator", roleLabel: "admin" };

export interface ApplicationShellProps {
  children: ReactNode;
  navigation?: readonly SideMenuEntry[];
  /** Custom side menu content; replaces `navigation`. */
  sideMenuContent?: ReactNode;
  currentAccount?: AccountMenuAccount;
  /** CMM's version, for the mobile menu drawer. */
  applicationVersion?: string;
}

/**
 * The application frame around every signed-in page: theme wrapper, loading overlay, side menu
 * (none in `top-bar-only` themes), top bar and the content container, laid out and styled by the
 * theme's `SHELL_APPEARANCE` (`configuration/shell-appearance.ts`).
 *
 * @example
 * export default function SignedInLayout({ children }: LayoutProps<"/">) {
 *   return <ApplicationShell currentAccount={account}>{children}</ApplicationShell>;
 * }
 */
export function ApplicationShell({
  children,
  navigation = SIDE_MENU_NAVIGATION,
  sideMenuContent,
  currentAccount = PLACEHOLDER_ACCOUNT,
  applicationVersion,
}: ApplicationShellProps) {
  const { classNames } = SHELL_APPEARANCE;
  const topBar = (
    <TopBar appearance={SHELL_APPEARANCE} homeHref={APPLICATION_HOME_HREF} currentAccount={currentAccount} />
  );
  const sideMenu = (
    <SideMenu
      navigation={navigation}
      content={sideMenuContent}
      appearance={SHELL_APPEARANCE}
      homeHref={APPLICATION_HOME_HREF}
    />
  );
  const application = (
    <PageLoadingOverlay className={classNames.loadingPage}>
      <SideMenuStateProvider>
        <SideMenuFrame className={classNames.sideMenuFrame}>
          {SHELL_APPEARANCE.layoutVariant === "top-bar-only" ? (
            topBar
          ) : SHELL_APPEARANCE.layoutVariant === "side-menu-with-brand" ? (
            <>
              {sideMenu}
              {topBar}
            </>
          ) : (
            <>
              {topBar}
              {sideMenu}
            </>
          )}
        </SideMenuFrame>
        <PageContentFrame
          className={classNames.pageContent}
          hasScrollAwareMode={SHELL_APPEARANCE.hasScrollAwareBackground}
        >
          <ShellWrappers classNameLayers={classNames.pageContentWrappers}>
            <div className={classNames.pageContainer}>{children}</div>
          </ShellWrappers>
        </PageContentFrame>
      </SideMenuStateProvider>
    </PageLoadingOverlay>
  );
  return (
    <>
      {SHELL_APPEARANCE.hasScrollAwareBackground ? (
        <ScrollAwareElement className={classNames.themeWrapper} classNameWhenScrolled="background--hidden">
          {application}
        </ScrollAwareElement>
      ) : (
        <div className={classNames.themeWrapper}>{application}</div>
      )}
      {/* Outside the top bar: its backdrop blur would pin fixed elements to it rather than the screen. */}
      <MobileBottomBar />
      <MobileMenuDrawer currentAccount={currentAccount} applicationVersion={applicationVersion} />
      <ToastViewport />
    </>
  );
}
