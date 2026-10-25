import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { buildExpiredSessionCookie, destroySession, resolveSession, SESSION_COOKIE_NAME } from "@/server/auth/session";

/** Signs out. Idempotent: with no valid session it only clears the cookie. Works while locked. */
export const POST = withApi(
  ({ request, client }) => {
    const resolvedSession = resolveSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (resolvedSession) destroySession(resolvedSession.session.idHash, resolvedSession.user.id, "logout");
    const response = NextResponse.json({ ok: true });
    response.cookies.set(buildExpiredSessionCookie(client.isSecure));
    return response;
  },
  { auth: false },
);
