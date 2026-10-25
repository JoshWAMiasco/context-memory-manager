"use client";

import { Menu, MenuButton, MenuHeading, MenuItem, MenuItems, MenuSection, MenuSeparator } from "@headlessui/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type DropdownMenuPlacement =
  | "bottom"
  | "bottom start"
  | "bottom end"
  | "top"
  | "top start"
  | "top end"
  | "left"
  | "left start"
  | "left end"
  | "right"
  | "right start"
  | "right end";

export interface DropdownMenuProps {
  trigger: ReactNode;
  /** The trigger button's accessible name, for icon-only triggers. */
  triggerLabel?: string;
  placement?: DropdownMenuPlacement;
  triggerClassName?: string;
  menuClassName?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A dropdown menu opened by `trigger`. Items, dividers and headers go in `children`; the menu
 * content may be rendered by a server component. `placement` takes the Headless UI anchor
 * positions (side, then optional `start`/`end` alignment) and defaults to `"bottom end"`.
 *
 * @example
 * <DropdownMenu trigger={<MoreVertical className="h-5 w-5 stroke-[1] text-foreground-muted" />} triggerLabel="More actions" placement="bottom end">
 *   <DropdownMenuItem href={`/users/${user.id}/edit`} icon={<CheckSquare className="mr-2 h-4 w-4" />}>Edit</DropdownMenuItem>
 *   <DropdownMenuDivider />
 *   <DropdownMenuItem tone="danger" icon={<Trash2 className="mr-2 h-4 w-4" />}>Delete</DropdownMenuItem>
 * </DropdownMenu>
 * <DropdownMenu trigger={<span className={createButtonClassNames({ variant: "outline-secondary" })}>Export</span>} placement="top start">…</DropdownMenu>
 */
export function DropdownMenu({ trigger, triggerLabel, placement = "bottom end", triggerClassName, menuClassName, className, children }: DropdownMenuProps) {
  return (
    <Menu as="div" className={mergeClassNames("relative", className)}>
      <MenuButton aria-label={triggerLabel} className={mergeClassNames("flex cursor-pointer items-center focus-visible:outline-hidden", triggerClassName)}>
        {trigger}
      </MenuButton>
      <MenuItems
        anchor={{ to: placement, gap: 4 }}
        transition
        className={mergeClassNames(
          "z-50 w-40 rounded-md border border-line-strong bg-surface-muted p-2 shadow-overlay transition duration-150 ease-linear focus:outline-hidden data-closed:translate-y-1 data-closed:opacity-0",
          menuClassName,
        )}
      >
        {children}
      </MenuItems>
    </Menu>
  );
}

export type DropdownMenuItemTone = "default" | "danger";

export interface DropdownMenuItemProps {
  href?: string;
  onSelect?: () => void;
  icon?: ReactNode;
  tone?: DropdownMenuItemTone;
  isDisabled?: boolean;
  className?: string;
  children: ReactNode;
}

const DROPDOWN_MENU_ITEM_CLASS_NAMES =
  "flex w-full cursor-pointer items-center rounded-md p-2 transition duration-300 ease-in-out data-focus:bg-surface-strong/60 data-disabled:cursor-not-allowed data-disabled:opacity-60";

/**
 * One entry of a `DropdownMenu`: a link when `href` is set, otherwise a button calling `onSelect`.
 * `onSelect` only works when the item is rendered from client code.
 *
 * @example
 * <DropdownMenuItem href="/settings" icon={<Settings className="mr-2 h-4 w-4" />}>Settings</DropdownMenuItem>
 */
export function DropdownMenuItem({ href, onSelect, icon, tone = "default", isDisabled = false, className, children }: DropdownMenuItemProps) {
  const itemClassName = mergeClassNames(DROPDOWN_MENU_ITEM_CLASS_NAMES, tone === "danger" && "text-danger", className);
  if (href) {
    return (
      <MenuItem disabled={isDisabled}>
        <Link href={href} className={itemClassName}>
          {icon}
          {children}
        </Link>
      </MenuItem>
    );
  }
  return (
    <MenuItem disabled={isDisabled}>
      <button type="button" onClick={onSelect} className={itemClassName}>
        {icon}
        {children}
      </button>
    </MenuItem>
  );
}

/**
 * A thin line between groups of dropdown items.
 *
 * @example
 * <DropdownMenuDivider />
 */
export function DropdownMenuDivider({ className }: { className?: string }) {
  return <MenuSeparator className={mergeClassNames("my-2 h-px bg-surface-strong/60", className)} />;
}

/**
 * A group of dropdown items with a small header, such as "Export tools".
 *
 * @example
 * <DropdownMenuGroup title="Export tools">
 *   <DropdownMenuItem>Print</DropdownMenuItem>
 * </DropdownMenuGroup>
 */
export function DropdownMenuGroup({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <MenuSection className={className}>
      <MenuHeading className="p-2 font-medium">{title}</MenuHeading>
      {children}
    </MenuSection>
  );
}
