"use client";

import { Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/primitives/button";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import {
  AUTHENTICATION_INPUT_CLASS_NAMES,
  AUTHENTICATION_SECONDARY_BUTTON_CLASS_NAMES,
  AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES,
} from "@/components/page-sections/authentication/authentication-input-styles";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";
import { describePasswordError } from "@/lib/client/describe-password-error";
import { navigateWithFullReload, postSessionMessage } from "@/lib/client/session-channel";

export interface LockScreenProps {
  username: string;
  role: UserRole;
  nextPath: string;
}

/**
 * The locked-session screen: the account's initials and name, a password field that unlocks and
 * returns to `nextPath`, and "Sign out" as the way out.
 *
 * @example
 * <LockScreen username="alice" role="admin" nextPath="/settings" />
 */
export function LockScreen({ username, role, nextPath }: LockScreenProps) {
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleUnlock(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!password) return;
    setErrorMessage(undefined);
    setIsSubmitting(true);
    try {
      await requestJson("/api/auth/unlock", { method: "POST", body: { password }, handleSessionErrors: false });
      navigateWithFullReload(nextPath);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.code === "UNAUTHENTICATED") {
        navigateWithFullReload("/login");
        return;
      }
      setErrorMessage(describePasswordError(requestError, "Unlocking failed. Try again."));
      setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    await requestJson("/api/auth/logout", { method: "POST", handleSessionErrors: false }).catch(() => undefined);
    postSessionMessage({ type: "signed-out" });
    navigateWithFullReload("/login");
  }

  return (
    <form onSubmit={handleUnlock}>
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-brand/50 bg-brand/15 font-display text-lg font-semibold text-brand">
          {username.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="font-medium" data-testid="lock-username">
            {username}
          </div>
          <div className="mt-0.5 flex items-center text-xs text-foreground-muted">
            <Lock className="mr-1.5 h-3 w-3 stroke-[1.5]" />
            {ROLE_LABELS[role]} · session locked
          </div>
        </div>
      </div>
      <FormErrorAlert message={errorMessage} className="mb-4" />
      <FormLabel htmlFor="unlock-password">Password</FormLabel>
      <FormInput
        id="unlock-password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(changeEvent) => setPassword(changeEvent.target.value)}
        className={AUTHENTICATION_INPUT_CLASS_NAMES}
      />
      <div className="mt-6 text-center xl:mt-8 xl:text-left">
        <Button
          type="submit"
          variant="primary"
          isRounded
          className={AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}
          disabled={isSubmitting || !password}
        >
          {isSubmitting ? "Unlocking…" : "Unlock"}
        </Button>
        <Button
          variant="outline-secondary"
          isRounded
          className={AUTHENTICATION_SECONDARY_BUTTON_CLASS_NAMES}
          onClick={handleSignOut}
        >
          Sign out
        </Button>
      </div>
    </form>
  );
}
