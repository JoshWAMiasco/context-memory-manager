/**
 * Where the brand sits, which decides how the shell is put together:
 * - `top-bar-with-brand`: a full-width top bar holds the logo and the collapse toggle; the side
 *   menu starts below it.
 * - `side-menu-with-brand`: a full-height side menu holds the logo; the top bar floats beside it.
 * - `top-bar-only`: no side menu; a full-width top bar holds the logo, quick search and the page
 *   links (CCM's variant: the drives live on the home page and in quick search).
 */
export type ShellLayoutVariant = "top-bar-with-brand" | "side-menu-with-brand" | "top-bar-only";

export interface ShellClassNames {
  themeWrapper: string;
  loadingPage: string;
  sideMenuFrame: string;
  topBarWrappers: readonly string[];
  topBarBrandArea: string;
  topBarMainWrappers: readonly string[];
  brandArea: string;
  brandLink: string;
  brandMark: string;
  brandName: string;
  compactMenuToggle: string;
  mobileMenuButtons: string;
  mobileMenuButton: string;
  mobileMenuIcon: string;
  breadcrumbList: string;
  breadcrumbItem: string;
  breadcrumbCurrentItem: string;
  searchArea: string;
  searchTrigger: string;
  actionButtons: string;
  actionButton: string;
  actionIcon: string;
  accountAvatarButton: string;
  closeMobileMenu: string;
  sideMenuContent: string;
  sideMenuPanel: string;
  sideMenuNavigation: string;
  pageContent: string;
  pageContentWrappers: readonly string[];
  pageContainer: string;
}

/**
 * Everything that styles the dashboard shell. The theme defines it in
 * `configuration/shell-appearance.ts`; the layout-shell components read it, so restyling the shell
 * never means editing them.
 *
 * - `topBarWrappers` / `topBarMainWrappers` / `pageContentWrappers` are nested elements, outermost
 *   first. A top-bar wrapper whose classes include `top-bar` gets `top-bar--active` once the page
 *   scrolls when `hasScrollAwareTopBar` is on.
 * - `hasScrollAwareBackground` adds `background--hidden` to the theme wrapper and removes
 *   `mode--light` from the page content once the page scrolls (for a tall coloured header band).
 * - An empty class string means the theme has no such element (for example `sideMenuPanel`).
 *
 * @example
 * import type { ShellAppearance } from "@/components/layout-shell/shell-appearance";
 *
 * export const SHELL_APPEARANCE: ShellAppearance = {
 *   layoutVariant: "side-menu-with-brand",
 *   hasScrollAwareTopBar: false,
 *   hasScrollAwareBackground: false,
 *   classNames: { themeWrapper: "decoration-grid-backdrop relative min-h-screen", … },
 * };
 */
export interface ShellAppearance {
  layoutVariant: ShellLayoutVariant;
  hasScrollAwareTopBar: boolean;
  hasScrollAwareBackground: boolean;
  classNames: ShellClassNames;
}
