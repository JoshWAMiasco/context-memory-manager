import "server-only";
import { notFound, redirect } from "next/navigation";
import type { UserRole } from "@/lib/auth/policy";
import { getAuthContext } from "@/server/auth/guard";
import type { ResolvedSession } from "@/server/auth/session";

/**
 * The page-level guard. Every page under `app/(app)` calls it first, so a hand-typed URL can't reach
 * a page without an unlocked session, even where the proxy or the layout is skipped (layouts don't
 * re-render on every client navigation). Sends visitors to /login or /lock, and answers 404 when the
 * role is not allowed (the page's existence is not revealed).
 */
export async function requirePageSession(options: { roles?: readonly UserRole[] } = {}): Promise<ResolvedSession> {
  const authContext = await getAuthContext();
  if (!authContext || authContext.user.mustChangePassword) redirect("/login");
  if (authContext.isLocked) redirect("/lock");
  if (options.roles && !options.roles.includes(authContext.user.role)) notFound();
  return authContext;
}
