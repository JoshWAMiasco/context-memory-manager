"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { ArchiveRestore, EllipsisVertical, MonitorX, Search, Trash, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { DropdownMenu, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import { EmptyState } from "@/components/primitives/empty-state";
import { FormCheckbox } from "@/components/primitives/form-check";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormSelect } from "@/components/primitives/form-select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { announce, announceError, type ApplicationMode } from "@/components/explorer/explorer-context";
import { FileIcon } from "@/components/explorer/file-icon";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import type { TrashItem } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { useTrash, useTrashActions } from "@/lib/client/trash";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

dayjs.extend(relativeTime);

const EMPTY_BADGES = { isMemory: false, protection: "none", encrypted: false, versioned: false } as const;

type TrashAction = "restore" | "purge" | "os-trash";

/** "Move to Trash", "Move to Recycle Bin": the computer's trash by its name on this OS. */
function readComputerTrashLabel(): string {
  if (typeof navigator === "undefined") return "Move to computer trash";
  if (/Win/i.test(navigator.userAgent)) return "Move to Recycle Bin";
  if (/Mac/i.test(navigator.userAgent)) return "Move to macOS Trash";
  return "Move to computer trash";
}

function EmptyTrashModal({ storages, onClose }: { storages: { id: string; label: string }[]; onClose: () => void }) {
  const { emptyTrash } = useTrashActions();
  const [storageId, setStorageId] = useState("all");
  const [confirmText, setConfirmText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const submit = async () => {
    setErrorMessage(undefined);
    try {
      const { removed } = await emptyTrash.mutateAsync({ storageId, confirmText });
      announce(`Deleted ${removed} item${removed === 1 ? "" : "s"} for good`);
      onClose();
    } catch (emptyError) {
      setErrorMessage(
        emptyError instanceof ApiError && emptyError.code === "STEP_UP_REQUIRED"
          ? "The action was not confirmed."
          : emptyError instanceof Error
            ? emptyError.message
            : "Emptying the trash failed.",
      );
    }
  };
  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title="Empty trash">
      <div data-testid="empty-trash-dialog">
        <ModalBody className="flex flex-col gap-4">
          <FormErrorAlert message={errorMessage} />
          <p className="leading-relaxed text-foreground-muted">
            Everything in the trash is deleted for good. This can&apos;t be undone.
          </p>
          <div>
            <FormLabel htmlFor="empty-trash-scope">Which trash</FormLabel>
            <FormSelect
              id="empty-trash-scope"
              value={storageId}
              onChange={(changeEvent) => setStorageId(changeEvent.target.value)}
              options={[
                { label: "All storages", value: "all" },
                ...storages.map((storage) => ({ label: storage.label, value: storage.id })),
              ]}
            />
          </div>
          <div>
            <FormLabel htmlFor="empty-trash-confirm">Type EMPTY to confirm</FormLabel>
            <FormInput
              id="empty-trash-confirm"
              value={confirmText}
              autoComplete="off"
              onChange={(changeEvent) => setConfirmText(changeEvent.target.value)}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Cancel</ModalCloseButton>
          <Button
            variant="danger"
            disabled={confirmText !== "EMPTY" || emptyTrash.isPending}
            onClick={() => void submit()}
          >
            {emptyTrash.isPending ? "Deleting…" : "Empty trash"}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/**
 * The Trash page: every deleted item the user can see, with a storage filter and name
 * search, restore, delete permanently (with step-up), move to the computer's trash (desktop only),
 * per-row menus and "Empty trash", which needs the word EMPTY.
 *
 * @example
 * <TrashTable mode="desktop" autoPurgeDays={30} />
 */
export function TrashTable({ mode, autoPurgeDays }: { mode: ApplicationMode; autoPurgeDays: number }) {
  const { data: trash, isLoading, error } = useTrash();
  const { restoreItems, purgeItems, moveToComputerTrash } = useTrashActions();
  const [storageFilter, setStorageFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingPurge, setPendingPurge] = useState<string[]>();
  const [isEmptyOpen, setIsEmptyOpen] = useState(false);
  const computerTrashLabel = readComputerTrashLabel();

  const items = trash?.items ?? [];
  const storages = [
    ...new Map(items.map((item) => [item.storageId, { id: item.storageId, label: item.storageLabel }])).values(),
  ];
  const visibleItems = items.filter(
    (item) =>
      (storageFilter === "all" || item.storageId === storageFilter) &&
      item.name.toLowerCase().includes(searchText.trim().toLowerCase()),
  );
  const selectedVisibleIds = visibleItems.filter((item) => selectedIds.has(item.id)).map((item) => item.id);
  const isAllSelected = visibleItems.length > 0 && selectedVisibleIds.length === visibleItems.length;

  const runAction = async (action: TrashAction, itemIds: string[]) => {
    if (itemIds.length === 0) return;
    const noun = `${itemIds.length} item${itemIds.length === 1 ? "" : "s"}`;
    try {
      if (action === "restore") {
        await restoreItems.mutateAsync(itemIds);
        announce(`Restored ${noun}`);
      } else if (action === "purge") {
        await purgeItems.mutateAsync(itemIds);
        announce(`Deleted ${noun} for good`);
      } else {
        await moveToComputerTrash.mutateAsync(itemIds);
        announce(`Moved ${noun} to the computer's trash`);
      }
      setSelectedIds((previousIds) => new Set([...previousIds].filter((itemId) => !itemIds.includes(itemId))));
    } catch (actionError) {
      announceError("That didn't work", actionError);
      throw actionError;
    }
  };

  const rowActions = (item: TrashItem) => (
    <DropdownMenu
      trigger={<EllipsisVertical className="h-4 w-4" aria-hidden />}
      triggerLabel={`Actions for ${item.name}`}
      triggerClassName="cursor-pointer p-1 text-foreground-subtle hover:text-foreground"
    >
      <DropdownMenuItem
        icon={<ArchiveRestore className="mr-2 h-4 w-4" />}
        onSelect={() => void runAction("restore", [item.id]).catch(() => undefined)}
      >
        Restore
      </DropdownMenuItem>
      <DropdownMenuItem
        icon={<Trash2 className="mr-2 h-4 w-4" />}
        tone="danger"
        onSelect={() => setPendingPurge([item.id])}
      >
        Delete permanently
      </DropdownMenuItem>
      {mode === "desktop" && (
        <DropdownMenuItem
          icon={<MonitorX className="mr-2 h-4 w-4" />}
          onSelect={() => void runAction("os-trash", [item.id]).catch(() => undefined)}
        >
          {computerTrashLabel}
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-5" data-testid="trash-page">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="font-display text-xl font-medium">Trash</h1>
          <p className="mt-1 text-sm text-foreground-muted" data-testid="trash-summary">
            {formatFileSize(trash?.totalSize ?? 0)} in {items.length} item{items.length === 1 ? "" : "s"}.{" "}
            {autoPurgeDays > 0
              ? `Items older than ${autoPurgeDays} day${autoPurgeDays === 1 ? "" : "s"} are deleted automatically.`
              : "Items stay until you delete them (Settings › General can delete old items automatically)."}
          </p>
        </div>
        <Button
          variant="outline-danger"
          disabled={items.length === 0}
          onClick={() => setIsEmptyOpen(true)}
          leadingIcon={<Trash className="mr-2 h-4 w-4" />}
        >
          Empty trash
        </Button>
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line/60 p-4">
          <FormSelect
            aria-label="Storage"
            className="w-48"
            value={storageFilter}
            onChange={(changeEvent) => setStorageFilter(changeEvent.target.value)}
            options={[
              { label: "All storages", value: "all" },
              ...storages.map((storage) => ({ label: storage.label, value: storage.id })),
            ]}
          />
          <div className="relative w-64">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <FormInput
              aria-label="Search by name"
              placeholder="Search by name"
              className="pl-9"
              value={searchText}
              onChange={(changeEvent) => setSearchText(changeEvent.target.value)}
            />
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline-primary"
              size="small"
              disabled={selectedVisibleIds.length === 0}
              onClick={() => void runAction("restore", selectedVisibleIds).catch(() => undefined)}
            >
              Restore
            </Button>
            <Button
              variant="outline-danger"
              size="small"
              disabled={selectedVisibleIds.length === 0}
              onClick={() => setPendingPurge(selectedVisibleIds)}
            >
              Delete permanently
            </Button>
            {mode === "desktop" && (
              <Button
                variant="outline-secondary"
                size="small"
                disabled={selectedVisibleIds.length === 0}
                onClick={() => void runAction("os-trash", selectedVisibleIds).catch(() => undefined)}
                data-testid="bulk-os-trash"
              >
                {computerTrashLabel}
              </Button>
            )}
          </div>
        </div>

        {error && <p className="p-5 text-danger">{error.message}</p>}
        {isLoading && <LoadingSkeleton rows={4} label="Loading the trash…" className="p-5" />}
        {!isLoading && !error && visibleItems.length === 0 && (
          <EmptyState
            className="py-16"
            icon={<Trash2 className="h-10 w-10 stroke-[1]" />}
            title={items.length === 0 ? "Trash is empty" : "Nothing matches"}
            description={
              items.length === 0
                ? "Deleted files and folders stay here until you remove them."
                : "Try another storage or name."
            }
          />
        )}
        {visibleItems.length > 0 && (
          <div className="overflow-x-auto">
            <Table size="small" isHoverable>
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="w-10">
                    <FormCheckbox
                      aria-label="Select all"
                      checked={isAllSelected}
                      onChange={(changeEvent) =>
                        setSelectedIds(
                          changeEvent.target.checked ? new Set(visibleItems.map((item) => item.id)) : new Set(),
                        )
                      }
                    />
                  </TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Original location</TableHeaderCell>
                  <TableHeaderCell>Deleted</TableHeaderCell>
                  <TableHeaderCell>Deleted by</TableHeaderCell>
                  <TableHeaderCell className="text-right">Size</TableHeaderCell>
                  <TableHeaderCell className="w-10" />
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleItems.map((item) => (
                  <TableRow key={item.id} data-testid={`trash-row-${item.name}`}>
                    <TableCell>
                      <FormCheckbox
                        aria-label={`Select ${item.name}`}
                        checked={selectedIds.has(item.id)}
                        onChange={(changeEvent) =>
                          setSelectedIds((previousIds) => {
                            const nextIds = new Set(previousIds);
                            if (changeEvent.target.checked) nextIds.add(item.id);
                            else nextIds.delete(item.id);
                            return nextIds;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <FileIcon
                          entry={{
                            name: item.name,
                            type: item.isDir ? "directory" : "file",
                            badges: { ...EMPTY_BADGES, isMemory: item.memory },
                          }}
                        />
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground-muted">
                      {item.storageLabel} / {item.originalPath}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span title={dayjs(item.deletedAt).format("MMMM D, YYYY HH:mm:ss")}>
                        {dayjs(item.deletedAt).fromNow()}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground-muted">{item.deletedBy ?? "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatFileSize(item.size)}</TableCell>
                    <TableCell>{rowActions(item)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={pendingPurge !== undefined}
        onOpenChange={(isOpen) => !isOpen && setPendingPurge(undefined)}
        title={`Delete ${pendingPurge?.length ?? 0} item${pendingPurge?.length === 1 ? "" : "s"} permanently?`}
        confirmLabel="Delete permanently"
        confirmVariant="danger"
        testId="purge-dialog"
        onConfirm={() => runAction("purge", pendingPurge ?? [])}
      >
        They are removed from the disk for good. This can&apos;t be undone.
      </ConfirmDialog>
      {isEmptyOpen && <EmptyTrashModal storages={storages} onClose={() => setIsEmptyOpen(false)} />}
    </div>
  );
}
