import { HardDrive, Settings, type LucideIcon } from "lucide-react";

export interface SideMenuLinkEntry {
  entryKind: "link";
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface SideMenuGroupEntry {
  entryKind: "group";
  title: string;
  icon: LucideIcon;
  links: readonly SideMenuLinkEntry[];
}

export interface SideMenuDividerEntry {
  entryKind: "divider";
  title: string;
}

export type SideMenuEntry = SideMenuLinkEntry | SideMenuGroupEntry | SideMenuDividerEntry;

const link = (title: string, href: string, icon: LucideIcon, badge?: string): SideMenuLinkEntry => ({
  entryKind: "link",
  title,
  href,
  icon,
  badge,
});
const divider = (title: string): SideMenuDividerEntry => ({ entryKind: "divider", title });

/**
 * A side menu's entries, in display order, for layouts that have one (CCM's top-bar-only layout
 * doesn't show it). Server-only: icons are components, rendered on the server.
 */
export const SIDE_MENU_NAVIGATION: readonly SideMenuEntry[] = [
  divider("Storages"),
  link("Internal", "/", HardDrive),
  divider("System"),
  link("Settings", "/settings", Settings),
];
