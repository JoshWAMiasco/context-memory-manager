import { ApiError } from "@/lib/client/api";

/**
 * The message to show under a password form. A wrong password says how many attempts are left
 * before the lockout; a lockout (`RATE_LIMITED`) says how long to wait.
 *
 * @example
 * setErrorMessage(describePasswordError(requestError, "Unlocking failed. Try again."));
 */
export function describePasswordError(requestError: unknown, fallbackMessage: string): string {
  if (!(requestError instanceof ApiError)) return fallbackMessage;
  if (requestError.code !== "INVALID_CREDENTIALS") return requestError.message;
  const attemptsRemaining = requestError.details?.attemptsRemaining;
  if (typeof attemptsRemaining !== "number") return requestError.message;
  const attemptsText = `${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"}`;
  return `${requestError.message} ${attemptsText} left before it locks.`;
}
