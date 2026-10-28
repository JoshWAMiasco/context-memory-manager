"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArchiveRestore, LayoutGrid, ServerCog, Settings, Trash2, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/interactive/tooltip";
import { mergeClassNames } from "@/utilities/merge-class-names";

const NAVIGATION_LINKS: { href: string; title: string; icon: LucideIcon; testId: string }[] = [
  { href: "/", title: "Drives", icon: LayoutGrid, testId: "nav-drives" },
  { href: "/jobs", title: "Jobs", icon: ServerCog, testId: "nav-jobs" },
  { href: "/backup", title: "Backup", icon: ArchiveRestore, testId: "nav-backup" },
  { href: "/trash", title: "Trash", icon: Trash2, testId: "nav-trash" },
  { href: "/settings", title: "Settings", icon: Settings, testId: "nav-settings" },
];

function isActiveLink(currentPathname: string, linkHref: string): boolean {
  if (linkHref === "/") return currentPathname === "/";
  return currentPathname === linkHref || currentPathname.startsWith(`${linkHref}/`);
}

/**
 * The top bar's page links (Drives, Jobs, Backup, Trash, Settings) as icon buttons with tooltips, the
 * current page highlighted. They replaced the side menu's pinned links.
 *
 * @example
 * <ShellNavigation buttonClassName={classNames.actionButton} iconClassName={classNames.actionIcon} />
 */
export function ShellNavigation({
  buttonClassName,
  iconClassName,
}: {
  buttonClassName: string;
  iconClassName: string;
}) {
  const currentPathname = usePathname();
  return (
    <nav aria-label="Main menu" className="flex items-center gap-1">
      {NAVIGATION_LINKS.map((navigationLink) => {
        const isActive = isActiveLink(currentPathname, navigationLink.href);
        return (
          <Tooltip key={navigationLink.href} content={navigationLink.title}>
            <Link
              href={navigationLink.href}
              aria-label={navigationLink.title}
              aria-current={isActive ? "page" : undefined}
              data-testid={navigationLink.testId}
              className={mergeClassNames(buttonClassName, "flex", isActive && "bg-brand/10 text-brand")}
            >
              <navigationLink.icon className={iconClassName} />
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
}
