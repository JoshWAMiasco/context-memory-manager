import "server-only";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/** Thrown when code tries to open a connection to anything other than this machine. */
export class OfflineViolationError extends Error {
  override name = "OfflineViolationError";

  constructor(readonly host: string) {
    super(`Offline guard blocked an outbound connection to "${host}". CMM must not use the network at runtime.`);
  }
}

const INSTALLED_MARKER = Symbol.for("cmm.offline-guard");

/** True for names and addresses that stay on this machine: localhost, 127.0.0.0/8, ::1 and 0.0.0.0. */
export function isLoopbackHost(host: string): boolean {
  const normalizedHost = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (normalizedHost === "" || normalizedHost === "localhost" || normalizedHost.endsWith(".localhost")) return true;
  if (normalizedHost === "::1" || normalizedHost === "::" || normalizedHost === "0.0.0.0") return true;
  const ipv4Text = normalizedHost.startsWith("::ffff:") ? normalizedHost.slice("::ffff:".length) : normalizedHost;
  return net.isIPv4(ipv4Text) && ipv4Text.startsWith("127.");
}

function assertLoopback(host: string): void {
  if (!isLoopbackHost(host)) throw new OfflineViolationError(host);
}

function stripPort(hostWithPort: string): string {
  if (hostWithPort.startsWith("[")) return hostWithPort.slice(1, hostWithPort.indexOf("]"));
  return hostWithPort.split(":").length === 2 ? (hostWithPort.split(":")[0] ?? "") : hostWithPort;
}

function readUrlHost(target: unknown): string | undefined {
  if (typeof target === "string") return new URL(target).hostname;
  if (target instanceof URL) return target.hostname;
  if (typeof Request !== "undefined" && target instanceof Request) return new URL(target.url).hostname;
  return undefined;
}

/** Reads the destination host from `http.request` style arguments: (url, options?, callback?) or (options, callback?). */
function readRequestHost(requestArguments: unknown[]): string | undefined {
  const [firstArgument, secondArgument] = requestArguments;
  const urlHost =
    typeof firstArgument === "string" || firstArgument instanceof URL ? readUrlHost(firstArgument) : undefined;
  const requestOptions = (
    typeof secondArgument === "object" && secondArgument !== null
      ? secondArgument
      : typeof firstArgument === "object" && !(firstArgument instanceof URL)
        ? firstArgument
        : undefined
  ) as { socketPath?: string; hostname?: string; host?: string } | null | undefined;
  if (requestOptions?.socketPath) return undefined;
  if (requestOptions?.hostname) return requestOptions.hostname;
  if (requestOptions?.host) return stripPort(requestOptions.host);
  return urlHost ?? "localhost";
}

/** Reads the destination host from `net.connect` style arguments: (options), (port, host?) or (path). */
function readSocketHost(connectArguments: unknown[]): string | undefined {
  const [firstArgument, secondArgument] = connectArguments;
  if (typeof firstArgument === "number" || (typeof firstArgument === "string" && /^\d+$/.test(firstArgument))) {
    return typeof secondArgument === "string" ? secondArgument : "localhost";
  }
  if (typeof firstArgument === "string") return undefined;
  const socketOptions = firstArgument as { path?: string; host?: string } | undefined;
  if (socketOptions?.path) return undefined;
  return socketOptions?.host ?? "localhost";
}

type AnyFunction = (...functionArguments: never[]) => unknown;

function guardFunction<Guarded extends AnyFunction>(
  originalFunction: Guarded,
  readHost: (functionArguments: unknown[]) => string | undefined,
): Guarded {
  const guardedFunction = function (this: unknown, ...functionArguments: unknown[]) {
    const host = readHost(functionArguments);
    if (host !== undefined) assertLoopback(host);
    return (originalFunction as unknown as (...innerArguments: unknown[]) => unknown).apply(this, functionArguments);
  };
  return guardedFunction as unknown as Guarded;
}

/**
 * Makes every non-loopback `fetch`, `http(s).request/get`, `net.connect/createConnection` and
 * `tls.connect` throw `OfflineViolationError`. Returns a function that restores the originals.
 * Installing twice is a no-op.
 */
export function installOfflineGuard(): () => void {
  const registry = globalThis as unknown as Record<symbol, (() => void) | undefined>;
  const existingRestore = registry[INSTALLED_MARKER];
  if (existingRestore) return existingRestore;

  const originalFetch = globalThis.fetch;
  const originals = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    tlsConnect: tls.connect,
  };

  globalThis.fetch = async function guardedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
    assertLoopback(readUrlHost(input) ?? "localhost");
    return originalFetch(input, init);
  } as typeof fetch;
  http.request = guardFunction(originals.httpRequest, readRequestHost);
  http.get = guardFunction(originals.httpGet, readRequestHost);
  https.request = guardFunction(originals.httpsRequest, readRequestHost);
  https.get = guardFunction(originals.httpsGet, readRequestHost);
  net.connect = guardFunction(originals.netConnect, readSocketHost);
  net.createConnection = guardFunction(originals.netCreateConnection, readSocketHost);
  tls.connect = guardFunction(originals.tlsConnect, readSocketHost);

  const restore = () => {
    globalThis.fetch = originalFetch;
    http.request = originals.httpRequest;
    http.get = originals.httpGet;
    https.request = originals.httpsRequest;
    https.get = originals.httpsGet;
    net.connect = originals.netConnect;
    net.createConnection = originals.netCreateConnection;
    tls.connect = originals.tlsConnect;
    delete registry[INSTALLED_MARKER];
  };
  registry[INSTALLED_MARKER] = restore;
  return restore;
}

/** Installs the guard when `CMM_OFFLINE_GUARD=1` (always set in tests and e2e). */
export function installOfflineGuardFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.CMM_OFFLINE_GUARD !== "1") return false;
  installOfflineGuard();
  return true;
}
