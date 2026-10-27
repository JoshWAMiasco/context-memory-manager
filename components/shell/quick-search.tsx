"use client";

import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import {
  ArchiveRestore,
  FileText,
  Folder,
  LayoutGrid,
  LoaderCircle,
  Search,
  SearchX,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { StorageKindIcon } from "@/components/icons/storage-kind-icon";
import type { StorageSummary } from "@/lib/api-types";
import { MINIMUM_SEARCH_LENGTH, useStorageSearch, useStorages } from "@/lib/client/fs";
import { buildStorageHref, parseStorageHref } from "@/lib/client/routes";
import { isCommandShortcut, useShortcutLabel } from "@/lib/client/shortcuts";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** ⌘K (Ctrl+K elsewhere) opens quick search. */
const QUICK_SEARCH_SHORTCUT = "Mod-K";

const openListeners = new Set<() => void>();

/**
 * Opens quick search from elsewhere, such as the mobile bottom bar.
 *
 * @example
 * <button onClick={openQuickSearch}>Search</button>
 */
export function openQuickSearch(): void {
  for (const listener of openListeners) listener();
}

interface SearchItem {
  key: string;
  title: string;
  subtitle?: string;
  href?: string;
  icon: ReactNode;
}

interface SearchGroup {
  title: string;
  items: SearchItem[];
  footer?: ReactNode;
}

const PAGE_LINKS: { title: string; href: string; icon: LucideIcon }[] = [
  { title: "Drives", href: "/", icon: LayoutGrid },
  { title: "Backup", href: "/backup", icon: ArchiveRestore },
  { title: "Trash", href: "/trash", icon: Trash2 },
  { title: "Settings", href: "/settings", icon: Settings },
];

const ITEM_ICON_CLASS_NAMES = "h-4 w-4 flex-none stroke-[1.3]";

function describeStorage(storage: StorageSummary, isCurrent: boolean): string {
  const parts: string[] = [];
  if (isCurrent) parts.push("Open now");
  if (!storage.available) parts.push("Not mounted");
  else if (storage.size && storage.used !== undefined) {
    parts.push(`${formatFileSize(storage.size - storage.used)} free of ${formatFileSize(storage.size)}`);
  }
  if (storage.access === "read") parts.push("Read only");
  return parts.join(" · ");
}

function toStorageItem(storage: StorageSummary, currentStorageId: string | undefined): SearchItem {
  return {
    key: `storage:${storage.id}`,
    title: storage.label,
    subtitle: describeStorage(storage, storage.id === currentStorageId),
    href: storage.available ? buildStorageHref(storage.id) : undefined,
    icon: <StorageKindIcon kind={storage.kind} className={ITEM_ICON_CLASS_NAMES} />,
  };
}

function useSearchGroups(searchQuery: string): { groups: SearchGroup[]; isSearchingFiles: boolean } {
  const currentLocation = parseStorageHref(usePathname());
  const { data: storages = [] } = useStorages();
  const currentStorage = storages.find((storage) => storage.id === currentLocation?.storageId);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const { data: fileResults, isFetching } = useStorageSearch(currentStorage?.id, searchQuery);

  const pageItems = PAGE_LINKS.filter((pageLink) => pageLink.title.toLowerCase().includes(normalizedQuery)).map(
    (pageLink): SearchItem => ({
      key: `page:${pageLink.href}`,
      title: pageLink.title,
      href: pageLink.href,
      icon: <pageLink.icon className={ITEM_ICON_CLASS_NAMES} />,
    }),
  );
  const storageItems = storages
    .filter((storage) => storage.label.toLowerCase().includes(normalizedQuery))
    .toSorted((first, second) => Number(second.available) - Number(first.available))
    .map((storage) => toStorageItem(storage, currentStorage?.id));
  const groups: SearchGroup[] = [{ title: "Drives", items: storageItems }];

  const hasFileQuery = currentStorage !== undefined && normalizedQuery.length >= MINIMUM_SEARCH_LENGTH;
  const isCurrentResult = fileResults?.query.trim().toLowerCase() === normalizedQuery;
  if (hasFileQuery && fileResults) {
    groups.push({
      title: `In this drive (${currentStorage.label})`,
      items: fileResults.matches.map((match) => {
        const slashIndex = match.path.lastIndexOf("/");
        return {
          key: `file:${match.path}`,
          title: match.name,
          subtitle: slashIndex === -1 ? currentStorage.label : match.path.slice(0, slashIndex),
          href: buildStorageHref(currentStorage.id, match.path),
          icon:
            match.type === "directory" ? (
              <Folder className={ITEM_ICON_CLASS_NAMES} />
            ) : (
              <FileText className={ITEM_ICON_CLASS_NAMES} />
            ),
        };
      }),
      footer:
        isCurrentResult && !fileResults.isComplete ? (
          <div className="px-2 pt-2 text-xs text-foreground-subtle">
            Showing the first matches. Type more of the name to narrow it down.
          </div>
        ) : undefined,
    });
  }
  groups.push({ title: "Go to", items: pageItems });
  return {
    groups: groups.filter((group) => group.items.length > 0),
    isSearchingFiles: hasFileQuery && (isFetching || !isCurrentResult),
  };
}

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { groups, isSearchingFiles } = useSearchGroups(searchQuery);
  const items = groups.flatMap((group) => group.items);
  const selectedIndex = Math.min(activeIndex, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const openItem = (searchItem: SearchItem | undefined) => {
    if (!searchItem?.href) return;
    onClose();
    router.push(searchItem.href);
  };
  const handleKeyDown = (keyEvent: ReactKeyboardEvent<HTMLInputElement>) => {
    if (keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowUp") {
      keyEvent.preventDefault();
      const step = keyEvent.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((selectedIndex + step + items.length) % Math.max(1, items.length));
    } else if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      openItem(items[selectedIndex]);
    }
  };

  let itemIndex = -1;
  return (
    <DialogPanel
      transition
      className="relative mx-auto my-2 w-[95%] transition-transform data-closed:scale-95 sm:mt-32 sm:w-[600px] lg:w-[700px]"
      data-testid="quick-search"
    >
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex w-12 items-center justify-center">
          {isSearchingFiles ? (
            <LoaderCircle className="-mr-1.5 h-5 w-5 animate-spin stroke-[1] text-foreground-muted" />
          ) : (
            <Search className="-mr-1.5 h-5 w-5 stroke-[1] text-foreground-muted" />
          )}
        </div>
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-search-results"
          aria-activedescendant={items[selectedIndex] ? `quick-search-${selectedIndex}` : undefined}
          aria-label="Search drives, folders and files"
          value={searchQuery}
          onChange={(changeEvent) => {
            setSearchQuery(changeEvent.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search drives, folders and files…"
          data-testid="quick-search-input"
          className="w-full rounded-lg border-0 border-line py-3.5 pr-14 pl-12 text-base shadow-lg transition duration-200 ease-in-out placeholder:text-foreground-subtle/90 focus:ring-0"
        />
        <div className="absolute inset-y-0 right-0 flex w-14 items-center">
          <div className="mr-auto rounded-box border bg-surface-muted px-2 py-1 text-xs text-foreground-muted/80">
            ESC
          </div>
        </div>
      </div>
      <div
        ref={listRef}
        id="quick-search-results"
        role="listbox"
        aria-label="Results"
        className="relative z-10 mt-1 max-h-[468px] overflow-y-auto rounded-lg bg-surface pb-1 shadow-lg sm:max-h-[560px]"
      >
        {groups.length === 0 && !isSearchingFiles ? (
          <div className="flex flex-col items-center justify-center pt-16 pb-20" data-testid="quick-search-empty">
            <SearchX className="h-16 w-16 fill-brand/5 stroke-[0.5] text-brand/20" />
            <div className="mt-5 font-display text-xl font-medium">Nothing found</div>
            <div className="mt-3 w-2/3 text-center leading-relaxed text-foreground-muted">
              No drive, page or file matches <span className="font-medium italic">&quot;{searchQuery}&quot;</span>.
            </div>
          </div>
        ) : (
          groups.map((group, groupIndex) => (
            <div
              key={group.title}
              role="group"
              aria-label={group.title}
              className={mergeClassNames("px-4 py-3", groupIndex > 0 && "border-t border-dashed")}
            >
              <div className="px-2 text-xs text-foreground-muted uppercase">{group.title}</div>
              <div className="mt-2 flex flex-col gap-0.5">
                {group.items.map((searchItem) => {
                  itemIndex += 1;
                  const optionIndex = itemIndex;
                  const isActive = optionIndex === selectedIndex;
                  return (
                    <div
                      key={searchItem.key}
                      id={`quick-search-${optionIndex}`}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={!searchItem.href}
                      data-active={isActive}
                      data-testid={`quick-search-item-${searchItem.key}`}
                      onMouseMove={() => setActiveIndex(optionIndex)}
                      onClick={() => openItem(searchItem)}
                      className={mergeClassNames(
                        "flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5",
                        isActive && "border-line bg-surface-subtle/80",
                        !searchItem.href && "cursor-default opacity-60",
                      )}
                    >
                      <span className="text-brand">{searchItem.icon}</span>
                      <span className="truncate font-medium">{searchItem.title}</span>
                      {searchItem.subtitle && (
                        <span className="ml-auto truncate pl-3 text-xs text-foreground-muted">
                          {searchItem.subtitle}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {group.footer}
            </div>
          ))
        )}
      </div>
    </DialogPanel>
  );
}

/**
 * Quick search (⌘K / Ctrl+K): switch to another drive,
 * jump to Backup, Trash or Settings, or find a file or folder by name in the open drive. Arrow
 * keys move through the results and Enter opens one. Shows a search bar on wide screens and an
 * icon button on narrow ones.
 *
 * @example
 * <QuickSearch triggerClassName={classNames.searchTrigger} iconButtonClassName={classNames.actionButton} />
 */
export function QuickSearch({
  triggerClassName,
  iconButtonClassName,
}: {
  triggerClassName?: string;
  iconButtonClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const searchShortcutLabel = useShortcutLabel(QUICK_SEARCH_SHORTCUT);

  useEffect(() => {
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (!isCommandShortcut(keyEvent, "k")) return;
      keyEvent.preventDefault();
      setIsOpen(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    const open = () => setIsOpen(true);
    openListeners.add(open);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      openListeners.delete(open);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={mergeClassNames("hidden md:flex", triggerClassName)}
        data-testid="quick-search-trigger"
      >
        <Search className="h-[18px] w-[18px] flex-none stroke-[1]" />
        <span className="mr-auto ml-2.5 truncate">Search drives and files…</span>
        <kbd className="font-sans text-xs">{searchShortcutLabel}</kbd>
      </button>
      <button
        type="button"
        aria-label="Search drives and files"
        onClick={() => setIsOpen(true)}
        className={mergeClassNames("cursor-pointer md:hidden", iconButtonClassName)}
      >
        <Search className="h-[18px] w-[18px] stroke-[1.3]" />
      </button>
      <Dialog open={isOpen} onClose={() => setIsOpen(false)} className="relative z-[60]">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-canvas/80 backdrop-blur-[2px] transition-opacity duration-100 data-closed:opacity-0"
        />
        <div className="fixed inset-0 overflow-y-auto">
          {isOpen && <QuickSearchDialog onClose={() => setIsOpen(false)} />}
        </div>
      </Dialog>
    </>
  );
}
