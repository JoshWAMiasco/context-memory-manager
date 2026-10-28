import "server-only";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { parseTerminalSocketPath, TERMINAL_SOCKET_LOCKED_CODE, type TerminalServerMessage } from "@/lib/terminal";
import { isSameOriginRequest } from "@/server/security/same-origin";
import { resolveSession, SESSION_COOKIE_NAME, touchActivity } from "@/server/auth/session";
import type { CmmConfig } from "@/server/config";
import { getEventBus } from "@/server/events/bus";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { hasValidLaunchToken, readCookie } from "@/server/security/launch-token";
import {
  attachToTerminal,
  readTerminalAvailability,
  readTerminalsPending,
  requireTerminal,
  resizeTerminal,
  writeToTerminal,
} from "@/server/terminal";

/** Typing counts as activity (so the session doesn't lock mid-command), recorded at most this often. */
const ACTIVITY_INTERVAL_MILLISECONDS = 30_000;

/** A message larger than this is not a keystroke or a paste anyone means to send. */
const MAX_MESSAGE_BYTES = 1024 * 1024;

const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("input"), data: z.string() }),
  z.object({ type: z.literal("resize"), cols: z.number().int(), rows: z.number().int() }),
]);

/** Whether an upgrade request is for a terminal socket (the entry hands those here instead of to Next). */
export function isTerminalSocketRequest(request: http.IncomingMessage): boolean {
  return parseTerminalSocketPath(request.url ?? "") !== undefined;
}

function getSocketServer(): WebSocketServer {
  return getGlobalSingleton("terminal-socket-server", () => {
    const socketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    // A locked or ended session takes its terminal sockets with it; the shells keep running.
    const closeSessionSockets = ({ sessionIdHash }: { sessionIdHash: string }) => {
      for (const client of socketServer.clients) {
        if ((client as WebSocket & { sessionIdHash?: string }).sessionIdHash === sessionIdHash) {
          client.close(TERMINAL_SOCKET_LOCKED_CODE, "Session locked");
        }
      }
    };
    getEventBus().on("session.locked", closeSessionSockets);
    getEventBus().on("session.destroyed", closeSessionSockets);
    return socketServer;
  });
}

function refuse(socket: Duplex, status: 401 | 403 | 404, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function toHeaders(request: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

/**
 * Connects a browser to one of its terminals over a WebSocket (`/api/terminals/<id>/socket`), with
 * the API's checks: the desktop launch token, the same origin (a WebSocket ignores CORS), an
 * unlocked session without a pending password change, terminals available to the user, and a
 * terminal they opened. Each message is JSON (`lib/terminal.ts`): typing and resizes in, output
 * and the exit code out.
 */
export function handleTerminalUpgrade(
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  { config, expectedLaunchToken }: { config: CmmConfig; expectedLaunchToken: string | undefined },
): void {
  // Right after CMM starts, the jobs that kept running are still being found: a panel reconnecting to one waits.
  const terminalsPending = readTerminalsPending();
  if (terminalsPending) {
    void terminalsPending.then(() => handleTerminalUpgrade(request, socket, head, { config, expectedLaunchToken }));
    return;
  }
  const terminalId = parseTerminalSocketPath(request.url ?? "");
  const cookieHeader = request.headers.cookie;
  if (!terminalId) return refuse(socket, 404, "Not Found");
  if (config.mode === "desktop" && !hasValidLaunchToken(cookieHeader, expectedLaunchToken)) {
    return refuse(socket, 403, "Forbidden");
  }
  if (!request.headers.origin || !isSameOriginRequest(toHeaders(request), config)) {
    return refuse(socket, 403, "Forbidden");
  }
  const resolvedSession = resolveSession(readCookie(cookieHeader, SESSION_COOKIE_NAME));
  if (!resolvedSession || resolvedSession.isLocked || resolvedSession.user.mustChangePassword) {
    return refuse(socket, 401, "Unauthorized");
  }
  const { user, session } = resolvedSession;
  if (!readTerminalAvailability(user).available) return refuse(socket, 403, "Forbidden");
  let terminal: ReturnType<typeof requireTerminal>;
  try {
    terminal = requireTerminal(user, terminalId);
  } catch {
    return refuse(socket, 404, "Not Found");
  }

  const socketServer = getSocketServer();
  socketServer.handleUpgrade(request, socket, head, (client) => {
    (client as WebSocket & { sessionIdHash?: string }).sessionIdHash = session.idHash;
    let lastActivityAt = 0;
    const send = (message: TerminalServerMessage) => {
      if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
    };
    const detach = attachToTerminal(terminal, send);
    client.on("message", (rawMessage) => {
      let message: z.output<typeof clientMessageSchema>;
      try {
        message = clientMessageSchema.parse(JSON.parse(String(rawMessage)));
      } catch {
        return;
      }
      if (message.type === "resize") {
        resizeTerminal(terminal, message.cols, message.rows);
        return;
      }
      writeToTerminal(terminal, message.data);
      if (Date.now() - lastActivityAt > ACTIVITY_INTERVAL_MILLISECONDS) {
        lastActivityAt = Date.now();
        touchActivity(session.idHash);
      }
    });
    client.on("close", detach);
    client.on("error", detach);
  });
}
