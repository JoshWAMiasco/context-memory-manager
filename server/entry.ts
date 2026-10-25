/*
 * The only process entry point, in desktop and server mode. Bundled by esbuild into
 * `dist/server/entry.js` (and copied to `dist/app/entry.js`). It binds the socket itself, so it can
 * set the trusted client IP header, terminate TLS and run background services, then hands each
 * request to Next running in this same process (ADR-02, option A).
 */
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { ensureSetupCode } from "@/server/auth/setup";
import { getConfig, type CcmConfig } from "@/server/config";
import { closeDatabase, getDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  hasValidLaunchToken,
  LAUNCH_TOKEN_ENVIRONMENT_VARIABLE,
  readExpectedLaunchToken,
} from "@/server/security/launch-token";
import { findRootRefusal } from "@/server/runtime/root-refusal";
import { installOfflineGuardFromEnvironment } from "@/server/security/offline-guard";
import { applyTrustedHeaders } from "@/server/security/trusted-headers";
import { startBackgroundServices, stopBackgroundServices } from "@/server/services";

type RequestHandler = (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;
interface NextServer {
  prepare: () => Promise<void>;
  getRequestHandler: () => RequestHandler;
  close?: () => Promise<void>;
}

type CreateNextServer = (options: Record<string, unknown>) => NextServer;

const SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000;
const isDevelopment = process.argv.includes("--dev");

/** Where the Next app lives: next to this file in a packaged build, the project root in dev. */
function resolveApplicationDirectory(): string {
  if (process.env.CCM_APP_DIR) return path.resolve(process.env.CCM_APP_DIR);
  return isDevelopment ? path.resolve(__dirname, "..", "..") : __dirname;
}

function log(message: string): void {
  console.log(`[ccm] ${message}`);
}

/**
 * Next attaches its own `upgrade` listener (dev HMR) to the server it is given, or to the server
 * of the first request it sees. It gets this relay instead, so the entry's single listener checks
 * every upgrade first and decides what reaches Next. Two listeners on the real server would answer
 * each WebSocket twice, and browsers reject the second handshake.
 */
function createNextApplication(
  applicationDirectory: string,
  config: CcmConfig,
  port: number,
  upgradeRelay: EventEmitter,
): NextServer {
  const applicationRequire = createRequire(path.join(applicationDirectory, "package.json"));
  const createNextServer = applicationRequire("next") as CreateNextServer;
  const serverOptions: Record<string, unknown> = {
    dev: isDevelopment,
    dir: applicationDirectory,
    hostname: config.bindHost,
    port,
    customServer: true,
    httpServer: upgradeRelay,
  };
  if (!isDevelopment) {
    const requiredServerFiles = JSON.parse(
      readFileSync(path.join(applicationDirectory, ".next", "required-server-files.json"), "utf8"),
    ) as { config: Record<string, unknown> };
    process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);
    serverOptions.conf = requiredServerFiles.config;
  }
  return createNextServer(serverOptions);
}

function listen(server: http.Server, port: number, host: string): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

interface ParentPort {
  postMessage: (value: unknown) => void;
  on: (eventName: "message", listener: (messageEvent: { data: unknown }) => void) => void;
}

/** The Electron parent's message port when this runs as a utilityProcess (desktop app), else undefined. */
function readParentPort(): ParentPort | undefined {
  return (process as unknown as { parentPort?: ParentPort }).parentPort;
}

/** Tells an Electron parent (utilityProcess) which port the server bound. */
function notifyParentProcess(message: Record<string, unknown>): void {
  readParentPort()?.postMessage(message);
}

/** True for the `{ type: "shutdown" }` message the desktop app sends when it quits. */
function isShutdownMessage(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "shutdown";
}

async function main(): Promise<void> {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  mutableEnvironment.NODE_ENV ??= isDevelopment ? "development" : "production";
  installOfflineGuardFromEnvironment();

  const applicationDirectory = resolveApplicationDirectory();
  process.chdir(applicationDirectory);
  process.env.CCM_MIGRATIONS_DIR ??= isDevelopment
    ? path.join(applicationDirectory, "server", "db", "migrations")
    : path.join(applicationDirectory, "migrations");
  process.env.CCM_CONTENT_DIR ??= path.join(applicationDirectory, "content");
  // The PDF guides sit next to the app: dist/docs, resources/docs (desktop), /opt/ccm/<version>/docs (server).
  process.env.CCM_DOCS_DIR ??= isDevelopment
    ? path.join(applicationDirectory, "dist", "docs")
    : path.join(applicationDirectory, "..", "docs");

  const config = getConfig();
  const rootRefusal = findRootRefusal(config.mode);
  if (rootRefusal) throw new Error(rootRefusal);
  const expectedLaunchToken = readExpectedLaunchToken();
  if (config.mode === "desktop" && !expectedLaunchToken) {
    throw new Error(`Desktop mode needs ${LAUNCH_TOKEN_ENVIRONMENT_VARIABLE}; the CCM desktop app sets it on launch.`);
  }
  runMigrations(getDatabase().orm);
  ensureSetupCode();
  log(`database ready in ${config.dataDir}`);

  const nextHandlers: { handleRequest?: RequestHandler } = {};
  const handleIncomingRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
    applyTrustedHeaders(request);
    if (config.mode === "desktop" && !hasValidLaunchToken(request.headers.cookie, expectedLaunchToken)) {
      response.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "This request did not come from the CCM desktop app." },
        }),
      );
      return;
    }
    if (!nextHandlers.handleRequest) {
      response.writeHead(503, { "content-type": "text/plain", "retry-after": "1" });
      response.end("CCM is starting.");
      return;
    }
    nextHandlers.handleRequest(request, response).catch((requestError: unknown) => {
      console.error("[ccm] unhandled request error", requestError);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  };

  const server = config.tls
    ? https.createServer(
        { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) },
        handleIncomingRequest,
      )
    : http.createServer(handleIncomingRequest);
  const address = await listen(server, config.port, config.bindHost);

  const upgradeRelay = new EventEmitter();
  /* Upgraded sockets (dev HMR) leave the server's connection tracking, so shutdown closes them itself. */
  const upgradedSockets = new Set<import("node:stream").Duplex>();
  server.on("upgrade", (request: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    applyTrustedHeaders(request);
    const isAllowed =
      isDevelopment && (config.mode !== "desktop" || hasValidLaunchToken(request.headers.cookie, expectedLaunchToken));
    if (!isAllowed) {
      socket.destroy();
      return;
    }
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    upgradeRelay.emit("upgrade", request, socket, head);
  });

  const nextApplication = createNextApplication(applicationDirectory, config, address.port, upgradeRelay);
  await nextApplication.prepare();
  nextHandlers.handleRequest = nextApplication.getRequestHandler();

  await startBackgroundServices();

  const protocol = config.tls ? "https" : "http";
  const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  log(`${config.mode} mode${isDevelopment ? " (dev)" : ""} listening on ${protocol}://${displayHost}:${address.port}`);
  notifyParentProcess({ type: "listening", port: address.port });

  let isShuttingDown = false;
  const shutDown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log(`${signal} received, shutting down`);
    const forceExitTimer = setTimeout(() => {
      console.error("[ccm] shutdown timed out, exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MILLISECONDS);
    forceExitTimer.unref();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const upgradedSocket of upgradedSockets) upgradedSocket.destroy();
    });
    await stopBackgroundServices();
    await Promise.race([nextApplication.close?.(), new Promise((resolve) => setTimeout(resolve, 3000).unref())]);
    closeDatabase();
    log("stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutDown("SIGTERM"));
  process.on("SIGINT", () => void shutDown("SIGINT"));
  readParentPort()?.on("message", (messageEvent) => {
    if (isShutdownMessage(messageEvent.data)) void shutDown("shutdown message");
  });
}

main().catch((startupError: unknown) => {
  console.error("[ccm] failed to start", startupError);
  process.exit(1);
});
