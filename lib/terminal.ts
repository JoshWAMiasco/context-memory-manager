/*
 * The terminal socket's messages, shared by the server and the browser. Isomorphic.
 *
 * Browser → server: `{ type: "input", data }` (keys typed or pasted), `{ type: "resize", cols, rows }`.
 * Server → browser: `{ type: "output", data }` (the scrollback first, on attach), `{ type: "exit", exitCode }`.
 */

/** At most this many terminals per user, running or exited. */
export const MAX_TERMINALS_PER_USER = 10;

/** The socket close code for a session that was locked or signed out. */
export const TERMINAL_SOCKET_LOCKED_CODE = 4001;

export type TerminalClientMessage = { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };

export type TerminalServerMessage = { type: "output"; data: string } | { type: "exit"; exitCode: number };

/**
 * The WebSocket path of a terminal.
 *
 * @example
 * buildTerminalSocketPath("4f1c…"); // "/api/terminals/4f1c…/socket"
 */
export function buildTerminalSocketPath(terminalId: string): string {
  return `/api/terminals/${encodeURIComponent(terminalId)}/socket`;
}

/** The terminal id in a socket path, or undefined for any other path. */
export function parseTerminalSocketPath(requestPath: string): string | undefined {
  const match = /^\/api\/terminals\/([^/?#]+)\/socket(?:[?#].*)?$/.exec(requestPath);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
