"use client";

import { Check, Download, KeyRound, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { Button, createButtonClassNames } from "@/components/primitives/button";
import { FormCheckbox } from "@/components/primitives/form-check";
import { FormErrorMessage, FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import { KeyFileDropzone } from "@/components/encryption/key-file-dropzone";
import { JobProgressDetails } from "@/components/jobs/job-progress-details";
import { useJobProgress } from "@/hooks/use-job-progress";
import type { JobSummary } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { buildKeyFileUrl, useEncryptionMutations } from "@/lib/client/encryption";
import { mergeClassNames } from "@/utilities/merge-class-names";

type WizardStep = "understand" | "confirm" | "download" | "verify" | "encrypt";

const STEPS: readonly WizardStep[] = ["understand", "confirm", "download", "verify", "encrypt"];

const STEP_TITLES: Record<"encrypt" | "rekey", Record<WizardStep, string>> = {
  encrypt: {
    understand: "Understand",
    confirm: "Confirm password",
    download: "Download key",
    verify: "Verify",
    encrypt: "Encrypt",
  },
  rekey: {
    understand: "Understand",
    confirm: "Old key",
    download: "Download new key",
    verify: "Verify",
    encrypt: "Re-key",
  },
};

function StepIndicator({ mode, currentStep }: { mode: "encrypt" | "rekey"; currentStep: WizardStep }) {
  const currentIndex = STEPS.indexOf(currentStep);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs" aria-label="Steps">
      {STEPS.map((step, stepIndex) => (
        <li key={step} className="flex items-center gap-2" aria-current={step === currentStep ? "step" : undefined}>
          <span
            className={mergeClassNames(
              "flex h-6 w-6 items-center justify-center rounded-full border font-medium",
              stepIndex < currentIndex && "border-brand/60 bg-brand/20 text-brand",
              stepIndex === currentIndex && "border-brand bg-brand text-on-primary",
              stepIndex > currentIndex && "border-line-strong text-foreground-subtle",
            )}
          >
            {stepIndex < currentIndex ? <Check className="h-3.5 w-3.5" /> : stepIndex + 1}
          </span>
          <span className={stepIndex === currentIndex ? "text-foreground" : "text-foreground-subtle"}>
            {STEP_TITLES[mode][step]}
          </span>
          {stepIndex < STEPS.length - 1 && <span className="mx-1 h-px w-3 bg-line-strong" />}
        </li>
      ))}
    </ol>
  );
}

function Notice({ tone, children }: { tone: "warning" | "danger"; children: ReactNode }) {
  const Icon = tone === "danger" ? ShieldAlert : TriangleAlert;
  return (
    <div
      className={mergeClassNames(
        "flex gap-2.5 rounded-md border p-3 text-sm leading-relaxed",
        tone === "danger" ? "border-danger/40 bg-danger/10" : "border-warning/30 bg-warning/10",
      )}
    >
      <Icon
        className={mergeClassNames("h-4 w-4 flex-none", tone === "danger" ? "text-danger" : "text-warning")}
        aria-hidden
      />
      <div>{children}</div>
    </div>
  );
}

const KEEP_IT_TIPS = [
  "Copy it to a USB drive you keep somewhere else, or store it in your password manager.",
  "Keep it outside the encrypted folder: you can’t open the folder to get its own key.",
  "Anyone with the key file and a CCM account that can see the folder can read it, so keep it private.",
];

/**
 * The Enable encryption wizard, five steps: understand that the key file is the only
 * key, confirm the password, download the key file, upload it again to prove it was saved, then
 * encrypt with live progress. With `mode="rekey"` step 2 asks for the old key file instead, and
 * the last step re-encrypts every file with the new key.
 *
 * @example
 * <EnableEncryptionWizard storageId={storageId} path="persona" folderName="persona" onClose={close} />
 */
export function EnableEncryptionWizard({
  storageId,
  path: folderPath,
  folderName,
  mode = "encrypt",
  onClose,
}: {
  storageId: string;
  path: string;
  folderName: string;
  mode?: "encrypt" | "rekey";
  onClose: () => void;
}) {
  const mutations = useEncryptionMutations();
  const [currentStep, setCurrentStep] = useState<WizardStep>("understand");
  const [hasUnderstood, setHasUnderstood] = useState(false);
  const [password, setPassword] = useState("");
  const [oldKeyFile, setOldKeyFile] = useState<File>();
  const [pendingId, setPendingId] = useState<string>();
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [verifyFile, setVerifyFile] = useState<File>();
  const [isVerified, setIsVerified] = useState(false);
  const [job, setJob] = useState<JobSummary>();
  const [stepError, setStepError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  // The background jobs button announces the end; this refreshes what the wizard shows.
  const jobState = useJobProgress(job, () => mutations.refresh(storageId));
  const isRekey = mode === "rekey";

  const runStep = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setStepError(undefined);
    try {
      await action();
    } catch (stepFailure) {
      if (stepFailure instanceof ApiError && stepFailure.code === "INVALID_CREDENTIALS")
        setStepError("Wrong password.");
      else setStepError(stepFailure instanceof Error ? stepFailure.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  };

  const confirm = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    void runStep(async () => {
      if (isRekey) {
        if (!oldKeyFile) throw new Error("Choose the folder's current key file.");
        const result = await mutations.prepareRekey.mutateAsync({ storageId, path: folderPath, oldKeyFile, password });
        setPendingId(result.pendingId);
      } else {
        const result = await mutations.prepare.mutateAsync({
          storageId,
          path: folderPath,
          password,
        });
        setPendingId(result.pendingId);
      }
      setPassword("");
      setCurrentStep("download");
    });
  };

  const verify = (file: File | undefined) => {
    setVerifyFile(file);
    setIsVerified(false);
    if (!file || !pendingId) return;
    void runStep(async () => {
      await mutations.verify.mutateAsync({ pendingId, keyFile: file });
      setIsVerified(true);
    });
  };

  const start = () =>
    void runStep(async () => {
      if (!pendingId) return;
      const result = await mutations.start.mutateAsync({ storageId, pendingId });
      setJob(result.job);
    });

  const progress = jobState?.progress;
  const isFinished = jobState?.status === "done";
  const hasFailed = jobState?.status === "failed" || jobState?.status === "cancelled";
  const isRunning = job !== undefined && !isFinished && !hasFailed;

  let body: ReactNode;
  let footer: ReactNode;
  if (currentStep === "understand") {
    body = (
      <div className="grid gap-4 text-sm leading-relaxed">
        {isRekey ? (
          <p>
            Re-keying encrypts every file in <strong>{folderName}</strong> again with a new key. You get a new key file;
            the old one stops working once the re-key finishes.
          </p>
        ) : (
          <p>
            Encrypting <strong>{folderName}</strong> creates a <strong>key file</strong> (.ccmkey). Every file inside is
            encrypted on disk; to view or edit them you unlock the folder with the key file and your password.
          </p>
        )}
        <Notice tone="danger">
          <strong>The key file is the only key.</strong> CCM never stores it. If you lose it, the files can&rsquo;t be
          recovered, by you, an admin or anyone else.
        </Notice>
        <Notice tone="warning">
          Not encrypted: file and folder names, the folder structure, roughly how big each file is, and the
          memory&rsquo;s name and description.
        </Notice>
        <FormCheckbox
          id="wizard-understand"
          label="I understand: without the key file, the data can’t be recovered."
          checked={hasUnderstood}
          onChange={(changeEvent) => setHasUnderstood(changeEvent.target.checked)}
          data-testid="wizard-understand"
        />
      </div>
    );
    footer = (
      <Button
        variant="primary"
        disabled={!hasUnderstood}
        onClick={() => setCurrentStep("confirm")}
        data-testid="wizard-next"
      >
        Next
      </Button>
    );
  } else if (currentStep === "confirm") {
    body = (
      <form id="wizard-confirm" className="grid gap-4" onSubmit={confirm}>
        {isRekey && (
          <KeyFileDropzone label="Current key file" file={oldKeyFile} onFile={setOldKeyFile} testId="wizard-old-key" />
        )}
        <div>
          <FormLabel htmlFor="wizard-password">Your password</FormLabel>
          <PasswordInput
            id="wizard-password"
            value={password}
            autoFocus={!isRekey}
            autoComplete="current-password"
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
        </div>
        <FormErrorMessage message={stepError} />
      </form>
    );
    footer = (
      <Button
        type="submit"
        form="wizard-confirm"
        variant="primary"
        disabled={isBusy || password === "" || (isRekey && !oldKeyFile)}
        data-testid="wizard-next"
      >
        {isBusy ? "Checking…" : "Next"}
      </Button>
    );
  } else if (currentStep === "download") {
    body = (
      <div className="grid gap-4 text-sm leading-relaxed">
        <p>Download the key file and keep it safe. You need it every time you unlock this folder.</p>
        <a
          href={pendingId ? buildKeyFileUrl(pendingId) : undefined}
          download
          onClick={() => setHasDownloaded(true)}
          className={createButtonClassNames({ variant: "primary", className: "w-fit" })}
          data-testid="wizard-download"
        >
          <Download className="mr-2 h-4 w-4" aria-hidden />
          Download key file
        </a>
        <div>
          <div className="mb-1 font-medium">Where to keep it</div>
          <ul className="list-disc space-y-1 pl-5 text-foreground-muted">
            {KEEP_IT_TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
        <Notice tone="danger">If you lose the key file, the encrypted files can&rsquo;t be recovered.</Notice>
      </div>
    );
    footer = (
      <Button
        variant="primary"
        disabled={!hasDownloaded}
        onClick={() => setCurrentStep("verify")}
        data-testid="wizard-next"
      >
        Next
      </Button>
    );
  } else if (currentStep === "verify") {
    body = (
      <div className="grid gap-4 text-sm leading-relaxed">
        <p>Choose the key file you just downloaded, to make sure it was saved.</p>
        <KeyFileDropzone file={verifyFile} onFile={verify} testId="wizard-verify-key" isDisabled={isBusy} />
        {isVerified && (
          <p className="flex items-center gap-2 text-success" data-testid="wizard-verified">
            <Check className="h-4 w-4" aria-hidden /> That&rsquo;s the right key file.
          </p>
        )}
        <FormErrorMessage message={stepError} />
      </div>
    );
    footer = (
      <Button
        variant="primary"
        disabled={!isVerified}
        onClick={() => setCurrentStep("encrypt")}
        data-testid="wizard-next"
      >
        Next
      </Button>
    );
  } else {
    body = (
      <div className="grid gap-4 text-sm leading-relaxed" data-testid="wizard-encrypt">
        {!job && (
          <p>
            {isRekey ? "Re-encrypt" : "Encrypt"} every file in <strong>{folderName}</strong> now. Large folders take a
            while; you can close this window and follow it from the progress ring in the top bar.
          </p>
        )}
        {job && (
          <div data-testid="wizard-progress">
            <JobProgressDetails
              job={{
                ...job,
                status: jobState?.status ?? job.status,
                progress: isFinished && progress ? { ...progress, done: progress.total } : (progress ?? job.progress),
              }}
              showsTitle={false}
            />
          </div>
        )}
        {isFinished && (
          <p className="flex items-center gap-2 text-success" data-testid="wizard-done">
            <KeyRound className="h-4 w-4" aria-hidden />
            &ldquo;{folderName}&rdquo; is encrypted and unlocked for this session.
          </p>
        )}
        {hasFailed && (
          <FormErrorMessage
            message={jobState?.error ?? "The job stopped. Resume it from Folder settings → Encryption."}
          />
        )}
        <FormErrorMessage message={stepError} />
      </div>
    );
    footer = job ? (
      <Button variant="primary" onClick={onClose} data-testid="wizard-close">
        {isRunning ? "Close (keeps running)" : "Done"}
      </Button>
    ) : (
      <Button variant="primary" disabled={isBusy} onClick={start} data-testid="wizard-start">
        {isBusy ? "Starting…" : isRekey ? "Re-key now" : "Encrypt now"}
      </Button>
    );
  }

  return (
    <Modal
      isOpen
      isStatic={pendingId !== undefined && job === undefined}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={isRekey ? `Re-key "${folderName}"` : `Encrypt "${folderName}"`}
      size="large"
    >
      <div data-testid="encryption-wizard" data-step={currentStep}>
        <ModalBody>
          <StepIndicator mode={mode} currentStep={currentStep} />
          {body}
        </ModalBody>
        <ModalFooter>
          {!job && (
            <Button variant="outline-secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
          {footer}
        </ModalFooter>
      </div>
    </Modal>
  );
}
