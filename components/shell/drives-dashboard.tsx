"use client";

import Link from "next/link";
import { ArchiveRestore, HardDrive, Plus, Search, Settings, Trash2, type LucideIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { ButtonLink } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import { EmptyState } from "@/components/primitives/empty-state";
import { FormInput } from "@/components/primitives/form-input";
import { ProgressBar } from "@/components/primitives/progress-bar";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { EjectShieldIcon } from "@/components/icons/cmm-icons";
import { StorageKindIcon } from "@/components/icons/storage-kind-icon";
import { useServerEvent } from "@/hooks/use-server-events";
import type { StorageKind, StorageSummary } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { useDriveActions, useStorages } from "@/lib/client/fs";
import { buildStorageHref } from "@/lib/client/routes";
import { useTrash } from "@/lib/client/trash";
import { mergeClassNames } from "@/utilities/merge-class-names";

const NEW_DRIVE_HIGHLIGHT_MILLISECONDS = 4000;

/** The filter box shows once there are this many storages. */
const FILTER_MINIMUM_STORAGES = 6;

const STORAGE_GROUPS: { title: string; kinds: readonly StorageKind[] }[] = [
  { title: "Internal storages", kinds: ["internal"] },
  { title: "External drives", kinds: ["external"] },
  { title: "USB / flash drives", kinds: ["usb"] },
];

const CARD_GRID_CLASS_NAMES = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4";

function describeCapacity(storage: StorageSummary): { text: string; title: string } | undefined {
  if (!storage.size || storage.used === undefined) return undefined;
  return {
    text: `${formatFileSize(storage.size - storage.used)} free of ${formatFileSize(storage.size)}`,
    title: `${formatFileSize(storage.used)} of ${formatFileSize(storage.size)} used`,
  };
}

function DriveCard({
  storage,
  isHighlighted,
  onEject,
  onMount,
}: {
  storage: StorageSummary;
  isHighlighted: boolean;
  onEject: (storage: StorageSummary) => void;
  onMount: (storage: StorageSummary) => void;
}) {
  const capacity = storage.available ? describeCapacity(storage) : undefined;
  const details = [storage.fsType?.toUpperCase(), storage.access === "read" ? "Read only" : undefined].filter(Boolean);
  return (
    <Card
      className={mergeClassNames(
        "group/drive relative flex flex-col gap-4 p-5 transition-[border-color,box-shadow,background-color]",
        storage.available && "hover:border-brand/60 hover:shadow-lg",
        !storage.available && "opacity-75",
        isHighlighted && "bg-brand/10 ring-1 ring-brand/60 duration-1000",
      )}
      data-testid={`drive-card-${storage.id}`}
      title={capacity ? `${storage.label}: ${capacity.title}` : storage.label}
    >
      <div className="flex items-start gap-3.5">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-brand/30 bg-brand/10 text-brand">
          <StorageKindIcon kind={storage.kind} className="h-6 w-6 stroke-[1.2]" />
        </div>
        <div className="min-w-0 flex-1">
          {storage.available ? (
            <Link
              href={buildStorageHref(storage.id)}
              className="block truncate font-medium group-hover/drive:text-brand after:absolute after:inset-0 after:content-['']"
            >
              {storage.label}
            </Link>
          ) : (
            <div className="truncate font-medium">{storage.label}</div>
          )}
          <div className="mt-0.5 truncate text-xs text-foreground-subtle">
            {storage.available ? details.join(" · ") || "Ready" : "Not mounted"}
          </div>
        </div>
        {storage.canEject && (
          <button
            type="button"
            onClick={() => onEject(storage)}
            aria-label={`Eject ${storage.label}`}
            title={`Eject ${storage.label}`}
            className="relative z-10 flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-brand"
          >
            <EjectShieldIcon className="h-4 w-4" />
          </button>
        )}
        {storage.canMount && (
          <button
            type="button"
            onClick={() => onMount(storage)}
            className="relative z-10 flex-none cursor-pointer rounded-md border border-line-strong px-2.5 py-1 text-xs hover:border-brand hover:text-brand"
          >
            Mount
          </button>
        )}
      </div>
      {capacity && storage.size ? (
        <div>
          <div className="mb-1.5 text-xs text-foreground-muted" data-testid="storage-capacity">
            {capacity.text}
          </div>
          <ProgressBar value={storage.used ?? 0} maximum={storage.size} size="extra-small" />
        </div>
      ) : (
        <div className="text-xs text-foreground-subtle">
          {storage.available ? "Capacity unknown" : "Plug it in or mount it to open it."}
        </div>
      )}
    </Card>
  );
}

function SystemCard({
  href,
  title,
  description,
  icon: CardIcon,
  testId,
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  testId: string;
}) {
  return (
    <Card className="group/system relative flex items-center gap-3.5 p-4 transition-colors hover:border-brand/60">
      <CardIcon className="h-5 w-5 flex-none stroke-[1.2] text-brand" />
      <div className="min-w-0">
        <Link
          href={href}
          data-testid={testId}
          className="font-medium group-hover/system:text-brand after:absolute after:inset-0 after:content-['']"
        >
          {title}
        </Link>
        <div className="truncate text-xs text-foreground-subtle">{description}</div>
      </div>
    </Card>
  );
}

/**
 * The home page after sign-in: every storage the user can open as a card, grouped into internal
 * storages, external drives and USB / flash drives, live over drive events (a new drive is
 * highlighted for a moment), with free space, eject and mount. A filter box appears once there are
 * many. Backup, Trash and Settings sit below. Opening a card goes to that storage's explorer.
 *
 * @example
 * <DrivesDashboard isAdmin={user.role === "admin"} />
 */
export function DrivesDashboard({ isAdmin }: { isAdmin: boolean }) {
  const { data: storages = [], isLoading } = useStorages();
  const { data: trash } = useTrash();
  const { ejectDrive, mountDrive } = useDriveActions();
  const [filterText, setFilterText] = useState("");
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(new Set());
  const [ejectTarget, setEjectTarget] = useState<StorageSummary>();

  const highlightNewDrive = useCallback(({ storageId }: { storageId: string }) => {
    setHighlightedIds((previousIds) => new Set([...previousIds, storageId]));
    setTimeout(() => {
      setHighlightedIds(
        (previousIds) => new Set([...previousIds].filter((highlightedId) => highlightedId !== storageId)),
      );
    }, NEW_DRIVE_HIGHLIGHT_MILLISECONDS);
  }, []);
  useServerEvent("drive.added", highlightNewDrive);

  const mount = (storage: StorageSummary) => {
    mountDrive.mutate(storage.id, {
      onError: (mountError) =>
        showToastNotification({
          title: `Couldn't mount ${storage.label}`,
          tone: "error",
          description: mountError instanceof ApiError ? mountError.message : undefined,
        }),
    });
  };

  const normalizedFilter = filterText.trim().toLowerCase();
  const visibleStorages = storages.filter((storage) => storage.label.toLowerCase().includes(normalizedFilter));

  return (
    <div className="flex flex-col gap-8" data-testid="drives-dashboard">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="font-display text-xl font-medium">Drives</h1>
          <p className="mt-0.5 text-sm text-foreground-muted">
            {isLoading
              ? "Loading…"
              : `${storages.length} storage${storages.length === 1 ? "" : "s"}. Open one to browse and edit its files.`}
          </p>
        </div>
        {storages.length >= FILTER_MINIMUM_STORAGES && (
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 stroke-[1.3] text-foreground-subtle" />
            <FormInput
              type="search"
              value={filterText}
              onChange={(changeEvent) => setFilterText(changeEvent.target.value)}
              placeholder="Filter drives…"
              aria-label="Filter drives"
              className="pl-9"
              data-testid="drives-filter"
            />
          </div>
        )}
        {isAdmin && (
          <ButtonLink
            href="/settings/storages"
            variant="outline-secondary"
            leadingIcon={<Plus className="mr-1.5 h-4 w-4 stroke-[1.3]" />}
          >
            Add a storage
          </ButtonLink>
        )}
      </div>

      {!isLoading && storages.length === 0 && (
        <Card className="mx-auto w-full max-w-xl p-8" data-testid="no-storages">
          <EmptyState
            icon={<HardDrive className="h-10 w-10 stroke-[1]" />}
            title="No storages yet"
            description={
              isAdmin
                ? "Add a folder as a storage, or plug in a drive."
                : "No storage has been shared with you. Ask an admin to give you access."
            }
          />
        </Card>
      )}
      {storages.length > 0 && visibleStorages.length === 0 && (
        <p className="text-sm text-foreground-muted" data-testid="drives-filter-empty">
          No drive matches &quot;{filterText}&quot;.
        </p>
      )}

      {STORAGE_GROUPS.map((storageGroup) => {
        const groupStorages = visibleStorages.filter((storage) => storageGroup.kinds.includes(storage.kind));
        if (groupStorages.length === 0) return null;
        return (
          <section
            key={storageGroup.title}
            aria-label={storageGroup.title}
            data-testid={`storage-group-${storageGroup.kinds.join("-")}`}
          >
            <h2 className="mb-3 text-xs font-medium tracking-wide text-foreground-muted uppercase">
              {storageGroup.title}
            </h2>
            <div className={CARD_GRID_CLASS_NAMES}>
              {groupStorages.map((storage) => (
                <DriveCard
                  key={storage.id}
                  storage={storage}
                  isHighlighted={highlightedIds.has(storage.id)}
                  onEject={setEjectTarget}
                  onMount={mount}
                />
              ))}
            </div>
          </section>
        );
      })}

      <section aria-label="System">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-foreground-muted uppercase">System</h2>
        <div className={CARD_GRID_CLASS_NAMES}>
          <SystemCard
            href="/backup"
            title="Backup"
            description="Copy storages to drives, mirror them or keep snapshots"
            icon={ArchiveRestore}
            testId="dashboard-backup"
          />
          <SystemCard
            href="/trash"
            title="Trash"
            description={trash && trash.totalSize > 0 ? `${formatFileSize(trash.totalSize)} in the trash` : "Empty"}
            icon={Trash2}
            testId="menu-trash"
          />
          <SystemCard
            href="/settings"
            title="Settings"
            description="Storages, users, security and encryption"
            icon={Settings}
            testId="dashboard-settings"
          />
        </div>
      </section>

      <ConfirmDialog
        isOpen={ejectTarget !== undefined}
        onOpenChange={(isOpen) => !isOpen && setEjectTarget(undefined)}
        title={`Eject ${ejectTarget?.label ?? "drive"}?`}
        confirmLabel="Eject"
        testId="eject-dialog"
        onConfirm={async () => {
          if (!ejectTarget) return;
          await ejectDrive.mutateAsync(ejectTarget.id);
          showToastNotification({
            title: `${ejectTarget.label} ejected`,
            tone: "success",
            description: "You can unplug it now.",
          });
        }}
      >
        Files open from this drive close. Wait for the confirmation before you unplug it.
      </ConfirmDialog>
    </div>
  );
}
