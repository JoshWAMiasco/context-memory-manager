/*
 * The terminal host: a small process CMM starts on its own (detached), which runs the shells of
 * CMM's terminals and keeps each one's screen. CMM's server talks to it over a socket only it can
 * open (`host-protocol.ts`).
 *
 * When the last CMM server disconnects (CMM closed, restarted, updated or crashed), the host ends
 * every terminal that isn't a job and keeps the jobs running for the next CMM to pick up. It exits
 * once it has no shells left. Bundled by scripts/build-entry.ts as dist/server/terminal-host.js
 * and shipped beside the entry; node-pty loads from the app it was started from.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { IPty } from "node-pty";
import {
  createLineReader,
  TERMINAL_HOST_PROTOCOL,
  type TerminalHostEvent,
  type TerminalHostMetadata,
  type TerminalHostRecord,
  type TerminalHostRequest,
} from "./host-protocol";

/** Lines of history kept for a panel that (re)attaches, besides the screen itself. */
const SCROLLBACK_LINES = 2000;

/** A host nobody connected to (CMM failed to start, or stopped right away) exits after this long. */
const UNCLAIMED_EXIT_MILLISECONDS = 60_000;

interface HostSession {
  id: string;
  metadata: TerminalHostMetadata;
  isJob: boolean;
  status: "running" | "exited";
  exitCode?: number;
  pty: IPty;
  screen: HeadlessTerminal;
  serializer: SerializeAddon;
  /** How many outputs were sent: a snapshot says which of them it already shows. */
  sequence: number;
}

const hostDirectory = readRequiredEnvironment("CMM_TERMINAL_HOST_DIR");
const applicationDirectory = readRequiredEnvironment("CMM_TERMINAL_HOST_APP");
const hostVersion = readRequiredEnvironment("CMM_TERMINAL_HOST_VERSION");
const hostToken = readRequiredEnvironment("CMM_TERMINAL_HOST_TOKEN");
// Nothing of the host's own setup reaches a shell (shells get the environment CMM sends anyway).
for (const name of Object.keys(process.env)) if (name.startsWith("CMM_TERMINAL_HOST_")) delete process.env[name];

const nodePty = createRequire(path.join(applicationDirectory, "package.json"))("node-pty") as typeof import("node-pty");
const sessions = new Map<string, HostSession>();
const clients = new Set<net.Socket>();
const recordPath = path.join(hostDirectory, `${process.pid}.json`);
const address = readListenAddress();
let unclaimedTimer: NodeJS.Timeout | undefined;

/** A named pipe on Windows; else a socket beside the record, or in the temp folder when that path is too long for a socket. */
function readListenAddress(): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\cmm-terminal-host-${process.pid}-${randomUUID()}`;
  const socketPath = path.join(hostDirectory, `${process.pid}.sock`);
  return socketPath.length < 100 ? socketPath : path.join(tmpdir(), `cmm-terminal-host-${process.pid}.sock`);
}

function readRequiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[terminal-host] ${name} is not set`);
    process.exit(2);
  }
  return value;
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} [terminal-host ${process.pid}] ${message}`);
}

function send(client: net.Socket, event: TerminalHostEvent): void {
  if (!client.destroyed) client.write(`${JSON.stringify(event)}\n`);
}

function broadcast(event: TerminalHostEvent): void {
  for (const client of clients) send(client, event);
}

function isTokenValid(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const expected = Buffer.from(hostToken);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function spawnSession(request: Extract<TerminalHostRequest, { type: "spawn" }>): void {
  const pty = nodePty.spawn(request.file, request.args, {
    name: "xterm-256color",
    cols: request.cols,
    rows: request.rows,
    cwd: request.cwd,
    env: request.env,
  });
  const screen = new HeadlessTerminal({
    cols: request.cols,
    rows: request.rows,
    scrollback: SCROLLBACK_LINES,
    allowProposedApi: true,
  });
  const serializer = new SerializeAddon();
  screen.loadAddon(serializer as unknown as Parameters<HeadlessTerminal["loadAddon"]>[0]);
  const session: HostSession = {
    id: request.id,
    metadata: request.metadata,
    isJob: request.isJob,
    status: "running",
    pty,
    screen,
    serializer,
    sequence: 0,
  };
  pty.onData((data) => {
    if (!sessions.has(session.id)) return;
    session.screen.write(data);
    session.sequence += 1;
    broadcast({ type: "output", id: session.id, sequence: session.sequence, data });
  });
  pty.onExit(({ exitCode }) => {
    session.status = "exited";
    session.exitCode = exitCode;
    if (sessions.has(session.id)) broadcast({ type: "exit", id: session.id, exitCode });
  });
  sessions.set(session.id, session);
  log(`started ${session.isJob ? "job" : "terminal"} ${session.id} (pid ${pty.pid})`);
}

function killSession(session: HostSession): void {
  sessions.delete(session.id);
  if (session.status === "running") {
    try {
      session.pty.kill();
    } catch {
      // Already gone.
    }
  }
  session.screen.dispose();
}

function handleRequest(client: net.Socket, request: TerminalHostRequest): void {
  const session = "id" in request && request.type !== "spawn" ? sessions.get(request.id) : undefined;
  switch (request.type) {
    case "hello":
      return;
    case "spawn":
      try {
        if (sessions.has(request.id)) throw new Error("A terminal with that id is already running.");
        spawnSession(request);
        send(client, { type: "spawned", requestId: request.requestId });
      } catch (spawnError) {
        send(client, {
          type: "failed",
          requestId: request.requestId,
          message: spawnError instanceof Error ? spawnError.message : String(spawnError),
        });
      }
      return;
    case "snapshot": {
      if (!session) {
        send(client, { type: "failed", requestId: request.requestId, message: "That terminal does not exist." });
        return;
      }
      const sequence = session.sequence;
      // Writes are parsed in order: once this empty one is, every output up to `sequence` is on the screen.
      session.screen.write("", () => {
        const data = sessions.has(session.id) ? session.serializer.serialize({ scrollback: request.scrollback }) : "";
        send(client, { type: "snapshot", requestId: request.requestId, id: session.id, sequence, data });
      });
      return;
    }
    case "input":
      if (session?.status === "running") session.pty.write(request.data);
      return;
    case "resize":
      if (session?.status === "running") {
        session.pty.resize(request.cols, request.rows);
        session.screen.resize(request.cols, request.rows);
      }
      return;
    case "set-job":
      if (session) session.isJob = request.isJob;
      return;
    case "kill":
      if (session) killSession(session);
      exitIfIdle();
  }
}

/** With no CMM connected, terminals that aren't jobs end; the host exits once nothing is left. */
function handleLastClientGone(): void {
  for (const session of [...sessions.values()]) if (!session.isJob) killSession(session);
  log(`CMM disconnected; ${sessions.size} job(s) kept running`);
  exitIfIdle();
}

function exitIfIdle(): void {
  if (sessions.size === 0 && clients.size === 0) shutDown(0);
}

function shutDown(exitCode: number): void {
  for (const session of [...sessions.values()]) killSession(session);
  rmSync(recordPath, { force: true });
  if (process.platform !== "win32") rmSync(address, { force: true });
  log("exiting");
  process.exit(exitCode);
}

const server = net.createServer((client) => {
  let isAuthenticated = false;
  client.setEncoding("utf8");
  client.on(
    "data",
    createLineReader((message) => {
      const request = message as TerminalHostRequest;
      if (!isAuthenticated) {
        if (request?.type !== "hello" || !isTokenValid(request.token)) {
          client.destroy();
          return;
        }
        isAuthenticated = true;
        clients.add(client);
        if (unclaimedTimer) clearTimeout(unclaimedTimer);
        unclaimedTimer = undefined;
        send(client, {
          type: "hello",
          version: hostVersion,
          protocol: TERMINAL_HOST_PROTOCOL,
          pid: process.pid,
          sessions: [...sessions.values()].map((session) => ({
            id: session.id,
            metadata: session.metadata,
            isJob: session.isJob,
            status: session.status,
            ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
          })),
        });
        return;
      }
      try {
        handleRequest(client, request);
      } catch (requestError) {
        log(`request ${String(request?.type)} failed: ${String(requestError)}`);
      }
    }),
  );
  client.on("error", () => client.destroy());
  client.on("close", () => {
    if (!clients.delete(client)) return;
    if (clients.size === 0) handleLastClientGone();
  });
});

mkdirSync(hostDirectory, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") rmSync(address, { force: true });
server.listen(address, () => {
  if (process.platform !== "win32") chmodSync(address, 0o600);
  const record: TerminalHostRecord = {
    pid: process.pid,
    address,
    token: hostToken,
    version: hostVersion,
    protocol: TERMINAL_HOST_PROTOCOL,
  };
  const temporaryPath = `${recordPath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporaryPath, recordPath);
  log(`listening (CMM ${hostVersion})`);
  unclaimedTimer = setTimeout(() => {
    if (clients.size === 0) handleLastClientGone();
  }, UNCLAIMED_EXIT_MILLISECONDS);
});
server.on("error", (serverError) => {
  log(`could not listen: ${serverError.message}`);
  shutDown(1);
});

// The terminal CMM was started from closing must not take the jobs with it.
process.on("SIGHUP", () => undefined);
process.on("SIGINT", () => undefined);
process.on("SIGTERM", () => shutDown(0));
process.on("uncaughtException", (uncaughtError) => log(`uncaught: ${uncaughtError.stack ?? String(uncaughtError)}`));
