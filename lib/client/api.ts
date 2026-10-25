import { showToastNotification } from "@/components/interactive/toast-notification";
import type { ApiErrorBody } from "@/lib/api-types";
import type { StepUpAction, StepUpMode } from "@/lib/auth/policy";
import { goToSessionPage } from "@/lib/client/session-channel";
import { ACTION_TOKEN_HEADER, promptStepUp } from "@/lib/client/step-up";

/** An API call that failed: the HTTP status plus the server's error `code` (see overview §8). */
export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Default true: 401 goes to /login, 423 to /lock, 429 shows a toast. Sign-in forms turn it off. */
  handleSessionErrors?: boolean;
  /** Default true: 428 opens the step-up modal and retries once after confirmation. */
  handleStepUp?: boolean;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const errorValue = (value as { error: unknown }).error;
  return typeof errorValue === "object" && errorValue !== null && "code" in errorValue && "message" in errorValue;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (responseText === "") return undefined;
  try {
    return JSON.parse(responseText);
  } catch {
    return undefined;
  }
}

/**
 * Turns a failed response's JSON error envelope into an `ApiError`.
 *
 * @example
 * throw toApiError(response.status, await response.json().catch(() => undefined));
 */
export function toApiError(status: number, responseBody: unknown): ApiError {
  if (isApiErrorBody(responseBody)) {
    return new ApiError(status, responseBody.error.code, responseBody.error.message, responseBody.error.details);
  }
  return new ApiError(status, "HTTP_ERROR", `Request failed with status ${status}.`);
}

/**
 * Sends the user to /login or /lock for session errors, and shows a toast when rate limited. Call
 * it for requests made outside `requestJson`.
 *
 * @example
 * handleSessionError(apiError);
 */
export function handleSessionError(apiError: ApiError): void {
  if (typeof window === "undefined") return;
  if (apiError.code === "UNAUTHENTICATED" || apiError.code === "PASSWORD_CHANGE_REQUIRED") goToSessionPage("/login");
  if (apiError.code === "SESSION_LOCKED") goToSessionPage("/lock");
  if (apiError.code === "RATE_LIMITED")
    showToastNotification({ title: "Too many attempts", description: apiError.message, tone: "error" });
}

/**
 * Calls a CMM API route and returns its JSON body. Sends `body` as JSON. A non-2xx response throws
 * an `ApiError` carrying the server's error code; a network failure throws one with code
 * `NETWORK_ERROR` and status 0. Session errors and step-up are handled as described in the options.
 *
 * @example
 * const health = await requestJson<HealthResponse>("/api/health");
 */
export async function requestJson<ResponseBody>(url: string, options: ApiRequestOptions = {}): Promise<ResponseBody> {
  const { method = "GET", body, headers = {}, signal, handleSessionErrors = true, handleStepUp = true } = options;
  const requestHeaders: Record<string, string> = { accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") throw networkError;
    throw new ApiError(0, "NETWORK_ERROR", "The CMM server could not be reached.");
  }

  const responseBody = await readJsonSafely(response);
  if (response.ok) return responseBody as ResponseBody;

  const apiError = toApiError(response.status, responseBody);
  if (handleStepUp && apiError.code === "STEP_UP_REQUIRED" && apiError.details) {
    const stepUpResult = await promptStepUp({
      mode: apiError.details.mode as StepUpMode,
      action: apiError.details.action as StepUpAction,
      resource: String(apiError.details.resource),
    });
    if (stepUpResult.confirmed) {
      const retryHeaders = stepUpResult.actionToken
        ? { ...headers, [ACTION_TOKEN_HEADER]: stepUpResult.actionToken }
        : headers;
      return requestJson<ResponseBody>(url, { ...options, headers: retryHeaders, handleStepUp: false });
    }
  }
  if (handleSessionErrors) handleSessionError(apiError);
  throw apiError;
}

/**
 * Posts a multipart form (key files) and returns the JSON body. Errors and session handling
 * are as in `requestJson`; there is no step-up retry.
 *
 * @example
 * await requestForm("/api/crypto/unlock?storageId=s&path=persona", formData);
 */
export async function requestForm<ResponseBody>(
  url: string,
  formData: FormData,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ResponseBody> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json" },
      body: formData,
      credentials: "same-origin",
      signal,
    });
  } catch (networkError) {
    if (networkError instanceof DOMException && networkError.name === "AbortError") throw networkError;
    throw new ApiError(0, "NETWORK_ERROR", "The CMM server could not be reached.");
  }
  const responseBody = await readJsonSafely(response);
  if (response.ok) return responseBody as ResponseBody;
  const apiError = toApiError(response.status, responseBody);
  handleSessionError(apiError);
  throw apiError;
}
