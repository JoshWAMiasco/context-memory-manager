"use client";

import { Tab as HeadlessTab, TabGroup, TabList as HeadlessTabList, TabPanel as HeadlessTabPanel, TabPanels as HeadlessTabPanels } from "@headlessui/react";
import { createContext, useContext, type ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type TabsVariant = "underline" | "boxed" | "pills" | "link";

const TabsVariantContext = createContext<TabsVariant>("underline");

const tabListClassNames: Record<TabsVariant, string> = {
  underline: "flex w-full border-b border-line",
  boxed: "flex w-full border-b border-line",
  pills: "flex w-full rounded-lg border border-line/70 bg-surface-subtle/70 p-0.5",
  link: "flex w-full",
};

const TAB_BASE_CLASS_NAMES =
  "block w-full cursor-pointer appearance-none border border-transparent px-3 text-foreground transition-colors focus-visible:outline-hidden data-selected:text-foreground-strong";

const tabClassNames: Record<TabsVariant, string> = {
  underline: "py-2 border-b-2 data-selected:border-b-primary data-selected:font-medium",
  boxed:
    "-mb-px py-2 rounded-t-md data-selected:bg-surface data-selected:border-line data-selected:border-b-transparent data-selected:font-medium [&:not([data-selected])]:hover:bg-surface-muted",
  pills:
    "py-1.5 rounded-md data-selected:border data-selected:shadow-xs data-selected:font-medium data-selected:border-line data-selected:bg-surface",
  link: "py-2 data-selected:font-medium data-selected:text-primary",
};

export interface TabsProps {
  variant?: TabsVariant;
  defaultSelectedIndex?: number;
  selectedIndex?: number;
  onSelectedIndexChange?: (selectedIndex: number) => void;
  isVertical?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Accessible tabs in four styles. Panel content can be server-rendered: only the
 * tab switching runs on the client.
 *
 * @example
 * <Tabs variant="pills">
 *   <TabList>
 *     <Tab>Overview</Tab>
 *     <Tab>Activity</Tab>
 *   </TabList>
 *   <TabPanels className="mt-5">
 *     <TabPanel><OverviewSection /></TabPanel>
 *     <TabPanel><ActivitySection /></TabPanel>
 *   </TabPanels>
 * </Tabs>
 */
export function Tabs({ variant = "underline", defaultSelectedIndex, selectedIndex, onSelectedIndexChange, isVertical = false, className, children }: TabsProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabGroup
        defaultIndex={defaultSelectedIndex}
        selectedIndex={selectedIndex}
        onChange={onSelectedIndexChange}
        vertical={isVertical}
        className={className}
      >
        {children}
      </TabGroup>
    </TabsVariantContext.Provider>
  );
}

/**
 * The row of tab buttons inside `Tabs`.
 *
 * @example
 * <TabList><Tab>Profile</Tab><Tab>Settings</Tab></TabList>
 */
export function TabList({ className, children }: { className?: string; children: ReactNode }) {
  const variant = useContext(TabsVariantContext);
  return <HeadlessTabList className={mergeClassNames(tabListClassNames[variant], className)}>{children}</HeadlessTabList>;
}

/**
 * One tab button. Its position matches the `TabPanel` at the same position.
 *
 * @example
 * <Tab icon={<User className="mr-2 h-4 w-4" />}>Profile</Tab>
 */
export function Tab({ icon, className, children }: { icon?: ReactNode; className?: string; children: ReactNode }) {
  const variant = useContext(TabsVariantContext);
  return (
    <HeadlessTab className={mergeClassNames(TAB_BASE_CLASS_NAMES, tabClassNames[variant], "flex-1", icon && "flex items-center justify-center", className)}>
      {icon}
      {children}
    </HeadlessTab>
  );
}

/**
 * The container for the tab panels.
 *
 * @example
 * <TabPanels className="mt-5">…</TabPanels>
 */
export function TabPanels({ className, children }: { className?: string; children: ReactNode }) {
  return <HeadlessTabPanels className={className}>{children}</HeadlessTabPanels>;
}

/**
 * The content of one tab. Pass `isAlwaysRendered` to keep hidden panels in the HTML (for SEO).
 *
 * @example
 * <TabPanel className="leading-relaxed">Server-rendered content</TabPanel>
 */
export function TabPanel({ isAlwaysRendered = false, className, children }: { isAlwaysRendered?: boolean; className?: string; children: ReactNode }) {
  return (
    <HeadlessTabPanel unmount={!isAlwaysRendered} className={mergeClassNames("leading-relaxed focus-visible:outline-hidden", className)}>
      {children}
    </HeadlessTabPanel>
  );
}
