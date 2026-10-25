import { Database, Info, KeyRound, LockKeyhole, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/auth/policy";

export interface SettingsNavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface RoleSettingsNavigationItem extends SettingsNavigationItem {
  adminOnly?: boolean;
}

/**
 * The links of the settings side navigation, in display order. Users and Storages are for admins only.
 */
const SETTINGS_NAVIGATION_ITEMS: readonly RoleSettingsNavigationItem[] = [
  { label: "General", href: "/settings/general", icon: SlidersHorizontal },
  { label: "Users", href: "/settings/users", icon: Users, adminOnly: true },
  { label: "Security", href: "/settings/security", icon: KeyRound },
  { label: "Storages", href: "/settings/storages", icon: Database, adminOnly: true },
  { label: "Encryption", href: "/settings/encryption", icon: LockKeyhole },
  { label: "About", href: "/settings/about", icon: Info },
];

/** The settings links `role` may open. */
export function listSettingsNavigationItems(role: UserRole): SettingsNavigationItem[] {
  return SETTINGS_NAVIGATION_ITEMS.filter((item) => !item.adminOnly || role === "admin").map(
    ({ label, href, icon }) => ({ label, href, icon }),
  );
}
