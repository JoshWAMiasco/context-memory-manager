import type { MeResponse } from "@/lib/api-types";
import type { StepUpAction, StepUpMode } from "@/lib/auth/policy";
import { requestJson } from "@/lib/client/api";

export const ACTION_TOKEN_HEADER = "x-cmm-action-token";

export interface StepUpPrompt {
  mode: StepUpMode;
  action: StepUpAction;
  resource: string;
}

export interface StepUpResult {
  confirmed: boolean;
  actionToken?: string;
}

type StepUpPrompter = (prompt: StepUpPrompt) => Promise<StepUpResult>;

let activePrompter: StepUpPrompter | undefined;
let promptChain: Promise<unknown> = Promise.resolve();
let isLanConfirmedInThisTab = false;

/** The step-up modal registers itself here; the API client calls it on `428 STEP_UP_REQUIRED`. */
export function registerStepUpPrompter(prompter: StepUpPrompter): () => void {
  activePrompter = prompter;
  return () => {
    if (activePrompter === prompter) activePrompter = undefined;
  };
}

/**
 * Asks the user to confirm with their password. Resolves `{ confirmed: false }` when cancelled or
 * no modal is mounted. Prompts are shown one at a time: several requests that need step-up at once
 * (three uploads starting together) queue up. Once this tab confirmed the session-wide (LAN)
 * step-up, queued LAN prompts resolve without asking again.
 */
export function promptStepUp(prompt: StepUpPrompt): Promise<StepUpResult> {
  const result = promptChain.then(async (): Promise<StepUpResult> => {
    if (prompt.mode === "lan-once" && isLanConfirmedInThisTab) return { confirmed: true };
    const stepUpResult = activePrompter ? await activePrompter(prompt) : { confirmed: false };
    if (stepUpResult.confirmed && prompt.mode === "lan-once") isLanConfirmedInThisTab = true;
    return stepUpResult;
  });
  promptChain = result.catch(() => undefined);
  return result;
}

/**
 * Confirms an action ahead of time, when the server will want it: resolves `{}` when no
 * confirmation is needed (or this session already gave it), `{ actionToken }` from a remote network,
 * or undefined when the user cancels. For downloads (plain navigations, which can't retry a `428`)
 * and folder uploads (one confirmation for many files).
 *
 * @example
 * const grant = await requestStepUpGrant("upload", "home:notes/import/**");
 * if (!grant) return; // cancelled
 */
export async function requestStepUpGrant(
  action: StepUpAction,
  resource: string,
): Promise<{ actionToken?: string } | undefined> {
  const { stepUp } = await requestJson<MeResponse>("/api/auth/me");
  if (stepUp.mode === "none" || !stepUp.actions.includes(action)) return {};
  if (stepUp.mode === "lan-once" && stepUp.lanConfirmed) return {};
  const stepUpResult = await promptStepUp({ mode: stepUp.mode, action, resource });
  if (!stepUpResult.confirmed) return undefined;
  return stepUpResult.actionToken ? { actionToken: stepUpResult.actionToken } : {};
}

/**
 * Downloads are plain navigations, so a `428` can't be retried. This confirms first when needed and
 * returns the URL with `?at=<action token>` for remote clients, the URL unchanged when no
 * confirmation is needed, or undefined when the user cancels.
 *
 * @example
 * const downloadUrl = await getStepUpDownloadUrl(`/api/fs/download?storage=${storageId}&path=${path}`, "download", `${storageId}:${path}`);
 * if (downloadUrl) window.location.assign(downloadUrl);
 */
export async function getStepUpDownloadUrl(
  url: string,
  action: StepUpAction,
  resource: string,
): Promise<string | undefined> {
  const grant = await requestStepUpGrant(action, resource);
  if (!grant) return undefined;
  if (!grant.actionToken) return url;
  const downloadUrl = new URL(url, window.location.origin);
  downloadUrl.searchParams.set("at", grant.actionToken);
  return `${downloadUrl.pathname}${downloadUrl.search}`;
}
