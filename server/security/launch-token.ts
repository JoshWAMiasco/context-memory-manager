import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

export const LAUNCH_COOKIE_NAME = "ccm_launch";
export const LAUNCH_TOKEN_ENVIRONMENT_VARIABLE = "CCM_LAUNCH_TOKEN";

/** Reads one cookie from a raw `Cookie` header. */
export function readCookie(cookieHeader: string | null | undefined, cookieName: string): string | undefined {
  for (const cookiePair of (cookieHeader ?? "").split(";")) {
    const separatorIndex = cookiePair.indexOf("=");
    if (separatorIndex === -1) continue;
    if (cookiePair.slice(0, separatorIndex).trim() === cookieName) return cookiePair.slice(separatorIndex + 1).trim();
  }
  return undefined;
}

/**
 * Desktop mode only: true when the request carries the `ccm_launch` cookie the Electron main process
 * set for this launch. Compared in constant time. Without it, other local processes can't use CCM.
 */
export function hasValidLaunchToken(
  cookieHeader: string | null | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return false;
  const givenToken = readCookie(cookieHeader, LAUNCH_COOKIE_NAME);
  if (!givenToken) return false;
  const digest = (token: string) => createHash("sha256").update(token).digest();
  return timingSafeEqual(digest(givenToken), digest(expectedToken));
}

/** The launch token of this process, set by the Electron main process. */
export function readExpectedLaunchToken(): string | undefined {
  return process.env[LAUNCH_TOKEN_ENVIRONMENT_VARIABLE] || undefined;
}
