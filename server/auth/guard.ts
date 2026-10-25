import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import type { ApiErrorBody, StorageAccessLevel } from "@/lib/api-types";
import type { StepUpAction, UserRole } from "@/lib/auth/policy";
import {
  resolveSession,
  SESSION_COOKIE_NAME,
  touchActivity,
  type ResolvedSession,
  type SessionNetworkClass,
} from "@/server/auth/session";
import { getConfig, type CcmConfig } from "@/server/config";
import { ApiRouteError, forbidden, unauthenticated } from "@/server/http/api-error";
import { isSecureRequest, isTrustedProxy, normalizeIp, resolveClientIp } from "@/server/security/client-ip";
import { hasValidLaunchToken, readExpectedLaunchToken } from "@/server/security/launch-token";
import { classifyClient } from "@/server/security/network";
import { ACTION_TOKEN_HEADER, ACTION_TOKEN_QUERY_PARAMETER, requireStepUp } from "@/server/security/step-up";
import { CLIENT_IP_HEADER } from "@/server/security/trusted-headers";
import type { FileActor } from "@/server/storage/pipeline";
import { requireStorageAccess, type ActiveStorage } from "@/server/storage/roots";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type RouteParams = Record<string, string | string[] | undefined>;

export interface RouteContext {
  params: Promise<RouteParams>;
}

/** Who is calling and from where, derived from trusted headers only. */
export interface RequestClient {
  ip: string;
  networkClass: SessionNetworkClass;
  isSecure: boolean;
  userAgent: string | null;
}

export function readRequestClient(requestHeaders: Headers, config: CcmConfig = getConfig()): RequestClient {
  const clientIp = resolveClientIp(requestHeaders, config.trustedProxies);
  return {
    ip: clientIp,
    networkClass: config.mode === "desktop" ? "desktop" : classifyClient(clientIp, config.mode),
    isSecure: isSecureRequest(requestHeaders, Boolean(config.tls), config.trustedProxies),
    userAgent: requestHeaders.get("user-agent"),
  };
}

/**
 * CSRF check for mutating requests: `Origin`, when sent, must name this host. Browsers always send
 * it on cross-site POSTs; non-browser clients (CLI, scripts) send none and can't ride a session
 * cookie anyway, because the cookie is SameSite=Strict.
 */
export function isSameOriginRequest(requestHeaders: Headers, config: CcmConfig = getConfig()): boolean {
  const origin = requestHeaders.get("origin");
  if (origin === null) {
    const fetchSite = requestHeaders.get("sec-fetch-site");
    return fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const acceptedHosts = [requestHeaders.get("host")];
  const peerAddress = normalizeIp(requestHeaders.get(CLIENT_IP_HEADER) ?? "");
  if (isTrustedProxy(peerAddress, config.trustedProxies)) acceptedHosts.push(requestHeaders.get("x-forwarded-host"));
  return acceptedHosts.includes(originHost);
}

interface BaseApiOptions<Body, Query> {
  body?: z.ZodType<Body>;
  query?: z.ZodType<Query>;
}

/** What option callbacks see before validation: the raw JSON body (when the route has a body schema) and the query. */
export interface RouteInput {
  request: NextRequest;
  params: RouteParams;
  searchParams: URLSearchParams;
  rawBody: unknown;
}

export interface StorageAccessRequirement {
  storageId: unknown;
  level: StorageAccessLevel;
}

export interface AuthenticatedApiOptions<Body, Query> extends BaseApiOptions<Body, Query> {
  auth?: true;
  roles?: readonly UserRole[];
  /** Lets the route run while the session is locked (unlock, logout). */
  allowLocked?: boolean;
  /** Lets the route run before a forced password change (me, logout, change password). */
  allowPasswordChangeRequired?: boolean;
  /** Storages the request touches (checked after the role, before step-up: 404 unknown, 403 no access). */
  storageAccess?: (input: RouteInput) => StorageAccessRequirement | readonly StorageAccessRequirement[];
  stepUp?: { action: StepUpAction; resource: (input: RouteInput) => string };
}

export interface PublicApiOptions<Body, Query> extends BaseApiOptions<Body, Query> {
  auth: false;
}

export interface PublicApiContext<Body, Query> {
  request: NextRequest;
  body: Body;
  query: Query;
  params: RouteParams;
  client: RequestClient;
  config: CcmConfig;
  requestId: string;
}

export interface AuthenticatedApiContext<Body, Query> extends PublicApiContext<Body, Query> {
  auth: ResolvedSession;
  /** The signed-in user as file operations see them. */
  actor: FileActor;
  /** A storage checked by `storageAccess`; throws for one the route did not declare. */
  storage: (storageId: string) => ActiveStorage;
}

type RouteHandler = (request: NextRequest, routeContext: RouteContext) => Promise<Response>;

export function apiError(status: number, body: ApiErrorBody, headers?: HeadersInit): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Node file system errors the client can act on, as API errors. Messages never include paths. */
const FILE_SYSTEM_ERRORS: Record<string, () => ApiRouteError> = {
  ENOENT: () => new ApiRouteError(404, "NOT_FOUND", "That file or folder does not exist."),
  EEXIST: () => new ApiRouteError(409, "ALREADY_EXISTS", "A file or folder with that name already exists."),
  ENOTEMPTY: () => new ApiRouteError(409, "ALREADY_EXISTS", "A folder with that name already exists and is not empty."),
  ENOTDIR: () => new ApiRouteError(400, "VALIDATION_FAILED", "Part of that path is a file, not a folder."),
  EISDIR: () => new ApiRouteError(400, "VALIDATION_FAILED", "That path is a folder, not a file."),
  EACCES: () => new ApiRouteError(403, "FORBIDDEN", "The operating system denied access to that file or folder."),
  EPERM: () => new ApiRouteError(403, "FORBIDDEN", "The operating system does not allow that operation."),
  EROFS: () => new ApiRouteError(403, "FORBIDDEN", "That drive is read-only."),
  ENOSPC: () => new ApiRouteError(507, "INSUFFICIENT_SPACE", "There is not enough free space on that drive."),
  ENAMETOOLONG: () => new ApiRouteError(400, "VALIDATION_FAILED", "That name is too long."),
  EBUSY: () => new ApiRouteError(409, "DRIVE_BUSY", "That file or folder is in use."),
};

function toApiError(caughtError: unknown): unknown {
  const errorCode = (caughtError as NodeJS.ErrnoException | undefined)?.code;
  const isFileSystemError = typeof (caughtError as NodeJS.ErrnoException | undefined)?.syscall === "string";
  if (isFileSystemError && errorCode && FILE_SYSTEM_ERRORS[errorCode]) return FILE_SYSTEM_ERRORS[errorCode]();
  return caughtError;
}

function toErrorResponse(thrownError: unknown, requestId: string): NextResponse {
  const caughtError = toApiError(thrownError);
  if (caughtError instanceof ApiRouteError) {
    const retryAfter = caughtError.details?.retryAfter;
    const headers: Record<string, string> = typeof retryAfter === "number" ? { "retry-after": String(retryAfter) } : {};
    return apiError(
      caughtError.status,
      { error: { code: caughtError.code, message: caughtError.message, details: caughtError.details } },
      headers,
    );
  }
  if (caughtError instanceof ZodError) {
    return apiError(400, {
      error: {
        code: "VALIDATION_FAILED",
        message: caughtError.issues[0]?.message ?? "The request is not valid.",
        details: {
          issues: caughtError.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      },
    });
  }
  console.error(`[ccm] request ${requestId} failed`, caughtError);
  return apiError(500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. The server log has details.",
      details: { requestId },
    },
  });
}

async function readJsonBody(request: NextRequest): Promise<unknown> {
  const bodyText = await request.text();
  if (bodyText === "") return {};
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new ApiRouteError(400, "VALIDATION_FAILED", "The request body is not valid JSON.");
  }
}

/**
 * Wraps every route handler under `app/api/**`. Checks, in order: desktop launch token, `Origin` on
 * mutating requests, session (401), lock (423), forced password change (403), role (403), storage
 * access (404/403), step-up (428), then validates the query and body (400). Expected errors (and
 * file system errors such as ENOENT) become the JSON error envelope; anything else is logged with
 * a request id and returned as a 500 without details.
 */
export function withApi<Body = undefined, Query = undefined>(
  handler: (context: AuthenticatedApiContext<Body, Query>) => Response | Promise<Response>,
  options?: AuthenticatedApiOptions<Body, Query>,
): RouteHandler;
export function withApi<Body = undefined, Query = undefined>(
  handler: (context: PublicApiContext<Body, Query>) => Response | Promise<Response>,
  options: PublicApiOptions<Body, Query>,
): RouteHandler;
export function withApi<Body, Query>(
  handler: (context: AuthenticatedApiContext<Body, Query>) => Response | Promise<Response>,
  options: AuthenticatedApiOptions<Body, Query> | PublicApiOptions<Body, Query> = {},
): RouteHandler {
  return async (request, routeContext) => {
    const requestId = randomUUID();
    try {
      const config = getConfig();
      const isMutating = MUTATING_METHODS.has(request.method);
      if (config.mode === "desktop" && !hasValidLaunchToken(request.headers.get("cookie"), readExpectedLaunchToken())) {
        throw forbidden("This request did not come from the CCM desktop app.");
      }
      if (isMutating && !isSameOriginRequest(request.headers, config))
        throw forbidden("Cross-origin requests are not allowed.");

      const client = readRequestClient(request.headers, config);
      const params = (await routeContext?.params) ?? {};
      const routeInput: RouteInput = {
        request,
        params,
        searchParams: request.nextUrl.searchParams,
        rawBody: undefined,
      };
      let resolvedSession: ResolvedSession | undefined;
      const checkedStorages = new Map<string, ActiveStorage>();
      if (options.auth !== false) {
        resolvedSession = resolveSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
        if (!resolvedSession) throw unauthenticated();
        if (resolvedSession.isLocked && !options.allowLocked) {
          throw new ApiRouteError(423, "SESSION_LOCKED", "The session is locked. Unlock it to continue.");
        }
        if (resolvedSession.user.mustChangePassword && !options.allowPasswordChangeRequired) {
          throw new ApiRouteError(403, "PASSWORD_CHANGE_REQUIRED", "Change your password to continue.");
        }
        if (options.roles && !options.roles.includes(resolvedSession.user.role)) throw forbidden();
        if (options.body) routeInput.rawBody = await readJsonBody(request);
        if (options.storageAccess) {
          const requirements = [options.storageAccess(routeInput)].flat();
          for (const requirement of requirements) {
            if (typeof requirement.storageId !== "string" || requirement.storageId === "") {
              throw new ApiRouteError(400, "VALIDATION_FAILED", "Choose a storage.");
            }
            const checkedStorage = requireStorageAccess(resolvedSession.user, requirement.storageId, requirement.level);
            checkedStorages.set(checkedStorage.id, checkedStorage);
          }
        }
        if (options.stepUp) {
          requireStepUp({
            resolvedSession,
            action: options.stepUp.action,
            resource: options.stepUp.resource(routeInput),
            networkClass: client.networkClass,
            mode: config.mode,
            actionToken:
              request.headers.get(ACTION_TOKEN_HEADER) ??
              request.nextUrl.searchParams.get(ACTION_TOKEN_QUERY_PARAMETER),
          });
        }
        if (isMutating && !resolvedSession.isLocked) touchActivity(resolvedSession.session.idHash);
      } else if (options.body) {
        routeInput.rawBody = await readJsonBody(request);
      }

      const query = options.query ? options.query.parse(Object.fromEntries(request.nextUrl.searchParams)) : undefined;
      const body = options.body ? options.body.parse(routeInput.rawBody) : undefined;
      const sessionUser = resolvedSession?.user;
      return await handler({
        request,
        auth: resolvedSession as ResolvedSession,
        actor: sessionUser
          ? {
              id: sessionUser.id,
              username: sessionUser.username,
              role: sessionUser.role,
              sessionIdHash: resolvedSession?.session.idHash,
            }
          : (undefined as unknown as FileActor),
        storage: (storageId) => {
          const checkedStorage = checkedStorages.get(storageId);
          if (!checkedStorage) throw forbidden("You don't have access to this storage.");
          return checkedStorage;
        },
        body: body as Body,
        query: query as Query,
        params,
        client,
        config,
        requestId,
      });
    } catch (caughtError) {
      return toErrorResponse(caughtError, requestId);
    }
  };
}

/**
 * Asks for step-up inside a handler, for routes whose action depends on the request (trash bulk
 * actions). Same rules as the `stepUp` option.
 */
export function requireHandlerStepUp(
  context: Pick<AuthenticatedApiContext<unknown, unknown>, "auth" | "client" | "config" | "request">,
  action: StepUpAction,
  resource: string,
): void {
  requireStepUp({
    resolvedSession: context.auth,
    action,
    resource,
    networkClass: context.client.networkClass,
    mode: context.config.mode,
    actionToken:
      context.request.headers.get(ACTION_TOKEN_HEADER) ??
      context.request.nextUrl.searchParams.get(ACTION_TOKEN_QUERY_PARAMETER),
  });
}

/** The signed-in session for server components and pages, or undefined. Locked sessions are returned with `isLocked`. */
export async function getAuthContext(): Promise<ResolvedSession | undefined> {
  const cookieStore = await cookies();
  return resolveSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

/** Reads a single string route parameter. */
export function readRouteParameter(params: RouteParams, parameterName: string): string {
  const parameterValue = params[parameterName];
  return Array.isArray(parameterValue) ? (parameterValue[0] ?? "") : (parameterValue ?? "");
}
