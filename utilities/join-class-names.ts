import { clsx, type ClassValue } from "clsx";

/**
 * Joins class names without resolving Tailwind conflicts. Use it for the theme's shell class
 * lists, where two classes may set the same property on purpose and
 * `mergeClassNames` would drop one. Everywhere else, use `mergeClassNames`.
 *
 * @example
 * joinClassNames("side-menu group", SHELL_APPEARANCE.classNames.sideMenuFrame, isCollapsed && "side-menu--collapsed");
 */
export function joinClassNames(...classNames: ClassValue[]): string {
  return clsx(classNames);
}
