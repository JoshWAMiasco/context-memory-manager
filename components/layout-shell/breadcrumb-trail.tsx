"use client";

import { ArrowLeft, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { collapseBreadcrumbTrail, type BreadcrumbItem } from "@/lib/client/breadcrumb";
import { useStorages } from "@/lib/client/fs";
import { buildStorageHref, parseStorageHref } from "@/lib/client/routes";

export interface BreadcrumbTrailClassNames {
  breadcrumbList: string;
  breadcrumbItem: string;
  breadcrumbCurrentItem: string;
}

function decodeSegment(pathSegment: string): string {
  try {
    return decodeURIComponent(pathSegment);
  } catch {
    return pathSegment;
  }
}

/** Page names for route segments outside the storages ("settings" reads "Settings"). */
const PAGE_NAMES: Record<string, string> = {
  trash: "Trash",
  backup: "Backup",
  settings: "Settings",
  general: "General",
  users: "Users",
  security: "Security",
  storages: "Storages",
  encryption: "Encryption",
  about: "About",
};

function readPageName(pathSegment: string): string {
  const decodedSegment = decodeSegment(pathSegment);
  return PAGE_NAMES[decodedSegment] ?? decodedSegment.charAt(0).toUpperCase() + decodedSegment.slice(1);
}

/**
 * Storage pages read as "Storage label › folder › file", each folder a link; other pages by name,
 * the parent pages as links ("Settings › Users").
 */
function useBreadcrumbItems(currentPathname: string): BreadcrumbItem[] {
  const { data: storages } = useStorages();
  const storageLocation = parseStorageHref(currentPathname);
  if (!storageLocation) {
    const pageSegments = currentPathname.split("/").filter(Boolean);
    return pageSegments.map((pathSegment, segmentIndex) => ({
      label: readPageName(pathSegment),
      href: `/${pageSegments.slice(0, segmentIndex + 1).join("/")}`,
    }));
  }
  const storageLabel = storages?.find((storage) => storage.id === storageLocation.storageId)?.label ?? "Storage";
  const pathSegments = storageLocation.path.split("/").filter(Boolean);
  return [
    { label: storageLabel, href: buildStorageHref(storageLocation.storageId) },
    ...pathSegments.map((pathSegment, segmentIndex) => ({
      label: pathSegment,
      href: buildStorageHref(storageLocation.storageId, pathSegments.slice(0, segmentIndex + 1).join("/")),
    })),
  ];
}

/**
 * Whether the full trail (rendered invisibly in `measuredElement`, a clipped box) is wider than
 * `roomElement`, kept current as either resizes or the path changes.
 */
function useTrailOverflow(
  roomElement: HTMLElement | null,
  measuredElement: HTMLElement | null,
  pathKey: string,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);
  useEffect(() => {
    if (!roomElement || !measuredElement) return;
    const measure = () => setIsOverflowing(measuredElement.scrollWidth > roomElement.clientWidth);
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(roomElement);
    resizeObserver.observe(measuredElement);
    return () => resizeObserver.disconnect();
  }, [measuredElement, pathKey, roomElement]);
  return isOverflowing;
}

function FullTrail({
  items,
  classNames,
  isMeasuring = false,
}: {
  items: readonly BreadcrumbItem[];
  classNames: BreadcrumbTrailClassNames;
  isMeasuring?: boolean;
}) {
  return (
    <>
      <li>
        <Link href="/" tabIndex={isMeasuring ? -1 : undefined}>
          Drives
        </Link>
      </li>
      {items.map((breadcrumbItem, itemIndex) => {
        const isCurrent = itemIndex === items.length - 1;
        return (
          <li
            key={`${itemIndex}-${breadcrumbItem.label}`}
            aria-current={isCurrent && !isMeasuring ? "page" : undefined}
            className={isCurrent ? classNames.breadcrumbCurrentItem : classNames.breadcrumbItem}
          >
            {breadcrumbItem.href && !isCurrent ? (
              <Link href={breadcrumbItem.href} tabIndex={isMeasuring ? -1 : undefined}>
                {breadcrumbItem.label}
              </Link>
            ) : (
              breadcrumbItem.label
            )}
          </li>
        );
      })}
    </>
  );
}

/**
 * "Drives › segment › segment" for the current route; on storage pages "Drives › storage › folder
 * › file" with links. A trail too deep or too wide for the bar folds to "Drives › ← Back › … ›
 * current folder": Back goes up one level, the … menu lists the whole path, and the current
 * item's tooltip spells it out, so nothing is cut off mid-word. The theme styles the list and the
 * chevron separators (`SHELL_APPEARANCE.classNames`).
 *
 * @example
 * <BreadcrumbTrail classNames={SHELL_APPEARANCE.classNames} />
 */
export function BreadcrumbTrail({ classNames }: { classNames: BreadcrumbTrailClassNames }) {
  const pathname = usePathname();
  const breadcrumbItems = useBreadcrumbItems(pathname);
  const [navElement, setNavElement] = useState<HTMLElement | null>(null);
  const [measuredElement, setMeasuredElement] = useState<HTMLOListElement | null>(null);
  const isOverflowing = useTrailOverflow(navElement, measuredElement, pathname);
  const trail = collapseBreadcrumbTrail(breadcrumbItems, isOverflowing);
  return (
    <nav
      ref={setNavElement}
      aria-label="breadcrumb"
      className="relative hidden min-w-0 flex-1 overflow-hidden xl:block"
      data-testid="breadcrumb"
      data-collapsed={trail.kind === "collapsed" || undefined}
    >
      {/* The full trail, measured in a clipped 0×0 box so it never widens the bar or shows. */}
      <div aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 h-0 w-0 overflow-hidden">
        <ol ref={setMeasuredElement} className={`${classNames.breadcrumbList} w-max flex-nowrap whitespace-nowrap`}>
          <FullTrail items={breadcrumbItems} classNames={classNames} isMeasuring />
        </ol>
      </div>
      <ol className={`${classNames.breadcrumbList} flex-nowrap whitespace-nowrap`}>
        {trail.kind === "full" ? (
          <FullTrail items={trail.items} classNames={classNames} />
        ) : (
          <>
            <li>
              <Link href="/">Drives</Link>
            </li>
            <li className={classNames.breadcrumbItem}>
              <Link
                href={trail.back.href ?? "/"}
                aria-label={`Back to ${trail.back.label}`}
                title={`Back to ${trail.back.label}`}
                className="inline-flex items-center gap-1"
                data-testid="breadcrumb-back"
              >
                <ArrowLeft className="h-3.5 w-3.5 stroke-[1.5]" aria-hidden />
                Back
              </Link>
            </li>
            <li className={classNames.breadcrumbItem}>
              <DropdownMenu
                trigger={<Ellipsis className="h-4 w-4 stroke-[1.5]" aria-hidden />}
                triggerLabel="Show the full path"
                triggerClassName="rounded px-1 hover:bg-surface-muted"
                placement="bottom start"
                menuClassName="w-72 max-w-[calc(100vw-2rem)]"
              >
                {trail.hidden.map((hiddenItem, itemIndex) =>
                  hiddenItem.href ? (
                    <DropdownMenuItem key={`${itemIndex}-${hiddenItem.label}`} href={hiddenItem.href}>
                      <span className="truncate" style={{ paddingLeft: `${itemIndex * 0.75}rem` }}>
                        {hiddenItem.label}
                      </span>
                    </DropdownMenuItem>
                  ) : (
                    <div key={`${itemIndex}-${hiddenItem.label}`} className="truncate p-2 text-foreground-muted">
                      {hiddenItem.label}
                    </div>
                  ),
                )}
              </DropdownMenu>
            </li>
            <li
              aria-current="page"
              className={`${classNames.breadcrumbCurrentItem} min-w-0 truncate`}
              title={trail.fullPath}
              data-testid="breadcrumb-current"
            >
              {trail.current.label}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
