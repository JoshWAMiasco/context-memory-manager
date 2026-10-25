import "server-only";
import type { IncomingMessage } from "node:http";

/** Set by the entry from the TCP socket; route handlers trust only this header for the client IP. */
export const CLIENT_IP_HEADER = "x-ccm-client-ip";

/**
 * Headers only the entry may set. Client headers with these names are dropped. Other `x-ccm-*`
 * headers (such as the client's `x-ccm-action-token`) pass through untouched.
 */
const ENTRY_SET_HEADERS = new Set([CLIENT_IP_HEADER]);

/**
 * Removes any client-sent copy of the entry-set headers, then sets `x-ccm-client-ip` from the
 * socket's remote address. Runs in the entry before Next sees the request, so no client can spoof it.
 */
export function applyTrustedHeaders(request: IncomingMessage): void {
  for (const headerName of Object.keys(request.headers)) {
    if (ENTRY_SET_HEADERS.has(headerName)) delete request.headers[headerName];
  }
  const keptRawHeaders: string[] = [];
  for (let headerIndex = 0; headerIndex < request.rawHeaders.length; headerIndex += 2) {
    const headerName = request.rawHeaders[headerIndex] ?? "";
    if (ENTRY_SET_HEADERS.has(headerName.toLowerCase())) continue;
    keptRawHeaders.push(headerName, request.rawHeaders[headerIndex + 1] ?? "");
  }

  const remoteAddress = request.socket.remoteAddress;
  if (remoteAddress) {
    request.headers[CLIENT_IP_HEADER] = remoteAddress;
    keptRawHeaders.push(CLIENT_IP_HEADER, remoteAddress);
  }
  request.rawHeaders.splice(0, request.rawHeaders.length, ...keptRawHeaders);
}
