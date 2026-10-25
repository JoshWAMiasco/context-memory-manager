"use client";

import { useState } from "react";
import { z } from "zod";
import { ValidatedForm } from "@/components/form-controls/validated-form";
import { ValidatedInputField } from "@/components/form-controls/validated-input-field";
import { Button } from "@/components/primitives/button";
import {
  AUTHENTICATION_INPUT_CLASS_NAMES,
  AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES,
} from "@/components/page-sections/authentication/authentication-input-styles";
import { ChangePasswordForm } from "@/components/security/change-password-form";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import type { AuthUser } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { describePasswordError } from "@/lib/client/describe-password-error";
import { navigateWithFullReload } from "@/lib/client/session-channel";

const loginFormSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export interface LoginPanelProps {
  nextPath: string;
  /** Set when the signed-in user must replace a temporary password before going on. */
  pendingPasswordChangeUsername?: string;
}

/**
 * Username and password sign-in (no email, register
 * link or social buttons). When the account has a temporary password it switches to a forced
 * password change before continuing to `nextPath`.
 *
 * @example
 * <LoginPanel nextPath="/settings/security" />
 */
export function LoginPanel({ nextPath, pendingPasswordChangeUsername }: LoginPanelProps) {
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordChangeUsername, setPasswordChangeUsername] = useState(pendingPasswordChangeUsername);

  async function handleValidSignIn(formValues: LoginFormValues) {
    setErrorMessage(undefined);
    setIsSubmitting(true);
    try {
      const { user } = await requestJson<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: formValues,
        handleSessionErrors: false,
      });
      if (user.mustChangePassword) {
        setPasswordChangeUsername(user.username);
        return;
      }
      navigateWithFullReload(nextPath);
    } catch (requestError) {
      setErrorMessage(describePasswordError(requestError, "Sign-in failed. Try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (passwordChangeUsername) {
    return (
      <div>
        <p className="mb-5 leading-relaxed text-foreground-muted">
          Your account has a temporary password. Choose your own password to continue.
        </p>
        <ChangePasswordForm
          username={passwordChangeUsername}
          submitLabel="Set password and continue"
          inputClassName={AUTHENTICATION_INPUT_CLASS_NAMES}
          submitClassName={`mt-6 ${AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}`}
          onChanged={() => navigateWithFullReload(nextPath)}
        />
      </div>
    );
  }

  return (
    <ValidatedForm
      schema={loginFormSchema}
      defaultValues={{ username: "", password: "" }}
      onValidSubmit={handleValidSignIn}
    >
      <FormErrorAlert message={errorMessage} className="mb-5" />
      <ValidatedInputField
        fieldName="username"
        autoComplete="username"
        label="Username"
        autoFocus
        inputClassName={AUTHENTICATION_INPUT_CLASS_NAMES}
      />
      <ValidatedInputField
        fieldName="password"
        type="password"
        autoComplete="current-password"
        label="Password"
        className="mt-4"
        inputClassName={AUTHENTICATION_INPUT_CLASS_NAMES}
      />
      <div className="mt-6 text-center xl:mt-8 xl:text-left">
        <Button
          type="submit"
          variant="primary"
          isRounded
          className={AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in…" : "Sign In"}
        </Button>
      </div>
    </ValidatedForm>
  );
}
