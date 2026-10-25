import "server-only";
import { networkInterfaces } from "node:os";
import ipaddr from "ipaddr.js";
import type { ApplicationMode } from "@/server/config";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { readTestOverride } from "@/server/runtime/test-hooks";

export type NetworkClass = "loopback" | "lan" | "remote";

/** A subnet this machine is attached to, as `[network address, prefix length]`. */
export type InterfaceSubnet = [ipaddr.IPv4 | ipaddr.IPv6, number];

const SUBNET_CACHE_MILLISECONDS = 60_000;

/** The subnets of every non-internal network interface. */
export function readInterfaceSubnets(): InterfaceSubnet[] {
  const subnets: InterfaceSubnet[] = [];
  for (const interfaceAddresses of Object.values(networkInterfaces())) {
    for (const interfaceAddress of interfaceAddresses ?? []) {
      if (interfaceAddress.internal || !interfaceAddress.cidr) continue;
      try {
        subnets.push(ipaddr.parseCIDR(interfaceAddress.cidr.split("%")[0] ?? ""));
      } catch {
        continue;
      }
    }
  }
  return subnets;
}

/** Classifies an address against the given subnets. Unparseable addresses count as remote. */
export function classifyAddress(address: string, subnets: readonly InterfaceSubnet[]): NetworkClass {
  if (!ipaddr.isValid(address)) return "remote";
  let parsedAddress = ipaddr.parse(address);
  if (parsedAddress.kind() === "ipv6" && (parsedAddress as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsedAddress = (parsedAddress as ipaddr.IPv6).toIPv4Address();
  }
  if (parsedAddress.range() === "loopback") return "loopback";
  const isOnLocalSubnet = subnets.some(
    ([subnetAddress, prefixLength]) =>
      subnetAddress.kind() === parsedAddress.kind() && parsedAddress.match(subnetAddress, prefixLength),
  );
  return isOnLocalSubnet ? "lan" : "remote";
}

interface SubnetCache {
  subnets: InterfaceSubnet[];
  readAt: number;
}

function readCachedSubnets(now: number): InterfaceSubnet[] {
  const subnetCache = getGlobalSingleton<SubnetCache>("network.subnets", () => ({ subnets: [], readAt: 0 }));
  if (now - subnetCache.readAt > SUBNET_CACHE_MILLISECONDS) {
    subnetCache.subnets = readInterfaceSubnets();
    subnetCache.readAt = now;
  }
  return subnetCache.subnets;
}

/**
 * Where the client is: `loopback` (this machine), `lan` (a subnet of one of this machine's
 * interfaces) or `remote`. Desktop mode is always loopback. Tests can force a class with
 * `CCM_TEST_FORCE_NETWORK`.
 */
export function classifyClient(address: string, mode: ApplicationMode, now = Date.now()): NetworkClass {
  if (mode === "desktop") return "loopback";
  const forcedClass = readTestOverride("CCM_TEST_FORCE_NETWORK");
  if (forcedClass === "loopback" || forcedClass === "lan" || forcedClass === "remote") return forcedClass;
  return classifyAddress(address, readCachedSubnets(now));
}
