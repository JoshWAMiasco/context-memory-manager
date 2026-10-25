"use client";

import dayjs from "dayjs";
import { CheckCircle, Database, KeyRound, Pencil, Trash2, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { Badge, type BadgeTone } from "@/components/primitives/badge";
import { Button } from "@/components/primitives/button";
import { FormSwitch } from "@/components/primitives/form-check";
import { FormErrorMessage, FormHelpText, FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormSelect } from "@/components/primitives/form-select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/primitives/table";
import { SettingsPanel } from "@/components/page-sections/settings/settings-panel";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { UserStorageAccessForm } from "@/components/settings/user-storage-access-form";
import type { UserSummary } from "@/lib/api-types";
import {
  findPasswordPolicyProblem,
  PASSWORD_MINIMUM_LENGTH,
  ROLE_LABELS,
  USER_ROLES,
  usernameSchema,
  type UserRole,
} from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";

const ROLE_TONES: Record<UserRole, BadgeTone> = { admin: "primary", editor: "success", viewer: "slate" };
const ROLE_OPTIONS = USER_ROLES.map((role) => ({ label: ROLE_LABELS[role], value: role }));

type UserDialog =
  | { kind: "create" }
  | { kind: "edit"; user: UserSummary }
  | { kind: "reset-password"; user: UserSummary }
  | { kind: "delete"; user: UserSummary }
  | { kind: "storage-access"; user: UserSummary };

function announce(title: string, description?: string) {
  showToastNotification({ title, description, icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" /> });
}

function readErrorMessage(requestError: unknown, fallbackMessage: string): string | undefined {
  if (requestError instanceof ApiError)
    return requestError.code === "STEP_UP_REQUIRED" ? "The change was not confirmed." : requestError.message;
  return fallbackMessage;
}

function DialogField({
  id,
  label,
  helpText,
  errorMessage,
  children,
}: {
  id: string;
  label: string;
  helpText?: string;
  errorMessage?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <FormLabel htmlFor={id}>{label}</FormLabel>
      {children}
      {helpText && !errorMessage && <FormHelpText>{helpText}</FormHelpText>}
      <FormErrorMessage message={errorMessage} />
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole>("editor");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const parsedUsername = usernameSchema.safeParse(username);
    const nextFieldErrors = {
      username: parsedUsername.success ? undefined : parsedUsername.error.issues[0]?.message,
      password: findPasswordPolicyProblem(username, temporaryPassword),
    };
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.username || nextFieldErrors.password) return;
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      await requestJson("/api/users", { method: "POST", body: { username, password: temporaryPassword, role } });
      announce("User created", "Share the temporary password. They choose their own at first sign-in.");
      onDone();
    } catch (requestError) {
      setErrorMessage(readErrorMessage(requestError, "The user could not be created."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate data-testid="create-user-form">
      <ModalBody>
        <FormErrorAlert message={errorMessage} className="mb-4" />
        <DialogField id="new-user-username" label="Username" errorMessage={fieldErrors.username}>
          <FormInput
            id="new-user-username"
            autoComplete="off"
            autoFocus
            value={username}
            onChange={(changeEvent) => setUsername(changeEvent.target.value)}
          />
        </DialogField>
        <DialogField
          id="new-user-role"
          label="Role"
          helpText="Editors read and write; viewers only read. Storage access is granted per storage."
        >
          <FormSelect
            id="new-user-role"
            options={ROLE_OPTIONS}
            value={role}
            onChange={(changeEvent) => setRole(changeEvent.target.value as UserRole)}
          />
        </DialogField>
        <DialogField
          id="new-user-password"
          label="Temporary password"
          helpText={`At least ${PASSWORD_MINIMUM_LENGTH} characters. The user must change it at first sign-in.`}
          errorMessage={fieldErrors.password}
        >
          <FormInput
            id="new-user-password"
            type="password"
            autoComplete="new-password"
            value={temporaryPassword}
            onChange={(changeEvent) => setTemporaryPassword(changeEvent.target.value)}
          />
        </DialogField>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline-secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSaving}>
          {isSaving ? "Creating…" : "Create user"}
        </Button>
      </ModalFooter>
    </form>
  );
}

function EditUserForm({
  user,
  isCurrentUser,
  onDone,
}: {
  user: UserSummary;
  isCurrentUser: boolean;
  onDone: () => void;
}) {
  const [role, setRole] = useState<UserRole>(user.role);
  const [isDisabled, setIsDisabled] = useState(user.disabled);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      await requestJson(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        body: { role, disabled: isDisabled },
      });
      announce("User updated");
      onDone();
    } catch (requestError) {
      setErrorMessage(readErrorMessage(requestError, "The user could not be updated."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} data-testid="edit-user-form">
      <ModalBody>
        <FormErrorAlert message={errorMessage} className="mb-4" />
        <DialogField id="edit-user-role" label="Role">
          <FormSelect
            id="edit-user-role"
            options={ROLE_OPTIONS}
            value={role}
            onChange={(changeEvent) => setRole(changeEvent.target.value as UserRole)}
          />
        </DialogField>
        <div className="mt-5">
          <FormSwitch
            id="edit-user-disabled"
            label="Disabled"
            description={
              isCurrentUser
                ? "Disabling yourself signs you out."
                : "A disabled user can't sign in and is signed out now."
            }
            checked={isDisabled}
            onChange={(changeEvent) => setIsDisabled(changeEvent.target.checked)}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline-secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </ModalFooter>
    </form>
  );
}

function ResetPasswordForm({ user, onDone }: { user: UserSummary; onDone: () => void }) {
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const policyProblem = findPasswordPolicyProblem(user.username, temporaryPassword);
    setFieldError(policyProblem);
    if (policyProblem) return;
    setIsSaving(true);
    setErrorMessage(undefined);
    try {
      await requestJson(`/api/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: { temporaryPassword } });
      announce("Password reset", `${user.username} must choose a new password at next sign-in.`);
      onDone();
    } catch (requestError) {
      setErrorMessage(readErrorMessage(requestError, "The password could not be reset."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ModalBody>
        <FormErrorAlert message={errorMessage} className="mb-4" />
        <DialogField
          id="reset-password"
          label="Temporary password"
          helpText="The user is signed out everywhere and must change it at next sign-in."
          errorMessage={fieldError}
        >
          <FormInput
            id="reset-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={temporaryPassword}
            onChange={(changeEvent) => setTemporaryPassword(changeEvent.target.value)}
          />
        </DialogField>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline-secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSaving}>
          {isSaving ? "Resetting…" : "Reset password"}
        </Button>
      </ModalFooter>
    </form>
  );
}

function DeleteUserForm({ user, onDone }: { user: UserSummary; onDone: () => void }) {
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    setErrorMessage(undefined);
    try {
      await requestJson(`/api/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      announce("User deleted");
      onDone();
    } catch (requestError) {
      setErrorMessage(readErrorMessage(requestError, "The user could not be deleted."));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <ModalBody>
        <FormErrorAlert message={errorMessage} className="mb-4" />
        <p className="leading-relaxed">
          Delete <span className="font-medium">{user.username}</span>? Their sessions end now. Files they created stay
          where they are.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline-secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => void handleDelete()} disabled={isDeleting}>
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </ModalFooter>
    </>
  );
}

const DIALOG_TITLES: Record<UserDialog["kind"], string> = {
  create: "Add user",
  edit: "Edit user",
  "reset-password": "Reset password",
  delete: "Delete user",
  "storage-access": "Storage access",
};

/**
 * Settings → Users (admins only): the user table with Add, Edit role / disable, Reset password and
 * Delete. Every change goes through the step-up modal when the server asks for it.
 *
 * @example
 * <UsersPanel currentUserId={user.id} />
 */
export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [openDialog, setOpenDialog] = useState<UserDialog>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    requestJson<{ users: UserSummary[] }>("/api/users")
      .then(({ users: loadedUsers }) => {
        if (isCurrent) setUsers(loadedUsers);
      })
      .catch((requestError: unknown) => {
        if (isCurrent) setErrorMessage(readErrorMessage(requestError, "Users could not be loaded."));
      });
    return () => {
      isCurrent = false;
    };
  }, [reloadCount]);

  const closeDialog = () => {
    setOpenDialog(undefined);
    setReloadCount((previousCount) => previousCount + 1);
  };

  return (
    <SettingsPanel
      title="Users"
      titleAddon={
        <Button
          size="small"
          variant="primary"
          className="ml-auto"
          leadingIcon={<UserPlus className="mr-2 h-4 w-4 stroke-[1.3]" />}
          onClick={() => setOpenDialog({ kind: "create" })}
        >
          Add user
        </Button>
      }
    >
      <FormErrorAlert message={errorMessage} className="mb-4" />
      <div className="overflow-x-auto">
        <Table appearance="list" data-testid="users-table">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Username</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Last sign-in</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} data-testid={`user-row-${user.username}`}>
                <TableCell className="font-medium">
                  {user.username}
                  {user.id === currentUserId && <span className="ml-2 text-xs text-foreground-muted">(you)</span>}
                </TableCell>
                <TableCell>
                  <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                </TableCell>
                <TableCell>
                  {user.disabled ? (
                    <Badge tone="danger">Disabled</Badge>
                  ) : user.mustChangePassword ? (
                    <Badge tone="warning">Temporary password</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </TableCell>
                <TableCell>{user.lastLoginAt ? dayjs(user.lastLoginAt).format("YYYY-MM-DD HH:mm") : "Never"}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu trigger={<span className="text-primary">Manage</span>} menuClassName="w-48">
                    <DropdownMenuItem
                      onSelect={() => setOpenDialog({ kind: "edit", user })}
                      icon={<Pencil className="mr-2 h-4 w-4 stroke-[1.3]" />}
                    >
                      Edit role / status
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setOpenDialog({ kind: "storage-access", user })}
                      icon={<Database className="mr-2 h-4 w-4 stroke-[1.3]" />}
                    >
                      Storage access
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setOpenDialog({ kind: "reset-password", user })}
                      icon={<KeyRound className="mr-2 h-4 w-4 stroke-[1.3]" />}
                    >
                      Reset password
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      tone="danger"
                      onSelect={() => setOpenDialog({ kind: "delete", user })}
                      icon={<Trash2 className="mr-2 h-4 w-4 stroke-[1.3]" />}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Modal
        isOpen={openDialog !== undefined}
        onOpenChange={(isOpen) => !isOpen && setOpenDialog(undefined)}
        title={
          openDialog
            ? `${DIALOG_TITLES[openDialog.kind]}${openDialog.kind === "create" ? "" : `: ${openDialog.user.username}`}`
            : undefined
        }
        size={openDialog?.kind === "storage-access" ? "large" : "medium"}
      >
        {openDialog?.kind === "create" && <CreateUserForm onDone={closeDialog} />}
        {openDialog?.kind === "edit" && (
          <EditUserForm
            user={openDialog.user}
            isCurrentUser={openDialog.user.id === currentUserId}
            onDone={closeDialog}
          />
        )}
        {openDialog?.kind === "reset-password" && <ResetPasswordForm user={openDialog.user} onDone={closeDialog} />}
        {openDialog?.kind === "delete" && <DeleteUserForm user={openDialog.user} onDone={closeDialog} />}
        {openDialog?.kind === "storage-access" && <UserStorageAccessForm user={openDialog.user} onDone={closeDialog} />}
      </Modal>
    </SettingsPanel>
  );
}
