import "server-only";
import { verifyPassword } from "@/server/auth/password";
import { ApiRouteError } from "@/server/http/api-error";
import { getRateLimiter } from "@/server/security/rate-limit";

export interface PasswordConfirmRequest {
  user: { username: string; passwordHash: string };
  password: string;
  ip: string;
}

/**
 * Checks the signed-in user's password again before a sensitive action (unlocking the session,
 * step-up, and later unlocking protected or encrypted folders). Locked out per `ip|username` after
 * the admin's maximum number of wrong passwords.
 */
export async function requirePasswordConfirm({ user, password, ip }: PasswordConfirmRequest): Promise<void> {
  const rateLimiter = getRateLimiter("password-confirm");
  const limiterKey = `${ip}|${user.username}`;
  rateLimiter.assertAllowed(limiterKey);
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw rateLimiter.rejectAttempt(
      limiterKey,
      new ApiRouteError(401, "INVALID_CREDENTIALS", "The password is wrong."),
    );
  }
  rateLimiter.reset(limiterKey);
}
