import "server-only";
import { ApiRouteError } from "@/server/http/api-error";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { getSignInLockoutPolicy } from "@/server/settings/store";

/** After `maximumAttempts` failures within `lockoutMilliseconds`, the key is locked for `lockoutMilliseconds`. */
export interface LockoutPolicy {
  maximumAttempts: number;
  lockoutMilliseconds: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = { maximumAttempts: 5, lockoutMilliseconds: 15 * 60_000 };

export interface FailureOutcome {
  /** Failures left before the lock; 0 when this failure locked the key. */
  attemptsRemaining: number;
  /** Set when this failure locked the key. */
  lockedUntil?: number;
}

interface AttemptRecord {
  failureTimes: number[];
  lockedUntil: number;
}

/** Formats a wait for people: "45 seconds", "1 minute", "15 minutes", "2 hours". */
export function describeWait(waitMilliseconds: number): string {
  const waitSeconds = Math.max(1, Math.ceil(waitMilliseconds / 1000));
  if (waitSeconds < 60) return `${waitSeconds} second${waitSeconds === 1 ? "" : "s"}`;
  const waitMinutes = Math.ceil(waitSeconds / 60);
  if (waitMinutes < 120) return `${waitMinutes} minute${waitMinutes === 1 ? "" : "s"}`;
  const waitHours = Math.ceil(waitMinutes / 60);
  return `${waitHours} hours`;
}

function buildLockedError(lockedUntil: number, now: number): ApiRouteError {
  const waitMilliseconds = lockedUntil - now;
  return new ApiRouteError(
    429,
    "RATE_LIMITED",
    `Too many failed attempts. Try again in ${describeWait(waitMilliseconds)}.`,
    {
      retryAfter: Math.ceil(waitMilliseconds / 1000),
      lockedUntil: new Date(lockedUntil).toISOString(),
    },
  );
}

/**
 * Counts failed attempts per key (for example `ip|username`) and locks the key for a while after
 * too many. The policy is read on every call, so changing the settings applies immediately. Only
 * failures count; a success resets the key. In memory: a restart clears every lock.
 */
export class RateLimiter {
  private readonly records = new Map<string, AttemptRecord>();

  constructor(private readonly readPolicy: () => LockoutPolicy = () => DEFAULT_LOCKOUT_POLICY) {}

  /** Milliseconds until `key` may try again, or 0 when it may try now. */
  readRetryDelay(key: string, now = Date.now()): number {
    const lockedUntil = this.records.get(key)?.lockedUntil ?? 0;
    return lockedUntil > now ? lockedUntil - now : 0;
  }

  /** Throws `429 RATE_LIMITED` (with `details.retryAfter` in seconds and `lockedUntil`) while `key` is locked. */
  assertAllowed(key: string, now = Date.now()): void {
    const lockedUntil = this.records.get(key)?.lockedUntil ?? 0;
    if (lockedUntil > now) throw buildLockedError(lockedUntil, now);
  }

  /** Records a failure and reports how many attempts are left, locking the key when none are. */
  recordFailure(key: string, now = Date.now()): FailureOutcome {
    const { maximumAttempts, lockoutMilliseconds } = this.readPolicy();
    const record = this.records.get(key) ?? { failureTimes: [], lockedUntil: 0 };
    if (record.lockedUntil !== 0 && record.lockedUntil <= now) record.lockedUntil = 0;
    record.failureTimes = record.failureTimes.filter((failureTime) => now - failureTime < lockoutMilliseconds);
    record.failureTimes.push(now);
    this.records.set(key, record);
    this.pruneStaleRecords(now, lockoutMilliseconds);

    if (record.failureTimes.length >= maximumAttempts) {
      record.lockedUntil = now + lockoutMilliseconds;
      record.failureTimes = [];
      return { attemptsRemaining: 0, lockedUntil: record.lockedUntil };
    }
    return { attemptsRemaining: maximumAttempts - record.failureTimes.length };
  }

  /**
   * Records a failure and returns the error to throw: `429 RATE_LIMITED` when this failure locked
   * the key, otherwise `failureError` with `details.attemptsRemaining` added.
   *
   * @example
   * if (!isPasswordCorrect) throw rateLimiter.rejectAttempt(limiterKey, invalidCredentials());
   */
  rejectAttempt(key: string, failureError: ApiRouteError, now = Date.now()): ApiRouteError {
    const { attemptsRemaining, lockedUntil } = this.recordFailure(key, now);
    if (lockedUntil !== undefined) return buildLockedError(lockedUntil, now);
    return new ApiRouteError(failureError.status, failureError.code, failureError.message, {
      ...failureError.details,
      attemptsRemaining,
    });
  }

  reset(key: string): void {
    this.records.delete(key);
  }

  private pruneStaleRecords(now: number, lockoutMilliseconds: number): void {
    if (this.records.size < 10_000) return;
    for (const [recordKey, record] of this.records) {
      const lastFailure = record.failureTimes.at(-1) ?? 0;
      if (record.lockedUntil <= now && now - lastFailure > lockoutMilliseconds) this.records.delete(recordKey);
    }
  }
}

export type RateLimiterName = "login" | "password-confirm" | "setup-code" | "key-file";

/**
 * The process-wide limiter for one kind of attempt. Sign-in and password confirmation (unlock,
 * step-up) follow the admin's sign-in lockout settings; the setup code uses the default policy.
 */
export function getRateLimiter(limiterName: RateLimiterName): RateLimiter {
  const readPolicy = limiterName === "setup-code" ? () => DEFAULT_LOCKOUT_POLICY : getSignInLockoutPolicy;
  return getGlobalSingleton(
    `rate-limiter.${limiterName}`,
    () => new RateLimiter(readPolicy),
    (storedValue) => typeof (storedValue as Partial<RateLimiter> | undefined)?.rejectAttempt === "function",
  );
}
