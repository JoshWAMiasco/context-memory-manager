"use client";

import { useEffect, useState } from "react";
import { ModalBody, ModalCloseButton, ModalFooter } from "@/components/interactive/modal";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { Button } from "@/components/primitives/button";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import type { UserStorageAccess, UserSummary } from "@/lib/api-types";
import { ApiError, requestJson } from "@/lib/client/api";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

const ACCESS_LEVELS = ["none", "read", "write"] as const;
const ACCESS_LABELS = { none: "None", read: "Read", write: "Write" } as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * One user's access to every storage as a matrix of storages against none, read and write
 *. Admins can open everything, so their matrix is read-only; viewers never get more
 * than read, whatever is granted.
 *
 * @example
 * <UserStorageAccessForm user={user} onDone={close} />
 */
export function UserStorageAccessForm({ user, onDone }: { user: UserSummary; onDone: () => void }) {
  const [rows, setRows] = useState<UserStorageAccess[]>();
  const [changedLevels, setChangedLevels] = useState<Record<string, AccessLevel>>({});
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = user.role === "admin";

  useEffect(() => {
    let isCurrent = true;
    requestJson<{ access: UserStorageAccess[] }>(`/api/users/${encodeURIComponent(user.id)}/storage-access`)
      .then(({ access }) => {
        if (isCurrent) setRows(access);
      })
      .catch((loadError: unknown) => {
        if (isCurrent) setErrorMessage(loadError instanceof Error ? loadError.message : "Access could not be loaded.");
      });
    return () => {
      isCurrent = false;
    };
  }, [user.id]);

  const save = async () => {
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      const grants = Object.entries(changedLevels).map(([storageId, level]) => ({ storageId, level }));
      await requestJson(`/api/users/${encodeURIComponent(user.id)}/storage-access`, {
        method: "PUT",
        body: { grants },
      });
      showToastNotification({ title: `Storage access for ${user.username} saved`, tone: "success" });
      onDone();
    } catch (saveError) {
      setErrorMessage(
        saveError instanceof ApiError && saveError.code === "STEP_UP_REQUIRED"
          ? "The change was not confirmed."
          : saveError instanceof Error
            ? saveError.message
            : "Saving failed.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div data-testid="user-storage-access">
      <ModalBody>
        <FormErrorAlert message={errorMessage} className="mb-4" />
        {isAdmin && <p className="mb-4 text-foreground-muted">Admins can open and change every storage.</p>}
        {user.role === "viewer" && (
          <p className="mb-4 text-foreground-muted">Viewers can only read, even where write is granted.</p>
        )}
        {!rows && !errorMessage && <LoadingSkeleton rows={3} label="Loading storages…" />}
        {rows && rows.length === 0 && <p className="text-foreground-subtle">There are no storages yet.</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Storage</TableHeaderCell>
                  {ACCESS_LEVELS.map((level) => (
                    <TableHeaderCell key={level} className="text-center">
                      {ACCESS_LABELS[level]}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const level = changedLevels[row.storageId] ?? row.level;
                  return (
                    <TableRow key={row.storageId} data-testid={`access-row-${row.label}`}>
                      <TableCell>{row.label}</TableCell>
                      {ACCESS_LEVELS.map((choice) => (
                        <TableCell key={choice} className="text-center">
                          <input
                            type="radio"
                            name={`access-${row.storageId}`}
                            aria-label={`${ACCESS_LABELS[choice]} access to ${row.label}`}
                            checked={isAdmin ? choice === "write" : level === choice}
                            disabled={isAdmin}
                            onChange={() =>
                              setChangedLevels((previousLevels) => ({ ...previousLevels, [row.storageId]: choice }))
                            }
                            className="cursor-pointer accent-brand"
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <ModalCloseButton>Cancel</ModalCloseButton>
        <Button
          variant="primary"
          disabled={isAdmin || isSaving || Object.keys(changedLevels).length === 0}
          onClick={() => void save()}
        >
          {isSaving ? "Saving…" : "Save access"}
        </Button>
      </ModalFooter>
    </div>
  );
}
