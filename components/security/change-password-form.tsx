"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import { ValidatedForm } from "@/components/form-controls/validated-form";
import { ValidatedInputField } from "@/components/form-controls/validated-input-field";
import { Button } from "@/components/primitives/button";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";
import { findPasswordPolicyProblem, PASSWORD_MINIMUM_LENGTH } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";

function createChangePasswordSchema(username: string) {
  return z
    .object({
      currentPassword: z.string().min(1, "Enter your current password"),
      nextPassword: z.string(),
      nextPasswordConfirmation: z.string(),
    })
    .superRefine((formValues, refinementContext) => {
      const policyProblem = findPasswordPolicyProblem(username, formValues.nextPassword);
      if (policyProblem) refinementContext.addIssue({ code: "custom", path: ["nextPassword"], message: policyProblem });
      if (formValues.nextPassword !== formValues.nextPasswordConfirmation) {
        refinementContext.addIssue({
          code: "custom",
          path: ["nextPasswordConfirmation"],
          message: "The passwords don't match",
        });
      }
    });
}

type ChangePasswordFormValues = z.infer<ReturnType<typeof createChangePasswordSchema>>;

function WatchedStrengthMeter() {
  const nextPassword = useWatch({ name: "nextPassword" }) as string | undefined;
  return <PasswordStrengthMeter password={nextPassword ?? ""} />;
}

export interface ChangePasswordFormProps {
  username: string;
  submitLabel?: string;
  inputClassName?: string;
  submitClassName?: string;
  onChanged: () => void;
}

/**
 * Current, new and confirmed password, checked against the CCM policy (at least 10 characters,
 * not the username) before posting to `/api/users/me/password`. Used for the forced change after
 * sign-in and in Security settings.
 *
 * @example
 * <ChangePasswordForm username="alice" onChanged={() => window.location.assign("/")} />
 */
export function ChangePasswordForm({
  username,
  submitLabel = "Change password",
  inputClassName,
  submitClassName,
  onChanged,
}: ChangePasswordFormProps) {
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleValidSubmit(formValues: ChangePasswordFormValues) {
    setErrorMessage(undefined);
    setIsSubmitting(true);
    try {
      await requestJson("/api/users/me/password", {
        method: "POST",
        body: { current: formValues.currentPassword, next: formValues.nextPassword },
        handleSessionErrors: false,
      });
      onChanged();
    } catch (requestError) {
      setErrorMessage(requestError instanceof ApiError ? requestError.message : "The password could not be changed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ValidatedForm
      schema={createChangePasswordSchema(username)}
      defaultValues={{ currentPassword: "", nextPassword: "", nextPasswordConfirmation: "" }}
      onValidSubmit={handleValidSubmit}
    >
      <FormErrorAlert message={errorMessage} className="mb-4" />
      <ValidatedInputField
        fieldName="currentPassword"
        type="password"
        autoComplete="current-password"
        label="Current password"
        inputClassName={inputClassName}
      />
      <ValidatedInputField
        fieldName="nextPassword"
        type="password"
        autoComplete="new-password"
        label="New password"
        helpText={`At least ${PASSWORD_MINIMUM_LENGTH} characters, and not your username.`}
        className="mt-4"
        inputClassName={inputClassName}
      />
      <WatchedStrengthMeter />
      <ValidatedInputField
        fieldName="nextPasswordConfirmation"
        type="password"
        autoComplete="new-password"
        label="Confirm new password"
        className="mt-3"
        inputClassName={inputClassName}
      />
      <Button type="submit" variant="primary" className={submitClassName ?? "mt-5"} disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : submitLabel}
      </Button>
    </ValidatedForm>
  );
}
