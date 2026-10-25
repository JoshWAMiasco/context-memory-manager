"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface SettingsNavigationLinkProps {
  href: string;
  label: string;
  icon?: ReactNode;
  className?: string;
}

/**
 * One link of the settings side navigation; it turns primary and bold when its `href` is the
 * current route.
 *
 * @example
 * <SettingsNavigationLink href="/settings/security" label="Security" icon={<KeyRound className="mr-3 h-4 w-4 stroke-[1.3]" />} />
 */
export function SettingsNavigationLink({ href, label, icon, className }: SettingsNavigationLinkProps) {
  const isActive = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={mergeClassNames(
        "flex items-center py-3 first:-mt-3 last:-mb-3 hover:text-primary",
        isActive && "font-medium text-primary",
        className,
      )}
    >
      {icon}
      {label}
    </Link>
  );
}
