"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { joinClassNames } from "@/utilities/join-class-names";

const COMPACT_MENU_STORAGE_KEY = "compactMenu";
const AUTOMATIC_COMPACT_MAXIMUM_WIDTH = 1600;

interface SideMenuStateContextValue {
  isCollapsed: boolean;
  isHovered: boolean;
  isMobileMenuOpen: boolean;
  toggleCollapsed: () => void;
  openMobileMenu: () => void;
  closeMobileMenu: () => void;
  setIsHovered: (isHovered: boolean) => void;
}

const SideMenuStateContext = createContext<SideMenuStateContextValue | null>(null);

/**
 * Holds the side menu's collapsed, hover and mobile-open states, remembered in localStorage like
 * before (collapsed by default, and always collapsed at 1600px wide or less). Wrap both
 * `SideMenuFrame` and `PageContentFrame` with it.
 *
 * @example
 * <SideMenuStateProvider>
 *   <SideMenuFrame>…</SideMenuFrame>
 *   <PageContentFrame>{children}</PageContentFrame>
 * </SideMenuStateProvider>
 */
export function SideMenuStateProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const storedPreference = localStorage.getItem(COMPACT_MENU_STORAGE_KEY);
    queueMicrotask(() => setIsCollapsed(storedPreference === null || storedPreference === "true"));
    const handleResize = () => {
      setIsMobileMenuOpen(false);
      if (window.innerWidth <= AUTOMATIC_COMPACT_MAXIMUM_WIDTH) {
        localStorage.setItem(COMPACT_MENU_STORAGE_KEY, "true");
        setIsCollapsed(true);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((previousIsCollapsed) => {
      localStorage.setItem(COMPACT_MENU_STORAGE_KEY, String(!previousIsCollapsed));
      return !previousIsCollapsed;
    });
  }, []);

  return (
    <SideMenuStateContext.Provider
      value={{
        isCollapsed,
        isHovered,
        isMobileMenuOpen,
        toggleCollapsed,
        openMobileMenu: () => setIsMobileMenuOpen(true),
        closeMobileMenu: () => setIsMobileMenuOpen(false),
        setIsHovered,
      }}
    >
      {children}
    </SideMenuStateContext.Provider>
  );
}

/**
 * The `.side-menu` frame with the modifier classes for the current state, so the server-rendered
 * top bar and menu inside react through `group-[.side-menu--…]` classes. Pass the theme's frame
 * classes (`SHELL_APPEARANCE.classNames.sideMenuFrame`).
 *
 * @example
 * <SideMenuFrame className={SHELL_APPEARANCE.classNames.sideMenuFrame}>
 *   <TopBar … />
 *   <SideMenu navigation={SIDE_MENU_NAVIGATION} />
 * </SideMenuFrame>
 */
export function SideMenuFrame({ className, children }: { className?: string; children: ReactNode }) {
  const { isCollapsed, isHovered, isMobileMenuOpen } = useSideMenuState();
  return (
    <div
      className={joinClassNames(
        "side-menu group",
        className,
        isCollapsed && "side-menu--collapsed",
        isHovered && "side-menu--on-hover",
        isMobileMenuOpen && "side-menu--mobile-menu-open",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Reads and changes the side menu state from client components inside `SideMenuFrame`.
 *
 * @example
 * const { isCollapsed, toggleCollapsed } = useSideMenuState();
 */
export function useSideMenuState(): SideMenuStateContextValue {
  const contextValue = useContext(SideMenuStateContext);
  if (!contextValue) throw new Error("useSideMenuState must be used inside <SideMenuFrame>.");
  return contextValue;
}

/**
 * A `.side-menu__content` region that reports mouse hover, so the collapsed menu expands while
 * the pointer is over it (desktop only).
 *
 * @example
 * <HoverableSideMenuContent className="absolute inset-y-0 z-10 xl:top-[65px]">…</HoverableSideMenuContent>
 */
export function HoverableSideMenuContent({ className, children }: { className?: string; children: ReactNode }) {
  const { setIsHovered } = useSideMenuState();
  return (
    <div
      onMouseOver={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={joinClassNames("side-menu__content", className)}
    >
      {children}
    </div>
  );
}

/**
 * The round arrow button that collapses or expands the side menu (shown from 1600px wide).
 *
 * @example
 * <CompactMenuToggle className={SHELL_APPEARANCE.classNames.compactMenuToggle}><ArrowLeft className="h-3.5 w-3.5 stroke-[1.3]" /></CompactMenuToggle>
 */
export function CompactMenuToggle({ className, children }: { className?: string; children: ReactNode }) {
  const { toggleCollapsed } = useSideMenuState();
  return (
    <button
      type="button"
      aria-label="Collapse or expand the side menu"
      onClick={toggleCollapsed}
      className={joinClassNames("toggle-compact-menu cursor-pointer", className)}
    >
      {children}
    </button>
  );
}

/**
 * The hamburger button that opens the side menu on screens narrower than 1280px.
 *
 * @example
 * <MobileMenuOpenButton className="rounded-full p-2 hover:bg-surface-muted"><AlignJustify className="h-[18px] w-[18px] stroke-[1]" /></MobileMenuOpenButton>
 */
export function MobileMenuOpenButton({ className, children }: { className?: string; children: ReactNode }) {
  const { openMobileMenu } = useSideMenuState();
  return (
    <button
      type="button"
      aria-label="Open menu"
      onClick={openMobileMenu}
      className={joinClassNames("open-mobile-menu cursor-pointer", className)}
    >
      {children}
    </button>
  );
}

/**
 * The close button shown beside the open mobile menu. The theme's classes show it through
 * `[&.close-mobile-menu--mobile-menu-open]:flex`.
 *
 * @example
 * <MobileMenuCloseButton className={SHELL_APPEARANCE.classNames.closeMobileMenu}><X className="h-8 w-8 stroke-[1] text-on-primary" /></MobileMenuCloseButton>
 */
export function MobileMenuCloseButton({ className, children }: { className?: string; children: ReactNode }) {
  const { isMobileMenuOpen, closeMobileMenu } = useSideMenuState();
  return (
    <div
      className={joinClassNames(
        "close-mobile-menu",
        className,
        isMobileMenuOpen && "close-mobile-menu--mobile-menu-open",
      )}
    >
      <button type="button" aria-label="Close menu" onClick={closeMobileMenu} className="mt-5 ml-5 cursor-pointer">
        {children}
      </button>
    </div>
  );
}

/**
 * The `.content` area beside the side menu; its left margin follows the collapsed state. With
 * `hasScrollAwareMode` it carries `mode--light` while the page is at the top, so page headers can
 * turn white over a colored header background (``).
 *
 * @example
 * <PageContentFrame className={SHELL_APPEARANCE.classNames.pageContent}><div className="container">{children}</div></PageContentFrame>
 */
export function PageContentFrame({
  className,
  hasScrollAwareMode = false,
  children,
}: {
  className?: string;
  hasScrollAwareMode?: boolean;
  children: ReactNode;
}) {
  const { isCollapsed } = useSideMenuState();
  const [hasScrolled, setHasScrolled] = useState(false);
  useEffect(() => {
    if (!hasScrollAwareMode) return;
    const updateScrollState = () => setHasScrolled(window.scrollY > 0);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, [hasScrollAwareMode]);
  return (
    <div
      className={joinClassNames(
        "content",
        className,
        isCollapsed && "content--compact",
        hasScrollAwareMode && !hasScrolled && "mode--light",
      )}
    >
      {children}
    </div>
  );
}
