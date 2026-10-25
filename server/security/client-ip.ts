import "server-only";
import ipaddr from "ipaddr.js";
import { CLIENT_IP_HEADER } from "@/server/security/trusted-headers";

/** Trims brackets and zone ids and turns IPv4-mapped IPv6 (`::ffff:a.b.c.d`) into plain IPv4. */
export function normalizeIp(address: string): string {
  const withoutBrackets = address.trim().replace(/^\[|\]$/g, "");
  const withoutZone = withoutBrackets.split("%")[0] ?? "";
  if (!ipaddr.isValid(withoutZone)) return withoutZone;
  const parsedAddress = ipaddr.parse(withoutZone);
  if (parsedAddress.kind() === "ipv6" && (parsedAddress as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (parsedAddress as ipaddr.IPv6).toIPv4Address().toString();
  }
  return parsedAddress.toString();
}

/** True when `address` equals, or falls inside, one of `trustedProxies` (IPs or CIDRs). */
export function isTrustedProxy(address: string, trustedProxies: readonly string[]): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsedAddress = ipaddr.parse(address);
  return trustedProxies.some((trustedEntry) => {
    try {
      if (trustedEntry.includes("/")) {
        const [rangeAddress, prefixLength] = ipaddr.parseCIDR(trustedEntry);
        return parsedAddress.kind() === rangeAddress.kind() && parsedAddress.match(rangeAddress, prefixLength);
      }
      return normalizeIp(trustedEntry) === parsedAddress.toString();
    } catch {
      return false;
    }
  });
}

/**
 * The client's IP. The socket address comes from the `x-ccm-client-ip` header that the entry sets
 * (clients can't spoof it). Only when that peer is a trusted proxy is `X-Forwarded-For` read, taking
 * the right-most address that isn't itself a trusted proxy.
 */
export function resolveClientIp(headers: Headers, trustedProxies: readonly string[]): string {
  const peerAddress = normalizeIp(headers.get(CLIENT_IP_HEADER) ?? "");
  if (!peerAddress || !isTrustedProxy(peerAddress, trustedProxies)) return peerAddress;

  const forwardedAddresses = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((forwardedAddress) => normalizeIp(forwardedAddress))
    .filter((forwardedAddress) => ipaddr.isValid(forwardedAddress));
  for (let addressIndex = forwardedAddresses.length - 1; addressIndex >= 0; addressIndex -= 1) {
    const forwardedAddress = forwardedAddresses[addressIndex] ?? "";
    if (!isTrustedProxy(forwardedAddress, trustedProxies)) return forwardedAddress;
  }
  return forwardedAddresses[0] ?? peerAddress;
}

/** True when the request reached CCM over TLS: CCM's own TLS, or `X-Forwarded-Proto: https` from a trusted proxy. */
export function isSecureRequest(headers: Headers, hasOwnTls: boolean, trustedProxies: readonly string[]): boolean {
  if (hasOwnTls) return true;
  const peerAddress = normalizeIp(headers.get(CLIENT_IP_HEADER) ?? "");
  return (
    isTrustedProxy(peerAddress, trustedProxies) && headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}
