/*
 * How the top bar's path trail folds when it is too deep or too wide for its room: the middle
 * segments give way to a Back control and an overflow menu, the current folder stays in view.
 * Isomorphic: no DOM here, so it can be tested on its own.
 */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Deeper trails fold even when they would fit: past this many items the links stop being useful. */
export const BREADCRUMB_MAX_ITEMS = 8;

export type BreadcrumbTrailLayout =
  | { kind: "full"; items: BreadcrumbItem[] }
  | {
      kind: "collapsed";
      /** Where Back goes: the item before the current one. */
      back: BreadcrumbItem;
      /** Everything but the current item, for the overflow menu (the full path stays reachable). */
      hidden: BreadcrumbItem[];
      current: BreadcrumbItem;
      /** "Storage › folder › file", for the tooltip. */
      fullPath: string;
    };

/**
 * Folds `items` to Back › … › current when the trail overflows its room or is deeper than
 * `BREADCRUMB_MAX_ITEMS`; a trail of one item, or one that fits, stays as it is.
 *
 * @example
 * collapseBreadcrumbTrail(items, measuredWidth > availableWidth);
 */
export function collapseBreadcrumbTrail(
  items: readonly BreadcrumbItem[],
  isOverflowing: boolean,
): BreadcrumbTrailLayout {
  const current = items.at(-1);
  const back = items.at(-2);
  if (!current || !back || (!isOverflowing && items.length <= BREADCRUMB_MAX_ITEMS))
    return { kind: "full", items: [...items] };
  return {
    kind: "collapsed",
    back,
    hidden: items.slice(0, -1),
    current,
    fullPath: items.map((item) => item.label).join(" › "),
  };
}
