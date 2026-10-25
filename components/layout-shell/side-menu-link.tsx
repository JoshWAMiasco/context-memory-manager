"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

function isPathActive(currentPathname: string, linkHref: string): boolean {
  return currentPathname === linkHref || currentPathname.startsWith(`${linkHref}/`);
}

/**
 * One side-menu link. It highlights itself when its route (or a child route) is open.
 *
 * @example
 * <SideMenuLink href="/users" title="Users" icon={<UserSquare className="side-menu__link__icon h-5 w-5 stroke-[1]" />} />
 */
export function SideMenuLink({
  href,
  title,
  icon,
  badge,
}: {
  href: string;
  title: string;
  icon: ReactNode;
  badge?: string;
}) {
  const currentPathname = usePathname();
  return (
    <Link
      href={href}
      className={mergeClassNames("side-menu__link", isPathActive(currentPathname, href) && "side-menu__link--active")}
    >
      {icon}
      <div className="side-menu__link__title">{title}</div>
      {badge && <div className="side-menu__link__badge">{badge}</div>}
    </Link>
  );
}

/**
 * A collapsible side-menu group. It starts open when one of its links is the current page.
 *
 * @example
 * <SideMenuGroup title="Products" icon={<Table2 className="side-menu__link__icon h-5 w-5 stroke-[1]" />} linkHrefs={["/ecommerce/products/list"]}>
 *   <li><SideMenuLink … /></li>
 * </SideMenuGroup>
 */
export function SideMenuGroup({
  title,
  icon,
  linkHrefs,
  children,
}: {
  title: string;
  icon: ReactNode;
  linkHrefs: readonly string[];
  children: ReactNode;
}) {
  const currentPathname = usePathname();
  const containsActiveLink = linkHrefs.some((linkHref) => isPathActive(currentPathname, linkHref));
  const [isOpen, setIsOpen] = useState(containsActiveLink);
  return (
    <>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previousIsOpen) => !previousIsOpen)}
        className={mergeClassNames(
          "side-menu__link w-full cursor-pointer",
          isOpen && "side-menu__link--active-dropdown",
          containsActiveLink && "side-menu__link--active",
        )}
      >
        {icon}
        <div className="side-menu__link__title text-left">{title}</div>
        <ChevronDown
          className={mergeClassNames(
            "side-menu__link__chevron h-5 w-5 stroke-[1] transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>
      <ul className={mergeClassNames(!isOpen && "hidden", isOpen && "side-menu__link__sub-open")}>{children}</ul>
    </>
  );
}
