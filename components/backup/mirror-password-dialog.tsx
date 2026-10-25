"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import { MIRROR_WARNING } from "@/lib/backup";

/**
 * Asks for the user's password before a mirror run: mirrors move destination files that
 * the source doesn't have to the destination's Trash.
 *
 * @example
 * <MirrorPasswordDialog name="Notes → USB" onConfirm={(password) => run(password)} onClose={close} />
 */
export function MirrorPasswordDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: (password: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={`Run the mirror "${name}"?`}
      confirmLabel="Run mirror"
      confirmVariant="warning"
      testId="mirror-password-dialog"
      isConfirmDisabled={password === ""}
      onConfirm={() => onConfirm(password)}
    >
      <div className="grid gap-3">
        <p>{MIRROR_WARNING} Confirm with your password to run it.</p>
        <div>
          <FormLabel htmlFor="mirror-password">Your password</FormLabel>
          <PasswordInput
            id="mirror-password"
            value={password}
            autoComplete="current-password"
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
