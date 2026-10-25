/*
 * Navigation and permission rules of the desktop window. Pure functions, so they are unit
 * tested without Electron; `main.ts` wires them to `will-navigate`, `setWindowOpenHandler` and the
 * session's permission handlers.
 */
import { isExternalLink } from "@/lib/desktop-bridge";

/** Where a navigation may go: stay in the app, leave it through the browser (after a confirm), or nowhere. */
export type NavigationVerdict = "app" | "external" | "blocked";

/**
 * Permissions the window may use. Everything else (camera, microphone, geolocation, notifications,
 * MIDI, HID, serial…) is denied without asking. "Copy path" needs the clipboard write.
 */
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);

/**
 * Sorts a URL the window wants to open: the app's own origin (`http://127.0.0.1:<port>`) is "app",
 * an http(s) or mailto link elsewhere is "external", anything else (file:, data:, javascript:,
 * custom schemes, other loopback ports) is "blocked".
 *
 * @example
 * classifyNavigation("http://127.0.0.1:5123/login", "http://127.0.0.1:5123"); // "app"
 * classifyNavigation("https://example.com", "http://127.0.0.1:5123"); // "external"
 * classifyNavigation("file:///etc/hosts", "http://127.0.0.1:5123"); // "blocked"
 */
export function classifyNavigation(targetUrl: string, appOrigin: string): NavigationVerdict {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return "blocked";
  }
  if (parsedUrl.origin === appOrigin) return "app";
  if (parsedUrl.protocol === "mailto:") return "external";
  if (!isExternalLink(targetUrl)) return "blocked";
  return isLoopbackHost(parsedUrl.hostname) ? "blocked" : "external";
}

/** Other local servers are neither the app nor "the internet": the window never opens them. */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
}

/**
 * True for the few permissions the window gets; requests for anything else are denied.
 *
 * @example
 * isPermissionAllowed("clipboard-sanitized-write"); // true
 * isPermissionAllowed("media"); // false
 */
export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/**
 * The text of the "this link leaves CCM" confirmation: the host, so the user sees where it goes.
 *
 * @example
 * describeExternalLink("https://docs.example.com/a?b=c"); // "docs.example.com"
 */
export function describeExternalLink(targetUrl: string): string {
  try {
    const parsedUrl = new URL(targetUrl);
    return parsedUrl.protocol === "mailto:" ? parsedUrl.pathname : parsedUrl.host;
  } catch {
    return targetUrl;
  }
}
