/*
 * The terminal host's protocol, shared by the host process (`host-process.ts`) and CMM's server
 * (`host-client.ts`). One JSON message per line over a Unix socket (a named pipe on Windows).
 *
 * The host owns the shells, so a terminal kept as a job outlives CMM: CMM closing, restarting or
 * being updated only drops the connection. A host from an older CMM version keeps serving its jobs
 * after an update, so this protocol only ever gains optional fields.
 */

/** Bumped only for a change an older host or server can't ignore. */
export const TERMINAL_HOST_PROTOCOL = 1;

/** What CMM stores with each shell, so a CMM started later can list and attach to it. */
export interface TerminalHostMetadata {
  ownerId: string;
  storageId: string;
  storageLabel: string;
  path: string;
  title: string;
  shell: string;
  createdAt: string;
}

export interface TerminalHostSessionState {
  id: string;
  metadata: TerminalHostMetadata;
  isJob: boolean;
  status: "running" | "exited";
  exitCode?: number;
}

/** A host's registration file (`<dataDir>/terminal-hosts/<pid>.json`), readable by CMM's user only. */
export interface TerminalHostRecord {
  pid: number;
  address: string;
  token: string;
  version: string;
  protocol: number;
}

export type TerminalHostRequest =
  | { type: "hello"; token: string }
  | {
      type: "spawn";
      requestId: number;
      id: string;
      file: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
      metadata: TerminalHostMetadata;
      isJob: boolean;
    }
  | { type: "snapshot"; requestId: number; id: string; scrollback: number }
  | { type: "input"; id: string; data: string }
  | { type: "resize"; id: string; cols: number; rows: number }
  | { type: "set-job"; id: string; isJob: boolean }
  | { type: "kill"; id: string };

export type TerminalHostEvent =
  | { type: "hello"; version: string; protocol: number; pid: number; sessions: TerminalHostSessionState[] }
  | { type: "spawned"; requestId: number }
  | { type: "failed"; requestId: number; message: string }
  /** The screen as it is, with every output up to `sequence` on it. */
  | { type: "snapshot"; requestId: number; id: string; sequence: number; data: string }
  | { type: "output"; id: string; sequence: number; data: string }
  | { type: "exit"; id: string; exitCode: number };

/**
 * Splits a byte stream into JSON messages, one per line.
 *
 * @example
 * socket.on("data", createLineReader((message) => handle(message as TerminalHostEvent)));
 */
export function createLineReader(onMessage: (message: unknown) => void): (chunk: Buffer | string) => void {
  let pending = "";
  return (chunk) => {
    pending += String(chunk);
    let newlineIndex = pending.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex);
      pending = pending.slice(newlineIndex + 1);
      if (line.trim() !== "") {
        try {
          onMessage(JSON.parse(line));
        } catch {
          // A malformed line is skipped; the next one still parses.
        }
      }
      newlineIndex = pending.indexOf("\n");
    }
  };
}
