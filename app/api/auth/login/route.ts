import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { toAuthUser } from "@/server/auth/me";
import { verifyAgainstDecoy, verifyPassword } from "@/server/auth/password";
import { buildSessionCookie, createSession } from "@/server/auth/session";
import { findUserByUsername, recordLogin } from "@/server/auth/users";
import { invalidCredentials } from "@/server/http/api-error";
import { buildThemeCookie } from "@/lib/theme";
import { getRateLimiter } from "@/server/security/rate-limit";

const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1024),
});

export const POST = withApi(
  async ({ body, client }) => {
    const username = body.username.toLowerCase();
    const rateLimiter = getRateLimiter("login");
    const limiterKey = `${client.ip}|${username}`;
    rateLimiter.assertAllowed(limiterKey);

    const user = findUserByUsername(username);
    const isPasswordCorrect = user
      ? await verifyPassword(user.passwordHash, body.password)
      : await verifyAgainstDecoy(body.password);
    if (!user || !isPasswordCorrect || user.disabled) throw rateLimiter.rejectAttempt(limiterKey, invalidCredentials());
    rateLimiter.reset(limiterKey);

    const { token } = createSession(user, client);
    recordLogin(user.id);
    const response = NextResponse.json({ user: toAuthUser(user) });
    response.cookies.set(buildSessionCookie(token, client.isSecure));
    // The page is rendered in the user's theme from now on, in this browser too.
    response.cookies.set(buildThemeCookie(user.theme, client.isSecure));
    return response;
  },
  { auth: false, body: loginBodySchema },
);
