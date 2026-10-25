"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStorages } from "@/lib/client/fs";
import { buildStorageHref, parseStorageHref } from "@/lib/client/routes";

export interface BreadcrumbTrailClassNames {
  breadcrumbList: string;
  breadcrumbItem: string;
  breadcrumbCurrentItem: string;
}

interface BreadcrumbItem {
  label: string;
  href?: string;
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
 * "Drives › segment › segment" for the current route; on storage pages "Drives › storage › folder
 * › file" with links. The theme styles the list and the chevron separators
 * (`SHELL_APPEARANCE.classNames`).
 *
 * @example
 * <BreadcrumbTrail classNames={SHELL_APPEARANCE.classNames} />
 */
export function BreadcrumbTrail({ classNames }: { classNames: BreadcrumbTrailClassNames }) {
  const breadcrumbItems = useBreadcrumbItems(usePathname());
  return (
    <nav aria-label="breadcrumb" className="hidden min-w-0 flex-1 overflow-hidden xl:block" data-testid="breadcrumb">
      <ol className={classNames.breadcrumbList}>
        <li>
          <Link href="/">Drives</Link>
        </li>
        {breadcrumbItems.map((breadcrumbItem, itemIndex) => {
          const isCurrent = itemIndex === breadcrumbItems.length - 1;
          return (
            <li
              key={`${itemIndex}-${breadcrumbItem.label}`}
              aria-current={isCurrent ? "page" : undefined}
              className={isCurrent ? classNames.breadcrumbCurrentItem : classNames.breadcrumbItem}
            >
              {breadcrumbItem.href && !isCurrent ? (
                <Link href={breadcrumbItem.href}>{breadcrumbItem.label}</Link>
              ) : (
                breadcrumbItem.label
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
