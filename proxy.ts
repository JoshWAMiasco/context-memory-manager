import { NextResponse, type NextRequest } from "next/server";
import { isSetupComplete } from "@/server/auth/setup";
import { resolveSession, SESSION_COOKIE_NAME } from "@/server/auth/session";

/** Pages anyone may open. Everything else needs an unlocked session (checked fully again by pages and `withApi`). */
const PUBLIC_PAGE_PATHS = new Set(["/login", "/setup", "/lock"]);

function buildContentSecurityPolicy(nonce: string): string {
  const isDevelopment = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function redirectTo(request: NextRequest, targetPath: string, shouldKeepNext: boolean): NextResponse {
  const targetUrl = new URL(targetPath, request.url);
  if (shouldKeepNext) targetUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(targetUrl);
}

/** Decides where a page request may go, or returns undefined to let it through. */
function routePageRequest(request: NextRequest): NextResponse | undefined {
  const { pathname } = request.nextUrl;
  if (!isSetupComplete()) return pathname === "/setup" ? undefined : redirectTo(request, "/setup", false);
  if (pathname === "/setup") return redirectTo(request, "/login", false);
  if (PUBLIC_PAGE_PATHS.has(pathname)) return undefined;

  const resolvedSession = resolveSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!resolvedSession) return redirectTo(request, "/login", pathname !== "/");
  if (resolvedSession.isLocked) return redirectTo(request, "/lock", true);
  return undefined;
}

/**
 * The cheap first gate for pages (API routes are checked by `withApi`): sends visitors to
 * `/setup`, `/login` or `/lock` as needed, and sets a per-request CSP nonce that Next applies to
 * its scripts.
 */
export function proxy(request: NextRequest) {
  const redirectResponse = routePageRequest(request);
  if (redirectResponse) return redirectResponse;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", contentSecurityPolicy);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "same-origin");
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icons/|vendor/).*)"],
};
