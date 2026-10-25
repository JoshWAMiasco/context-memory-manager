import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { StepUpAction, StepUpMode } from "@/lib/auth/policy";
import type { ResolvedSession, SessionNetworkClass } from "@/server/auth/session";
import { hashToken } from "@/server/auth/session";
import type { ApplicationMode } from "@/server/config";
import { getDatabase } from "@/server/db/client";
import { sessions, stepUpTokens } from "@/server/db/schema";
import { ApiRouteError } from "@/server/http/api-error";
import { requirePasswordConfirm } from "@/server/security/password-confirm";
import { getSetting } from "@/server/settings/store";

export const ACTION_TOKEN_HEADER = "x-ccm-action-token";
export const ACTION_TOKEN_QUERY_PARAMETER = "at";
export const ACTION_TOKEN_LIFETIME_MILLISECONDS = 2 * 60 * 1000;

/**
 * How a sensitive action must be confirmed: never on the desktop or for actions the admin turned
 * off; once per session from this machine or the local network; every time from a remote network.
 */
export function readStepUpMode(
  action: StepUpAction,
  networkClass: SessionNetworkClass,
  mode: ApplicationMode,
): StepUpMode | "none" {
  if (mode === "desktop" || networkClass === "desktop") return "none";
  if (!getSetting("security.stepUpActions").includes(action)) return "none";
  return networkClass === "remote" ? "per-action" : "lan-once";
}

function hashResource(resource: string): string {
  return createHash("sha256").update(resource).digest("hex");
}

/** Marks a matching, unused, unexpired action token as used. Returns false when there is none. */
export function consumeActionToken(
  sessionIdHash: string,
  action: StepUpAction,
  resource: string,
  actionToken: string,
  now = Date.now(),
): boolean {
  const consumedToken = getDatabase()
    .orm.update(stepUpTokens)
    .set({ usedAt: new Date(now) })
    .where(
      and(
        eq(stepUpTokens.idHash, hashToken(actionToken)),
        eq(stepUpTokens.sessionId, sessionIdHash),
        eq(stepUpTokens.action, action),
        eq(stepUpTokens.resource, hashResource(resource)),
        isNull(stepUpTokens.usedAt),
        gt(stepUpTokens.expiresAt, new Date(now)),
      ),
    )
    .returning({ idHash: stepUpTokens.idHash })
    .get();
  return consumedToken !== undefined;
}

export interface StepUpCheck {
  resolvedSession: ResolvedSession;
  action: StepUpAction;
  resource: string;
  networkClass: SessionNetworkClass;
  mode: ApplicationMode;
  actionToken?: string | null;
}

/** Throws `428 STEP_UP_REQUIRED` (with `details.mode`, `action`, `resource`) unless the action is confirmed. */
export function requireStepUp(
  { resolvedSession, action, resource, networkClass, mode, actionToken }: StepUpCheck,
  now = Date.now(),
): void {
  const stepUpMode = readStepUpMode(action, networkClass, mode);
  if (stepUpMode === "none") return;
  if (stepUpMode === "lan-once" && resolvedSession.session.lanConfirmedAt) return;
  if (
    stepUpMode === "per-action" &&
    actionToken &&
    consumeActionToken(resolvedSession.session.idHash, action, resource, actionToken, now)
  )
    return;
  const message =
    stepUpMode === "lan-once"
      ? "Confirm your password once for this session."
      : "Confirm your password for this action.";
  throw new ApiRouteError(428, "STEP_UP_REQUIRED", message, { mode: stepUpMode, action, resource });
}

export interface StepUpConfirmation extends Omit<StepUpCheck, "actionToken"> {
  password: string;
  ip: string;
}

/**
 * Checks the password, then records the confirmation: for `lan-once` the session is marked
 * confirmed; for `per-action` a single-use token valid for 2 minutes is returned, bound to this
 * session, action and resource.
 */
export async function confirmStepUp(
  { resolvedSession, action, resource, networkClass, mode, password, ip }: StepUpConfirmation,
  now = Date.now(),
): Promise<{ actionToken?: string }> {
  await requirePasswordConfirm({ user: resolvedSession.user, password, ip });
  const stepUpMode = readStepUpMode(action, networkClass, mode);
  const { orm } = getDatabase();
  if (stepUpMode === "lan-once") {
    orm
      .update(sessions)
      .set({ lanConfirmedAt: new Date(now) })
      .where(eq(sessions.idHash, resolvedSession.session.idHash))
      .run();
    return {};
  }
  if (stepUpMode === "none") return {};
  const actionToken = randomBytes(32).toString("base64url");
  orm
    .insert(stepUpTokens)
    .values({
      idHash: hashToken(actionToken),
      sessionId: resolvedSession.session.idHash,
      action,
      resource: hashResource(resource),
      expiresAt: new Date(now + ACTION_TOKEN_LIFETIME_MILLISECONDS),
    })
    .run();
  return { actionToken };
}
