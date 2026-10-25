import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import type { ApplicationMode } from "@/server/config";
import { getConfig } from "@/server/config";
import { getDatabase } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { getEventBus, type SessionDestroyedEvent, type SessionLockedEvent } from "@/server/events/bus";
import { requirePasswordConfirm } from "@/server/security/password-confirm";
import { getAutoLockSeconds } from "@/server/settings/store";

export const SESSION_COOKIE_NAME = "ccm_session";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionNetworkClass = SessionRow["networkClass"];

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  isLocked: boolean;
}

export interface SessionClientInfo {
  ip: string;
  userAgent: string | null;
  networkClass: SessionNetworkClass;
}

/** Sessions are stored by the SHA-256 of their token, so a database leak doesn't leak live tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** How long a session lives regardless of activity: 7 days on a server, 30 days on the desktop. */
export function getSessionLifetimeMilliseconds(mode: ApplicationMode = getConfig().mode): number {
  return (mode === "desktop" ? 30 : 7) * DAY_MILLISECONDS;
}

/** Creates a session for `user` and returns its token (sent once, as the cookie) and its row. */
export function createSession(
  user: UserRow,
  client: SessionClientInfo,
  now = Date.now(),
): { token: string; session: SessionRow } {
  const token = randomBytes(32).toString("base64url");
  const session = getDatabase()
    .orm.insert(sessions)
    .values({
      idHash: hashToken(token),
      userId: user.id,
      createdAt: new Date(now),
      lastActivityAt: new Date(now),
      locked: false,
      ip: client.ip || null,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
      networkClass: client.networkClass,
    })
    .returning()
    .get();
  return { token, session };
}

/**
 * Looks up the session for a cookie token and applies the time rules: past its absolute lifetime
 * (or with a disabled user) it is destroyed; idle longer than the auto-lock time it is locked.
 * Returns undefined when there is no usable session.
 */
export function resolveSession(token: string | undefined, now = Date.now()): ResolvedSession | undefined {
  if (!token) return undefined;
  const sessionWithUser = getDatabase()
    .orm.select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.idHash, hashToken(token)))
    .get();
  if (!sessionWithUser) return undefined;

  const { session, user } = sessionWithUser;
  if (user.disabled) {
    destroySession(session.idHash, user.id, "revoked");
    return undefined;
  }
  if (now - session.createdAt.getTime() > getSessionLifetimeMilliseconds()) {
    destroySession(session.idHash, user.id, "expired");
    return undefined;
  }
  if (!session.locked && now - session.lastActivityAt.getTime() > getAutoLockSeconds() * 1000) {
    lockSession(session.idHash, user.id, "idle");
    return { session: { ...session, locked: true }, user, isLocked: true };
  }
  return { session, user, isLocked: session.locked };
}

/** Records user activity. Only explicit pings and mutating requests call this, never SSE or polling. */
export function touchActivity(sessionIdHash: string, now = Date.now()): void {
  getDatabase()
    .orm.update(sessions)
    .set({ lastActivityAt: new Date(now) })
    .where(and(eq(sessions.idHash, sessionIdHash), eq(sessions.locked, false)))
    .run();
}

export function lockSession(sessionIdHash: string, userId: string, reason: SessionLockedEvent["reason"]): void {
  getDatabase().orm.update(sessions).set({ locked: true }).where(eq(sessions.idHash, sessionIdHash)).run();
  getEventBus().emit("session.locked", { sessionIdHash, userId, reason });
}

/** Unlocks a locked session after checking the user's password (rate-limited). */
export async function unlockSession(
  resolvedSession: ResolvedSession,
  password: string,
  clientIp: string,
  now = Date.now(),
): Promise<void> {
  await requirePasswordConfirm({ user: resolvedSession.user, password, ip: clientIp });
  getDatabase()
    .orm.update(sessions)
    .set({ locked: false, lastActivityAt: new Date(now) })
    .where(eq(sessions.idHash, resolvedSession.session.idHash))
    .run();
}

export function destroySession(sessionIdHash: string, userId: string, reason: SessionDestroyedEvent["reason"]): void {
  getDatabase().orm.delete(sessions).where(eq(sessions.idHash, sessionIdHash)).run();
  getEventBus().emit("session.destroyed", { sessionIdHash, userId, reason });
}

export function listSessions(userId: string): SessionRow[] {
  return getDatabase()
    .orm.select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastActivityAt))
    .all();
}

/** Revokes one of `userId`'s own sessions. Returns false when no such session exists. */
export function revokeSession(sessionIdHash: string, userId: string): boolean {
  const ownedSession = getDatabase()
    .orm.select({ idHash: sessions.idHash })
    .from(sessions)
    .where(and(eq(sessions.idHash, sessionIdHash), eq(sessions.userId, userId)))
    .get();
  if (!ownedSession) return false;
  destroySession(sessionIdHash, userId, "revoked");
  return true;
}

/** Revokes every session of `userId`, except `keptSessionIdHash` when given. */
export function revokeUserSessions(userId: string, keptSessionIdHash?: string): void {
  const revokedSessions = getDatabase()
    .orm.select({ idHash: sessions.idHash })
    .from(sessions)
    .where(
      keptSessionIdHash
        ? and(eq(sessions.userId, userId), ne(sessions.idHash, keptSessionIdHash))
        : eq(sessions.userId, userId),
    )
    .all();
  for (const revokedSession of revokedSessions) destroySession(revokedSession.idHash, userId, "revoked");
}

/** The `ccm_session` cookie: httpOnly, SameSite=Strict, Path=/, Secure over TLS, expiring with the session. */
export function buildSessionCookie(token: string, isSecure: boolean) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    secure: isSecure,
    maxAge: Math.floor(getSessionLifetimeMilliseconds() / 1000),
  };
}

/** Deletes the session cookie in the browser. */
export function buildExpiredSessionCookie(isSecure: boolean) {
  return { ...buildSessionCookie("", isSecure), maxAge: 0 };
}
