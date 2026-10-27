import type { ShellAppearance } from "@/components/layout-shell/shell-appearance";

const BREADCRUMB_SEPARATOR_CLASS_NAMES =
  "relative ml-5 pl-0.5 before:content-[''] before:w-[14px] before:h-[14px] before:bg-chevron-theme before:opacity-50 before:transform before:rotate-[-90deg] before:bg-[length:100%] before:-ml-[1.125rem] before:absolute before:my-auto before:inset-y-0";

/**
 * How CMM's shell looks: no side menu (the drives live on the home page
 * and in quick search), a floating, frosted top bar across the whole width that holds the logo,
 * breadcrumb, quick search and page links, and the class lists of every shell element. The page
 * container is 1320px wide, except a page that marks itself `data-full-width` (the explorer).
 * Theme-owned and safe to edit by hand; the layout-shell components read it.
 */
export const SHELL_APPEARANCE: ShellAppearance = {
  layoutVariant: "top-bar-only",
  hasScrollAwareTopBar: false,
  hasScrollAwareBackground: false,
  classNames: {
    themeWrapper: "decoration-grid-backdrop relative min-h-screen",
    loadingPage:
      "h-screen relative [&.loading-page--before-hide]:before:block [&.loading-page--hide]:before:opacity-0 before:content-[''] before:transition-opacity before:duration-300 before:hidden before:inset-0 before:h-screen before:w-screen before:fixed before:bg-canvas before:z-[60] [&.loading-page--before-hide]:after:block [&.loading-page--hide]:after:opacity-0 after:content-[''] after:transition-opacity after:duration-300 after:hidden after:h-16 after:w-16 after:animate-pulse after:fixed after:opacity-80 after:inset-0 after:m-auto after:bg-loading-puff after:bg-cover after:z-[61]",
    sideMenuFrame: "relative z-50",
    topBarWrappers: [
      "fixed h-[65px] mt-3.5 inset-x-0 top-0 z-50",
      "box absolute inset-x-0 mx-3.5 h-full border-line bg-surface/75 backdrop-blur-md sm:mx-5",
      "flex h-full w-full items-center gap-2 px-3 sm:gap-3 sm:px-5",
    ],
    topBarBrandArea: "",
    topBarMainWrappers: [],
    brandArea: "",
    brandLink: "group/brand flex flex-none items-center",
    brandMark: "h-[38px] w-[38px] transition-transform duration-300 group-hover/brand:scale-105",
    brandName: "decoration-text-glow ml-3 hidden font-display text-lg font-bold tracking-[0.08em] text-brand sm:block",
    compactMenuToggle: "hidden",
    mobileMenuButtons: "hidden",
    mobileMenuButton: "p-2 rounded-md text-foreground-muted hover:bg-surface-muted hover:text-brand",
    mobileMenuIcon: "stroke-[1.3] h-[18px] w-[18px]",
    breadcrumbList: "ml-3 flex items-center whitespace-nowrap border-l border-line pl-4 text-brand",
    breadcrumbItem: BREADCRUMB_SEPARATOR_CLASS_NAMES,
    breadcrumbCurrentItem: `${BREADCRUMB_SEPARATOR_CLASS_NAMES} text-foreground-muted cursor-text`,
    searchArea: "relative flex justify-end md:flex-1 md:justify-center",
    searchTrigger:
      "w-full max-w-[380px] cursor-pointer items-center rounded-md border border-line-strong bg-field/70 px-3.5 py-2 text-foreground-subtle transition-colors hover:border-brand/60 hover:text-foreground",
    actionButtons: "ml-auto flex items-center gap-1",
    actionButton: "p-2 rounded-md text-foreground-muted transition-colors hover:bg-surface-muted hover:text-brand",
    actionIcon: "stroke-[1.3] h-[18px] w-[18px]",
    accountAvatarButton:
      "cursor-pointer image-fit h-[36px] w-[36px] overflow-hidden rounded-full border-2 border-brand/50",
    closeMobileMenu: "hidden",
    sideMenuContent: "",
    sideMenuPanel: "",
    sideMenuNavigation: "",
    pageContent: "relative z-10 pt-[65px] pb-28 md:pb-16",
    pageContentWrappers: ["px-3.5 mt-7 sm:px-5 md:mt-10"],
    pageContainer: "container has-[[data-full-width]]:max-w-none",
  },
};
