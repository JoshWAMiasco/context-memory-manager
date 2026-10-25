import "server-only";
import http from "node:http";
import https from "node:https";
import type { NetworkInterfaceInfo } from "node:os";
import type { HealthResponse } from "@/lib/api-types";
import type { CmmConfig } from "@/server/config";

/** The address the CLI uses to reach the server on this machine. */
export function resolveLoopbackHost(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "127.0.0.1" || bindHost === "localhost") return "127.0.0.1";
  if (bindHost === "::" || bindHost === "::1") return "[::1]";
  return bindHost.includes(":") ? `[${bindHost}]` : bindHost;
}

/** The URLs people can open: one per interface address when bound to every interface, else the bound address. */
export function listServiceUrls(
  config: Pick<CmmConfig, "bindHost" | "port" | "tls">,
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): string[] {
  const protocol = config.tls ? "https" : "http";
  const isEveryInterface = config.bindHost === "0.0.0.0" || config.bindHost === "::";
  if (!isEveryInterface) return [`${protocol}://${resolveLoopbackHost(config.bindHost)}:${config.port}`];
  const addresses = Object.values(networkInterfaces)
    .flatMap((interfaceAddresses) => interfaceAddresses ?? [])
    .filter((interfaceAddress) => !interfaceAddress.internal && interfaceAddress.family === "IPv4")
    .map((interfaceAddress) => interfaceAddress.address);
  return (addresses.length > 0 ? addresses : ["127.0.0.1"]).map((address) => `${protocol}://${address}:${config.port}`);
}

export type HealthCheck =
  { isHealthy: true; health: HealthResponse; url: string } | { isHealthy: false; problem: string; url: string };

/**
 * Asks the local server for `/api/health`. Over CMM's own TLS the certificate is not verified: it
 * is usually self-signed, and the request never leaves this machine.
 */
export function checkHealth(
  config: Pick<CmmConfig, "bindHost" | "port" | "tls">,
  timeoutMilliseconds = 3000,
): Promise<HealthCheck> {
  const url = `${config.tls ? "https" : "http"}://${resolveLoopbackHost(config.bindHost)}:${config.port}/api/health`;
  const requestModule = config.tls ? https : http;
  return new Promise((resolve) => {
    const healthRequest = requestModule.get(
      url,
      { timeout: timeoutMilliseconds, rejectUnauthorized: false, agent: false },
      (response) => {
        const bodyChunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode !== 200) {
            resolve({ isHealthy: false, problem: `HTTP ${response.statusCode}`, url });
            return;
          }
          try {
            resolve({
              isHealthy: true,
              health: JSON.parse(Buffer.concat(bodyChunks).toString("utf8")) as HealthResponse,
              url,
            });
          } catch {
            resolve({ isHealthy: false, problem: "the answer was not JSON", url });
          }
        });
      },
    );
    healthRequest.on("timeout", () => healthRequest.destroy(new Error("no answer in time")));
    healthRequest.on("error", (requestError: NodeJS.ErrnoException) => {
      resolve({
        isHealthy: false,
        problem: requestError.code === "ECONNREFUSED" ? "not listening" : requestError.message,
        url,
      });
    });
  });
}
