import { describe, expect, it } from "vitest";
import { BREADCRUMB_MAX_ITEMS, collapseBreadcrumbTrail } from "@/lib/client/breadcrumb";

const items = [
  { label: "Home", href: "/storage/home" },
  { label: "notes", href: "/storage/home/notes" },
  { label: "2026", href: "/storage/home/notes/2026" },
  { label: "today.md", href: "/storage/home/notes/2026/today.md" },
];

describe("collapseBreadcrumbTrail", () => {
  it("keeps a trail that fits as clickable breadcrumbs", () => {
    expect(collapseBreadcrumbTrail(items, false)).toEqual({ kind: "full", items });
  });

  it("folds an overflowing trail to Back › … › current, keeping the full path", () => {
    const layout = collapseBreadcrumbTrail(items, true);
    expect(layout.kind).toBe("collapsed");
    if (layout.kind !== "collapsed") return;
    expect(layout.back).toEqual(items[2]);
    expect(layout.current).toEqual(items[3]);
    expect(layout.hidden).toEqual(items.slice(0, 3));
    expect(layout.fullPath).toBe("Home › notes › 2026 › today.md");
  });

  it("folds a very deep trail even when it would fit", () => {
    const deepItems = Array.from({ length: BREADCRUMB_MAX_ITEMS + 1 }, (_item, index) => ({
      label: `level${index}`,
      href: `/storage/home/${index}`,
    }));
    expect(collapseBreadcrumbTrail(deepItems, false).kind).toBe("collapsed");
    expect(collapseBreadcrumbTrail(deepItems.slice(0, BREADCRUMB_MAX_ITEMS), false).kind).toBe("full");
  });

  it("never folds a trail with nothing to go back to", () => {
    expect(collapseBreadcrumbTrail(items.slice(0, 1), true).kind).toBe("full");
    expect(collapseBreadcrumbTrail([], true)).toEqual({ kind: "full", items: [] });
  });
});
