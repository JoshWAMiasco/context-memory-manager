"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, FolderOpen, Pencil, Plus, Trash2, Users } from "lucide-react";
import { StorageKindIcon } from "@/components/icons/storage-kind-icon";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { Modal, ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { Badge } from "@/components/primitives/badge";
import { Button } from "@/components/primitives/button";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormSelect } from "@/components/primitives/form-select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { SettingsPanel, SettingsPanelFooter } from "@/components/page-sections/settings/settings-panel";
import { NameDialog } from "@/components/explorer/dialogs/name-dialog";
import { announce, announceError } from "@/components/explorer/explorer-context";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import type { RegisteredStorage, StorageAccessEntry } from "@/lib/api-types";
import { ROLE_LABELS } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";
import { pickFolder, useIsDesktopApp } from "@/lib/client/desktop";
import { QUERY_KEYS } from "@/lib/client/query-keys";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

const REGISTRY_QUERY_KEY = ["storages", "registry"] as const;
const ACCESS_LEVELS = ["none", "read", "write"] as const;
const ACCESS_LABELS = { none: "No access", read: "Read", write: "Read and write" } as const;

function readErrorMessage(requestError: unknown): string {
  if (requestError instanceof ApiError && requestError.code === "STEP_UP_REQUIRED")
    return "The change was not confirmed.";
  return requestError instanceof Error ? requestError.message : "Something went wrong.";
}

function StorageAccessDialog({ storage, onClose }: { storage: RegisteredStorage; onClose: () => void }) {
  const queryClient = useQueryClient();
  const accessQuery = useQuery({
    queryKey: ["storages", storage.id, "access"],
    queryFn: async () =>
      (await requestJson<{ access: StorageAccessEntry[] }>(`/api/storages/${encodeURIComponent(storage.id)}/access`))
        .access,
  });
  const [changedLevels, setChangedLevels] = useState<Record<string, StorageAccessEntry["level"]>>({});
  const [errorMessage, setErrorMessage] = useState<string>();
  const saveAccess = useMutation({
    mutationFn: (grants: { userId: string; level: StorageAccessEntry["level"] }[]) =>
      requestJson(`/api/storages/${encodeURIComponent(storage.id)}/access`, { method: "PUT", body: { grants } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["storages"] });
      announce(`Access to ${storage.label} saved`);
      onClose();
    },
    onError: (saveError) => setErrorMessage(readErrorMessage(saveError)),
  });
  const entries = accessQuery.data ?? [];
  const readLevel = (entry: StorageAccessEntry) => changedLevels[entry.userId] ?? entry.level;
  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Who can open ${storage.label}`} size="large">
      <div data-testid="storage-access-dialog">
        <ModalBody>
          <FormErrorAlert message={errorMessage} className="mb-4" />
          {accessQuery.isLoading && <LoadingSkeleton rows={3} label="Loading access…" />}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>Access</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.userId}>
                  <TableCell>
                    {entry.username} <span className="text-xs text-foreground-subtle">{ROLE_LABELS[entry.role]}</span>
                  </TableCell>
                  <TableCell>
                    {entry.role === "admin" ? (
                      <span className="text-foreground-muted">Admins can open every storage</span>
                    ) : (
                      <FormSelect
                        aria-label={`Access for ${entry.username}`}
                        size="small"
                        value={readLevel(entry)}
                        onChange={(changeEvent) =>
                          setChangedLevels((previousLevels) => ({
                            ...previousLevels,
                            [entry.userId]: changeEvent.target.value as StorageAccessEntry["level"],
                          }))
                        }
                        options={ACCESS_LEVELS.map((level) => ({
                          label:
                            entry.role === "viewer" && level === "write"
                              ? "Read (viewers can't write)"
                              : ACCESS_LABELS[level],
                          value: level,
                        }))}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ModalBody>
        <ModalFooter>
          <ModalCloseButton>Cancel</ModalCloseButton>
          <Button
            variant="primary"
            disabled={saveAccess.isPending}
            onClick={() =>
              saveAccess.mutate(
                entries
                  .filter((entry) => entry.role !== "admin")
                  .map((entry) => ({ userId: entry.userId, level: readLevel(entry) })),
              )
            }
          >
            Save access
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

type StorageDialog =
  | { kind: "access"; storage: RegisteredStorage }
  | { kind: "rename"; storage: RegisteredStorage }
  | { kind: "remove"; storage: RegisteredStorage };

function StorageRows({
  storages,
  onOpen,
  onToggleHidden,
}: {
  storages: RegisteredStorage[];
  onOpen: (dialog: StorageDialog) => void;
  onToggleHidden: (storage: RegisteredStorage) => void;
}) {
  return (
    <Table size="small" isHoverable>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Name</TableHeaderCell>
          <TableHeaderCell>Location</TableHeaderCell>
          <TableHeaderCell className="w-40 text-right">Actions</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {storages.map((storage) => {
          return (
            <TableRow key={storage.id} data-testid={`storage-row-${storage.label}`}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <StorageKindIcon kind={storage.kind} className="h-4 w-4 stroke-[1.25]" />
                  {storage.label}
                  {storage.hidden && <Badge tone="slate">Hidden</Badge>}
                  {storage.kind !== "internal" && !storage.isConnected && <Badge tone="secondary">Unplugged</Badge>}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs break-all text-foreground-muted">
                {storage.rootPath || "—"}
              </TableCell>
              <TableCell>
                <span className="flex justify-end gap-1">
                  <Button
                    size="small"
                    variant="outline-secondary"
                    aria-label={`Access to ${storage.label}`}
                    title="Who can open it"
                    onClick={() => onOpen({ kind: "access", storage })}
                  >
                    <Users className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="small"
                    variant="outline-secondary"
                    aria-label={`Rename ${storage.label}`}
                    title="Rename"
                    onClick={() => onOpen({ kind: "rename", storage })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="small"
                    variant="outline-secondary"
                    aria-label={storage.hidden ? `Show ${storage.label}` : `Hide ${storage.label}`}
                    title={storage.hidden ? "Show to users with access" : "Hide from everyone but admins"}
                    onClick={() => onToggleHidden(storage)}
                  >
                    {storage.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    size="small"
                    variant="outline-danger"
                    aria-label={`Remove ${storage.label}`}
                    title={storage.kind === "internal" ? "Unregister (files stay on disk)" : "Forget this drive"}
                    onClick={() => onOpen({ kind: "remove", storage })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The last segment of a picked folder path, POSIX or Windows, as the default storage name. */
function readFolderName(folderPath: string): string {
  return folderPath.split(/[\\/]/).findLast(Boolean) ?? folderPath;
}

/**
 * Settings › Storages: internal storages (add, rename, hide, unregister; files are
 * never touched), remembered external drives, who can open each storage, and whether new drives
 * are visible to everyone.
 *
 * @example
 * <StoragesSection mode="server" newDrivesVisibleTo="admins" />
 */
export function StoragesSection({
  mode,
  newDrivesVisibleTo,
}: {
  mode: "desktop" | "server";
  newDrivesVisibleTo: "admins" | "all";
}) {
  const queryClient = useQueryClient();
  const registryQuery = useQuery({
    queryKey: REGISTRY_QUERY_KEY,
    queryFn: async () =>
      (await requestJson<{ storages: RegisteredStorage[] }>("/api/storages?scope=registry")).storages,
  });
  const [dialog, setDialog] = useState<StorageDialog>();
  const [newRootPath, setNewRootPath] = useState("");
  const [newRootLabel, setNewRootLabel] = useState("");
  const [addError, setAddError] = useState<string>();
  const [visibility, setVisibility] = useState(newDrivesVisibleTo);
  const refreshStorages = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storages() });
  const isDesktop = useIsDesktopApp();
  const browseForFolder = async () => {
    const pickedPath = await pickFolder();
    if (!pickedPath) return;
    setNewRootPath(pickedPath);
    if (!newRootLabel.trim()) setNewRootLabel(readFolderName(pickedPath));
    setAddError(undefined);
  };

  const updateStorage = useMutation({
    mutationFn: ({ storageId, changes }: { storageId: string; changes: { label?: string; hidden?: boolean } }) =>
      requestJson(`/api/storages/${encodeURIComponent(storageId)}`, { method: "PATCH", body: changes }),
    onSettled: refreshStorages,
  });
  const addStorage = useMutation({
    mutationFn: () =>
      requestJson("/api/storages", { method: "POST", body: { path: newRootPath.trim(), label: newRootLabel.trim() } }),
    onSuccess: () => {
      announce(`${newRootLabel.trim()} added`);
      setNewRootPath("");
      setNewRootLabel("");
      setAddError(undefined);
    },
    onError: (addRootError) => setAddError(readErrorMessage(addRootError)),
    onSettled: refreshStorages,
  });
  const saveVisibility = useMutation({
    mutationFn: () =>
      requestJson("/api/settings/storage.newDrivesVisibleTo", { method: "PUT", body: { value: visibility } }),
    onSuccess: () => announce("New drive visibility saved"),
    onError: (saveError) => announceError("Couldn't save", saveError),
    onSettled: refreshStorages,
  });

  const storages = registryQuery.data ?? [];
  const internalStorages = storages.filter((storage) => storage.kind === "internal");
  const driveStorages = storages.filter((storage) => storage.kind !== "internal");
  const toggleHidden = (storage: RegisteredStorage) =>
    updateStorage.mutate(
      { storageId: storage.id, changes: { hidden: !storage.hidden } },
      { onError: (toggleError) => announceError("Couldn't change it", toggleError) },
    );

  const submitNewRoot = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!newRootPath.trim() || !newRootLabel.trim()) {
      setAddError("Enter a folder path and a name.");
      return;
    }
    addStorage.mutate();
  };

  return (
    <>
      <SettingsPanel title="Internal storages">
        <p className="mb-4 leading-relaxed text-foreground-muted">
          Folders on this {mode === "desktop" ? "computer" : "server"} that CCM shows as storages. Removing one only
          unregisters it; the files stay on disk.
        </p>
        {registryQuery.error && <FormErrorAlert message={registryQuery.error.message} className="mb-4" />}
        {internalStorages.length > 0 ? (
          <StorageRows storages={internalStorages} onOpen={setDialog} onToggleHidden={toggleHidden} />
        ) : (
          <p className="text-foreground-subtle">No internal storages yet.</p>
        )}
        <form
          onSubmit={submitNewRoot}
          className="mt-6 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          data-testid="add-storage-form"
          noValidate
        >
          <div>
            <FormLabel htmlFor="new-storage-path">Folder path {mode === "server" ? "on the server" : ""}</FormLabel>
            <div className="flex gap-2">
              <FormInput
                id="new-storage-path"
                placeholder={mode === "server" ? "/srv/ccm/notes" : "/Users/you/Documents"}
                value={newRootPath}
                onChange={(changeEvent) => setNewRootPath(changeEvent.target.value)}
              />
              {isDesktop && (
                <Button
                  variant="outline-secondary"
                  className="flex-none"
                  onClick={() => void browseForFolder()}
                  leadingIcon={<FolderOpen className="mr-1.5 h-4 w-4" />}
                  data-testid="storage-browse"
                >
                  Browse…
                </Button>
              )}
            </div>
          </div>
          <div>
            <FormLabel htmlFor="new-storage-label">Name</FormLabel>
            <FormInput
              id="new-storage-label"
              placeholder="Notes"
              value={newRootLabel}
              onChange={(changeEvent) => setNewRootLabel(changeEvent.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={addStorage.isPending}
            leadingIcon={<Plus className="mr-1.5 h-4 w-4" />}
          >
            Add storage
          </Button>
        </form>
        <FormErrorAlert message={addError} className="mt-3" />
      </SettingsPanel>

      <SettingsPanel title="External drives">
        <p className="mb-4 leading-relaxed text-foreground-muted">
          Drives CCM has seen. Their names and access are remembered while they are unplugged.
        </p>
        {driveStorages.length > 0 ? (
          <StorageRows storages={driveStorages} onOpen={setDialog} onToggleHidden={toggleHidden} />
        ) : (
          <p className="text-foreground-subtle">No drives yet. Plug one in and it appears on the Drives page.</p>
        )}
      </SettingsPanel>

      <SettingsPanel title="New drives">
        <div className="max-w-md">
          <FormLabel htmlFor="new-drives-visibility">New drives are visible to</FormLabel>
          <FormSelect
            id="new-drives-visibility"
            value={visibility}
            onChange={(changeEvent) => setVisibility(changeEvent.target.value as "admins" | "all")}
            options={[
              { label: "Admins only (grant access per drive)", value: "admins" },
              { label: "Everyone (editors can write, viewers can read)", value: "all" },
            ]}
          />
        </div>
        <SettingsPanelFooter>
          <Button variant="outline-primary" disabled={saveVisibility.isPending} onClick={() => saveVisibility.mutate()}>
            Save Changes
          </Button>
        </SettingsPanelFooter>
      </SettingsPanel>

      {dialog?.kind === "access" && (
        <StorageAccessDialog storage={dialog.storage} onClose={() => setDialog(undefined)} />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title={`Rename ${dialog.storage.label}`}
          label="Name"
          initialName={dialog.storage.label}
          submitLabel="Rename"
          onClose={() => setDialog(undefined)}
          onSubmit={async (label) => {
            try {
              await updateStorage.mutateAsync({ storageId: dialog.storage.id, changes: { label } });
              return true;
            } catch (renameError) {
              announceError("Couldn't rename", renameError);
              return false;
            }
          }}
        />
      )}
      <ConfirmDialog
        isOpen={dialog?.kind === "remove"}
        onOpenChange={(isOpen) => !isOpen && setDialog(undefined)}
        title={`Remove ${dialog?.storage.label ?? "storage"}?`}
        confirmLabel={dialog?.storage.kind === "internal" ? "Unregister" : "Forget drive"}
        confirmVariant="danger"
        onConfirm={async () => {
          if (!dialog) return;
          await requestJson(`/api/storages/${encodeURIComponent(dialog.storage.id)}`, { method: "DELETE" });
          await refreshStorages();
          announce(`${dialog.storage.label} removed`, "The files were not touched.");
        }}
      >
        CCM stops showing it and forgets who could open it. The files on disk are not touched.
      </ConfirmDialog>
    </>
  );
}
