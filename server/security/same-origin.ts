import "server-only";
import { getConfig, type CmmConfig } from "@/server/config";
import { isTrustedProxy, normalizeIp } from "@/server/security/client-ip";
import { CLIENT_IP_HEADER } from "@/server/security/trusted-headers";

/**
 * CSRF check for mutating requests: `Origin`, when sent, must name this host. Browsers always send
 * it on cross-site POSTs; non-browser clients (CLI, scripts) send none and can't ride a session
 * cookie anyway, because the cookie is SameSite=Strict.
 */
export function isSameOriginRequest(requestHeaders: Headers, config: CmmConfig = getConfig()): boolean {
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
