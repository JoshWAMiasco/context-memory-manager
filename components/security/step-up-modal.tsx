"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { STEP_UP_ACTION_LABELS } from "@/lib/auth/policy";
import { requestJson } from "@/lib/client/api";
import { describePasswordError } from "@/lib/client/describe-password-error";
import { registerStepUpPrompter, type StepUpPrompt, type StepUpResult } from "@/lib/client/step-up";

interface PendingPrompt {
  prompt: StepUpPrompt;
  resolve: (stepUpResult: StepUpResult) => void;
}

const MODE_TEXT: Record<StepUpPrompt["mode"], { title: string; description: string }> = {
  "lan-once": {
    title: "Confirm once for this session (local network)",
    description: "Enter your password once. Other sensitive actions in this session won't ask again.",
  },
  "per-action": {
    title: "Confirm this action (remote access)",
    description: "You are connected from outside the local network, so each sensitive action needs your password.",
  },
};

/**
 * Mounts the password-confirmation (step-up) modal and registers it with the API client, which
 * opens it on `428 STEP_UP_REQUIRED` and retries the request after a successful confirmation.
 *
 * @example
 * <StepUpModalProvider>{children}</StepUpModalProvider>
 */
export function StepUpModalProvider({ children }: { children: ReactNode }) {
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt>();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pendingPromptReference = useRef<PendingPrompt | undefined>(undefined);

  useEffect(
    () =>
      registerStepUpPrompter(
        (prompt) =>
          new Promise<StepUpResult>((resolve) => {
            pendingPromptReference.current?.resolve({ confirmed: false });
            const nextPrompt = { prompt, resolve };
            pendingPromptReference.current = nextPrompt;
            setPassword("");
            setErrorMessage(undefined);
            setPendingPrompt(nextPrompt);
          }),
      ),
    [],
  );

  const finishPrompt = (stepUpResult: StepUpResult) => {
    pendingPromptReference.current?.resolve(stepUpResult);
    pendingPromptReference.current = undefined;
    setPendingPrompt(undefined);
  };

  async function handleConfirm(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!pendingPrompt || !password) return;
    setIsSubmitting(true);
    setErrorMessage(undefined);
    try {
      const { actionToken } = await requestJson<{ actionToken?: string }>("/api/auth/confirm", {
        method: "POST",
        body: { password, action: pendingPrompt.prompt.action, resource: pendingPrompt.prompt.resource },
        handleStepUp: false,
      });
      finishPrompt({ confirmed: true, actionToken });
    } catch (requestError) {
      setErrorMessage(describePasswordError(requestError, "Confirmation failed. Try again."));
      setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  const modeText = pendingPrompt ? MODE_TEXT[pendingPrompt.prompt.mode] : MODE_TEXT["lan-once"];
  return (
    <>
      {children}
      <Modal
        isOpen={pendingPrompt !== undefined}
        onOpenChange={(isOpen) => !isOpen && finishPrompt({ confirmed: false })}
        title={modeText.title}
      >
        <form onSubmit={handleConfirm} data-testid="step-up-modal">
          <ModalBody>
            <div className="mb-4 flex items-start gap-3 text-foreground-muted">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 stroke-[1.3] text-warning" />
              <div>
                <div className="font-medium text-foreground">
                  {pendingPrompt ? STEP_UP_ACTION_LABELS[pendingPrompt.prompt.action] : ""}
                </div>
                <div className="mt-1 leading-relaxed">{modeText.description}</div>
              </div>
            </div>
            <FormErrorAlert message={errorMessage} className="mb-4" />
            <FormLabel htmlFor="step-up-password">Password</FormLabel>
            <FormInput
              id="step-up-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(changeEvent) => setPassword(changeEvent.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="outline-secondary" onClick={() => finishPrompt({ confirmed: false })}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting || !password}>
              {isSubmitting ? "Checking…" : "Confirm"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
