import "server-only";
import type { ApiErrorCode } from "@/lib/api-types";

/** Marks API errors with a registry symbol, shared by every copy of this module in the process. */
const API_ROUTE_ERROR_BRAND = Symbol.for("ccm.api-route-error");

/**
 * An expected failure a route handler reports to the client as `{ error: { code, message, details } }`.
 * `instanceof` also recognises errors thrown by another copy of this module (the entry bundle and
 * Next's chunks each load one; pipeline guards registered by a service run in the entry's copy).
 */
export class ApiRouteError extends Error {
  override name = "ApiRouteError";
  readonly [API_ROUTE_ERROR_BRAND] = true;

  static override [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && API_ROUTE_ERROR_BRAND in value;
  }

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const unauthenticated = (message = "Sign in to continue.") => new ApiRouteError(401, "UNAUTHENTICATED", message);

export const invalidCredentials = () =>
  new ApiRouteError(401, "INVALID_CREDENTIALS", "The username or password is wrong.");

export const forbidden = (message = "You don't have access to this.") => new ApiRouteError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found.") => new ApiRouteError(404, "NOT_FOUND", message);

export const conflict = (code: ApiErrorCode, message: string) => new ApiRouteError(409, code, message);

export const validationFailed = (message: string, details?: Record<string, unknown>) =>
  new ApiRouteError(400, "VALIDATION_FAILED", message, details);
