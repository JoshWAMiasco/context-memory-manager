import "server-only";
import type { AuthUser, MeResponse, SessionSummary } from "@/lib/api-types";
import type { RequestClient } from "@/server/auth/guard";
import type { ResolvedSession, SessionRow, UserRow } from "@/server/auth/session";
import type { CcmConfig } from "@/server/config";
import { readStepUpMode } from "@/server/security/step-up";
import { getAutoLockSeconds, getSetting } from "@/server/settings/store";

export function toAuthUser(user: UserRow): AuthUser {
  return { id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword };
}

export function toSessionSummary(session: SessionRow, currentSessionIdHash: string): SessionSummary {
  return {
    id: session.idHash,
    current: session.idHash === currentSessionIdHash,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    ip: session.ip,
    userAgent: session.userAgent,
    networkClass: session.networkClass,
    locked: session.locked,
  };
}

/** What the signed-in client needs to know about itself: user, mode, auto-lock and step-up policy. */
export function buildMeResponse(
  resolvedSession: ResolvedSession,
  client: RequestClient,
  config: CcmConfig,
): MeResponse {
  const enabledActions = getSetting("security.stepUpActions");
  const stepUpMode =
    enabledActions.length === 0
      ? "none"
      : readStepUpMode(enabledActions[0] ?? "download", client.networkClass, config.mode);
  return {
    user: toAuthUser(resolvedSession.user),
    mode: config.mode,
    locked: resolvedSession.isLocked,
    autoLockSeconds: getAutoLockSeconds(),
    stepUp: {
      mode: stepUpMode,
      lanConfirmed: resolvedSession.session.lanConfirmedAt !== null,
      actions: config.mode === "desktop" ? [] : enabledActions,
    },
  };
}
