"use client";

import { Check, KeyRound, MonitorSmartphone, Server, ShieldCheck, Timer } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/primitives/badge";
import { Button, ButtonLink } from "@/components/primitives/button";
import { FormErrorMessage, FormHelpText, FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import {
  AUTHENTICATION_INPUT_CLASS_NAMES,
  AUTHENTICATION_SECONDARY_BUTTON_CLASS_NAMES,
  AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES,
} from "@/components/page-sections/authentication/authentication-input-styles";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";
import { findPasswordPolicyProblem, PASSWORD_MINIMUM_LENGTH, usernameSchema } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";
import { navigateWithFullReload } from "@/lib/client/session-channel";
import { mergeClassNames } from "@/utilities/merge-class-names";

type WizardStep = "welcome" | "setup-code" | "admin" | "auto-lock" | "done";

const STEP_TITLES: Record<WizardStep, string> = {
  welcome: "Welcome",
  "setup-code": "Setup code",
  admin: "Admin account",
  "auto-lock": "Auto-lock",
  done: "Done",
};

const DEFAULT_AUTO_LOCK_MINUTES = 15;

interface AdminFields {
  username: string;
  password: string;
  passwordConfirmation: string;
}

type AdminFieldErrors = Partial<Record<keyof AdminFields, string>>;

function validateAdminFields({ username, password, passwordConfirmation }: AdminFields): AdminFieldErrors {
  const fieldErrors: AdminFieldErrors = {};
  const parsedUsername = usernameSchema.safeParse(username);
  if (!parsedUsername.success) fieldErrors.username = parsedUsername.error.issues[0]?.message;
  const policyProblem = findPasswordPolicyProblem(username, password);
  if (policyProblem) fieldErrors.password = policyProblem;
  if (password !== passwordConfirmation) fieldErrors.passwordConfirmation = "The passwords don't match";
  return fieldErrors;
}

function StepIndicator({ steps, currentStep }: { steps: readonly WizardStep[]; currentStep: WizardStep }) {
  const currentIndex = steps.indexOf(currentStep);
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs" aria-label="Setup steps">
      {steps.map((step, stepIndex) => (
        <li key={step} className="flex items-center gap-2" aria-current={step === currentStep ? "step" : undefined}>
          <span
            className={mergeClassNames(
              "flex h-6 w-6 items-center justify-center rounded-full border font-display",
              stepIndex < currentIndex && "border-brand/60 bg-brand/20 text-brand",
              stepIndex === currentIndex && "border-brand bg-brand text-on-primary",
              stepIndex > currentIndex && "border-line-strong text-foreground-subtle",
            )}
          >
            {stepIndex < currentIndex ? <Check className="h-3.5 w-3.5" /> : stepIndex + 1}
          </span>
          <span className={stepIndex === currentIndex ? "text-foreground" : "text-foreground-subtle"}>
            {STEP_TITLES[step]}
          </span>
          {stepIndex < steps.length - 1 && <span className="mx-1 h-px w-4 bg-line-strong" />}
        </li>
      ))}
    </ol>
  );
}

function WizardField({
  id,
  label,
  helpText,
  errorMessage,
  children,
}: {
  id: string;
  label: string;
  helpText?: ReactNode;
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

export interface SetupWizardProps {
  mode: "desktop" | "server";
  needsSetupCode: boolean;
}

/**
 * The first-run wizard: welcome (with the mode), the one-time setup code (server mode only), the
 * admin username and password, the auto-lock time, then done. It posts everything to
 * `/api/setup` from the auto-lock step and goes back to the step a server error belongs to.
 *
 * @example
 * <SetupWizard mode="server" needsSetupCode />
 */
export function SetupWizard({ mode, needsSetupCode }: SetupWizardProps) {
  const steps: readonly WizardStep[] = needsSetupCode
    ? ["welcome", "setup-code", "admin", "auto-lock", "done"]
    : ["welcome", "admin", "auto-lock", "done"];
  const [currentStep, setCurrentStep] = useState<WizardStep>("welcome");
  const [setupCode, setSetupCode] = useState("");
  const [adminFields, setAdminFields] = useState<AdminFields>({ username: "", password: "", passwordConfirmation: "" });
  const [adminFieldErrors, setAdminFieldErrors] = useState<AdminFieldErrors>({});
  const [autoLockMinutes, setAutoLockMinutes] = useState(String(DEFAULT_AUTO_LOCK_MINUTES));
  const [stepErrors, setStepErrors] = useState<Partial<Record<WizardStep, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const goToStep = (step: WizardStep) => setCurrentStep(step);
  const goBack = () => goToStep(steps[Math.max(steps.indexOf(currentStep) - 1, 0)] ?? "welcome");
  const goForward = () => goToStep(steps[steps.indexOf(currentStep) + 1] ?? "done");
  const updateAdminField = (fieldName: keyof AdminFields, fieldValue: string) =>
    setAdminFields((previousFields) => ({ ...previousFields, [fieldName]: fieldValue }));

  function handleSetupCodeSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (setupCode.trim() === "") {
      setStepErrors({ "setup-code": "Enter the setup code" });
      return;
    }
    setStepErrors({});
    goForward();
  }

  function handleAdminSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const fieldErrors = validateAdminFields(adminFields);
    setAdminFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length === 0) {
      setStepErrors({});
      goForward();
    }
  }

  async function handleAutoLockSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const parsedMinutes = Number(autoLockMinutes);
    if (!Number.isInteger(parsedMinutes) || parsedMinutes < 1 || parsedMinutes > 1440) {
      setStepErrors({ "auto-lock": "Enter whole minutes between 1 and 1440" });
      return;
    }
    setStepErrors({});
    setIsSubmitting(true);
    try {
      await requestJson("/api/setup", {
        method: "POST",
        body: {
          username: adminFields.username,
          password: adminFields.password,
          setupCode: needsSetupCode ? setupCode : undefined,
          autoLockMinutes: parsedMinutes,
        },
        handleSessionErrors: false,
      });
      goToStep("done");
    } catch (requestError) {
      const apiError = requestError instanceof ApiError ? requestError : undefined;
      if (apiError?.code === "SETUP_CODE_INVALID") {
        setStepErrors({ "setup-code": apiError.message });
        goToStep("setup-code");
      } else if (apiError?.code === "VALIDATION_FAILED") {
        setStepErrors({ admin: apiError.message });
        goToStep("admin");
      } else if (apiError?.code === "SETUP_COMPLETE") {
        navigateWithFullReload("/login");
      } else {
        setStepErrors({ "auto-lock": apiError?.message ?? "Setup failed. Try again." });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const backButton = (
    <Button
      variant="outline-secondary"
      isRounded
      className={AUTHENTICATION_SECONDARY_BUTTON_CLASS_NAMES}
      onClick={goBack}
    >
      Back
    </Button>
  );

  return (
    <div data-testid="setup-wizard" data-step={currentStep}>
      <StepIndicator steps={steps} currentStep={currentStep} />

      {currentStep === "welcome" && (
        <div>
          <Badge
            tone="primary"
            variant="outline"
            icon={
              mode === "server" ? (
                <Server className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <MonitorSmartphone className="mr-1.5 h-3.5 w-3.5" />
              )
            }
          >
            {mode === "server" ? "Server mode" : "Desktop mode"}
          </Badge>
          <p className="mt-5 leading-relaxed text-foreground-muted">
            CCM keeps your files, LLM memory folders and keys on this {mode === "server" ? "server" : "computer"}.
            Create the admin account to start. The admin can add other users later.
          </p>
          {needsSetupCode && (
            <p className="mt-3 leading-relaxed text-foreground-muted">
              You will need the one-time setup code. CCM prints it in its log when it starts (the terminal running{" "}
              <code className="text-brand">npm run dev</code>, or <code className="text-brand">journalctl -u ccm</code>{" "}
              on an installed server) and saves it in the <code className="text-brand">setup-code</code> file in the
              data directory.
            </p>
          )}
          <Button
            variant="primary"
            isRounded
            className={`mt-8 ${AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}`}
            onClick={goForward}
          >
            Get started
          </Button>
        </div>
      )}

      {currentStep === "setup-code" && (
        <form onSubmit={handleSetupCodeSubmit} noValidate>
          <FormErrorAlert message={stepErrors["setup-code"]} className="mb-4" />
          <WizardField
            id="setup-code"
            label="Setup code"
            helpText="Shown in the CCM server log at start-up, and saved in the setup-code file in the data directory (.ccm-dev-data/ when using npm run dev)."
          >
            <FormInput
              id="setup-code"
              autoComplete="one-time-code"
              autoFocus
              placeholder="XXXX-XXXX-XXXX"
              value={setupCode}
              onChange={(changeEvent) => setSetupCode(changeEvent.target.value)}
              className={`${AUTHENTICATION_INPUT_CLASS_NAMES} font-mono tracking-widest uppercase`}
            />
          </WizardField>
          <Button
            type="submit"
            variant="primary"
            isRounded
            className={`mt-8 ${AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}`}
            leadingIcon={<KeyRound className="mr-2 h-4 w-4" />}
          >
            Continue
          </Button>
          {backButton}
        </form>
      )}

      {currentStep === "admin" && (
        <form onSubmit={handleAdminSubmit} noValidate>
          <FormErrorAlert message={stepErrors.admin} className="mb-4" />
          <WizardField
            id="admin-username"
            label="Admin username"
            helpText="Letters, digits, dots, dashes or underscores."
            errorMessage={adminFieldErrors.username}
          >
            <FormInput
              id="admin-username"
              autoComplete="username"
              autoFocus
              value={adminFields.username}
              onChange={(changeEvent) => updateAdminField("username", changeEvent.target.value)}
              hasError={Boolean(adminFieldErrors.username)}
              className={AUTHENTICATION_INPUT_CLASS_NAMES}
            />
          </WizardField>
          <WizardField
            id="admin-password"
            label="Password"
            helpText={`At least ${PASSWORD_MINIMUM_LENGTH} characters, and not the username.`}
            errorMessage={adminFieldErrors.password}
          >
            <FormInput
              id="admin-password"
              type="password"
              autoComplete="new-password"
              value={adminFields.password}
              onChange={(changeEvent) => updateAdminField("password", changeEvent.target.value)}
              hasError={Boolean(adminFieldErrors.password)}
              className={AUTHENTICATION_INPUT_CLASS_NAMES}
            />
            <PasswordStrengthMeter password={adminFields.password} />
          </WizardField>
          <WizardField
            id="admin-password-confirmation"
            label="Confirm password"
            errorMessage={adminFieldErrors.passwordConfirmation}
          >
            <FormInput
              id="admin-password-confirmation"
              type="password"
              autoComplete="new-password"
              value={adminFields.passwordConfirmation}
              onChange={(changeEvent) => updateAdminField("passwordConfirmation", changeEvent.target.value)}
              hasError={Boolean(adminFieldErrors.passwordConfirmation)}
              className={AUTHENTICATION_INPUT_CLASS_NAMES}
            />
          </WizardField>
          <Button
            type="submit"
            variant="primary"
            isRounded
            className={`mt-8 ${AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}`}
          >
            Continue
          </Button>
          {backButton}
        </form>
      )}

      {currentStep === "auto-lock" && (
        <form onSubmit={handleAutoLockSubmit} noValidate>
          <FormErrorAlert message={stepErrors["auto-lock"]} className="mb-4" />
          <WizardField
            id="auto-lock-minutes"
            label="Lock after this many idle minutes"
            helpText="A locked session asks for the password again. You can change this in Settings → Security."
          >
            <FormInput
              id="auto-lock-minutes"
              type="number"
              min={1}
              max={1440}
              value={autoLockMinutes}
              onChange={(changeEvent) => setAutoLockMinutes(changeEvent.target.value)}
              className={AUTHENTICATION_INPUT_CLASS_NAMES}
            />
          </WizardField>
          <Button
            type="submit"
            variant="primary"
            isRounded
            className={`mt-8 ${AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}`}
            leadingIcon={<Timer className="mr-2 h-4 w-4" />}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating admin…" : "Create admin"}
          </Button>
          {backButton}
        </form>
      )}

      {currentStep === "done" && (
        <div>
          <div className="flex items-center gap-3 text-success">
            <ShieldCheck className="h-6 w-6 stroke-[1.5]" />
            <span className="font-medium">CCM is ready.</span>
          </div>
          <p className="mt-4 leading-relaxed text-foreground-muted">
            Sign in as <span className="font-medium text-foreground">{adminFields.username.trim().toLowerCase()}</span>{" "}
            to continue.
          </p>
          <ButtonLink
            href="/login"
            variant="primary"
            isRounded
            className={`mt-8 ${AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}`}
          >
            Go to sign in
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
