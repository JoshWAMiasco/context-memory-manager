import "server-only";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import packageManifest from "@/package.json";
import { getConfig } from "@/server/config";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import {
  createLineReader,
  TERMINAL_HOST_PROTOCOL,
  type TerminalHostEvent,
  type TerminalHostRecord,
  type TerminalHostRequest,
  type TerminalHostSessionState,
} from "@/server/terminal/host-protocol";

/** A host that doesn't answer within this long is treated as gone. */
const CONNECT_TIMEOUT_MILLISECONDS = 3000;

/** How long a new host gets to start listening. */
const START_TIMEOUT_MILLISECONDS = 15_000;

type SpawnRequest = Omit<Extract<TerminalHostRequest, { type: "spawn" }>, "type" | "requestId">;

/**
 * CMM's connection to one terminal host process. Requests that expect an answer (starting a shell,
 * a snapshot of its screen) resolve when the host replies; output and exits arrive through the
 * `on…` handlers.
 */
export class TerminalHostConnection {
  onOutput: (terminalId: string, data: string, sequence: number) => void = () => undefined;
  onExit: (terminalId: string, exitCode: number) => void = () => undefined;
  onClose: () => void = () => undefined;
  readonly record: TerminalHostRecord;
  private readonly socket: net.Socket;
  private readonly pending = new Map<
    number,
    { resolve: (event: TerminalHostEvent) => void; reject: (failure: Error) => void }
  >();
  private nextRequestId = 1;
  private isClosed = false;

  constructor(socket: net.Socket, record: TerminalHostRecord) {
    this.socket = socket;
    this.record = record;
  }

  /** Handles one event from the host (the socket's reader calls this). */
  receive(event: TerminalHostEvent): void {
    if (event.type === "output") this.onOutput(event.id, event.data, event.sequence);
    else if (event.type === "exit") this.onExit(event.id, event.exitCode);
    else if ("requestId" in event) {
      const request = this.pending.get(event.requestId);
      if (!request) return;
      this.pending.delete(event.requestId);
      if (event.type === "failed") request.reject(new Error(event.message));
      else request.resolve(event);
    }
  }

  /** Marks the connection closed and fails what was still waiting for an answer. */
  handleClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const request of this.pending.values()) request.reject(new Error("The terminal host stopped."));
    this.pending.clear();
    getHostState().hosts.delete(this);
    this.onClose();
  }

  get isOpen(): boolean {
    return !this.isClosed;
  }

  send(request: TerminalHostRequest): void {
    if (!this.isClosed) this.socket.write(`${JSON.stringify(request)}\n`);
  }

  private request(request: TerminalHostRequest & { requestId: number }): Promise<TerminalHostEvent> {
    if (this.isClosed) return Promise.reject(new Error("The terminal host stopped."));
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      this.send(request);
    });
  }

  async spawn(spawnRequest: SpawnRequest): Promise<void> {
    await this.request({ type: "spawn", requestId: this.nextRequestId++, ...spawnRequest });
  }

  /** The terminal's screen with `scrollback` lines of history, and the last output it shows. */
  async snapshot(terminalId: string, scrollback: number): Promise<{ sequence: number; data: string }> {
    const event = await this.request({ type: "snapshot", requestId: this.nextRequestId++, id: terminalId, scrollback });
    return event.type === "snapshot" ? { sequence: event.sequence, data: event.data } : { sequence: 0, data: "" };
  }

  /** Disconnects; the host then ends this CMM's terminals that aren't jobs. */
  disconnect(): void {
    this.socket.destroy();
    this.handleClosed();
  }
}

interface HostState {
  hosts: Set<TerminalHostConnection>;
  /** The host this CMM starts new terminals in: one of its own version. */
  ownHost?: Promise<TerminalHostConnection>;
}

function getHostState(): HostState {
  return getGlobalSingleton("terminal-hosts", (): HostState => ({ hosts: new Set() }));
}

/** Where hosts register (`<pid>.json`) and listen (`<pid>.sock`): CMM's data folder, for CMM's user only. */
export function readTerminalHostDirectory(): string {
  return path.join(getConfig().dataDir, "terminal-hosts");
}

/** Connects to the host a record describes and says hello; the host answers with the shells it runs. */
function connectToHost(
  record: TerminalHostRecord,
): Promise<{ host: TerminalHostConnection; sessions: TerminalHostSessionState[] }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(record.address);
    const host = new TerminalHostConnection(socket, record);
    let isGreeted = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("The terminal host did not answer."));
    }, CONNECT_TIMEOUT_MILLISECONDS);
    socket.setEncoding("utf8");
    socket.on(
      "data",
      createLineReader((message) => {
        const event = message as TerminalHostEvent;
        if (isGreeted) {
          host.receive(event);
          return;
        }
        if (event?.type !== "hello") return;
        isGreeted = true;
        clearTimeout(timer);
        getHostState().hosts.add(host);
        resolve({ host, sessions: event.sessions });
      }),
    );
    socket.on("connect", () => host.send({ type: "hello", token: record.token }));
    socket.on("error", (socketError) => {
      if (!isGreeted) {
        clearTimeout(timer);
        reject(socketError);
      }
    });
    socket.on("close", () => {
      if (isGreeted) host.handleClosed();
      else {
        clearTimeout(timer);
        reject(new Error("The terminal host closed the connection."));
      }
    });
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (signalError) {
    return (signalError as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readHostRecords(hostDirectory: string): Promise<TerminalHostRecord[]> {
  let fileNames: string[];
  try {
    fileNames = await readdir(hostDirectory);
  } catch {
    return [];
  }
  const records: TerminalHostRecord[] = [];
  for (const fileName of fileNames) {
    if (!/^\d+\.json$/.test(fileName)) continue;
    try {
      records.push(JSON.parse(await readFile(path.join(hostDirectory, fileName), "utf8")) as TerminalHostRecord);
    } catch {
      // Half-written or unreadable: skipped.
    }
  }
  return records;
}

/** Removes what a host that is no longer running left behind. */
async function removeHostRecord(hostDirectory: string, record: TerminalHostRecord): Promise<void> {
  await rm(path.join(hostDirectory, `${record.pid}.json`), { force: true });
  if (process.platform !== "win32") await rm(record.address, { force: true });
}

/**
 * Connects to every terminal host still running (from an earlier run of CMM, maybe an older
 * version) and returns the shells each one runs: the jobs that kept running while CMM was closed.
 * A host of this CMM's version also takes new terminals.
 */
export async function discoverTerminalHosts(): Promise<
  { host: TerminalHostConnection; sessions: TerminalHostSessionState[] }[]
> {
  const hostDirectory = readTerminalHostDirectory();
  const found: { host: TerminalHostConnection; sessions: TerminalHostSessionState[] }[] = [];
  for (const record of await readHostRecords(hostDirectory)) {
    if (record.protocol !== TERMINAL_HOST_PROTOCOL) {
      console.warn(`[cmm] terminals: host ${record.pid} speaks protocol ${record.protocol}; its jobs are not shown`);
      continue;
    }
    try {
      const connection = await connectToHost(record);
      found.push(connection);
      const state = getHostState();
      if (!state.ownHost && record.version === packageManifest.version)
        state.ownHost = Promise.resolve(connection.host);
    } catch {
      if (!isProcessAlive(record.pid)) await removeHostRecord(hostDirectory, record);
    }
  }
  return found;
}

/** The terminal host's script: beside the entry when packaged, in dist/server in a development checkout. */
function resolveHostScript(): string {
  const candidates = [
    // eslint-disable-next-line no-inline-comments -- runtime path: keep Turbopack's tracer from following it
    path.join(/* turbopackIgnore: true */ process.cwd(), "terminal-host.js"),
    // eslint-disable-next-line no-inline-comments -- runtime path: keep Turbopack's tracer from following it
    path.join(/* turbopackIgnore: true */ process.cwd(), "dist", "server", "terminal-host.js"),
  ];
  const scriptPath = candidates.find((candidate) => existsSync(candidate));
  if (!scriptPath) throw new Error("terminal-host.js is missing from this install.");
  return scriptPath;
}

function waitForRecord(hostDirectory: string, pid: number): Promise<TerminalHostRecord> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      readFile(path.join(hostDirectory, `${pid}.json`), "utf8")
        .then((text) => resolve(JSON.parse(text) as TerminalHostRecord))
        .catch(() => {
          if (!isProcessAlive(pid)) reject(new Error(`it exited (see ${path.join(hostDirectory, "host.log")})`));
          else if (Date.now() - startedAt > START_TIMEOUT_MILLISECONDS) reject(new Error("it did not start in time"));
          else setTimeout(check, 50);
        });
    };
    check();
  });
}

/**
 * Starts a terminal host, detached from CMM (its own session, no shared stdio), so it and its jobs
 * outlive CMM. Its log goes to `terminal-hosts/host.log`.
 */
async function startTerminalHost(): Promise<TerminalHostConnection> {
  const hostDirectory = readTerminalHostDirectory();
  mkdirSync(hostDirectory, { recursive: true, mode: 0o700 });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CMM_TERMINAL_HOST_DIR: hostDirectory,
    CMM_TERMINAL_HOST_APP: process.cwd(),
    CMM_TERMINAL_HOST_VERSION: packageManifest.version,
    CMM_TERMINAL_HOST_TOKEN: randomBytes(32).toString("base64url"),
  };
  delete environment.NODE_OPTIONS;
  // The desktop app's server runs on Electron's Node; the host needs it as plain Node.
  if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = "1";
  const logDescriptor = openSync(path.join(hostDirectory, "host.log"), "a", 0o600);
  try {
    const child = spawn(process.execPath, [resolveHostScript()], {
      cwd: hostDirectory,
      detached: true,
      env: environment,
      stdio: ["ignore", logDescriptor, logDescriptor],
      windowsHide: true,
    });
    child.unref();
    if (child.pid === undefined) throw new Error("it could not be started");
    const record = await waitForRecord(hostDirectory, child.pid);
    const { host } = await connectToHost(record);
    return host;
  } finally {
    closeSync(logDescriptor);
  }
}

/** The host new terminals start in: this CMM's own, started on first use (and again if it stopped). */
export async function requireOwnTerminalHost(): Promise<TerminalHostConnection> {
  const state = getHostState();
  const start = () =>
    startTerminalHost().catch((startError: unknown) => {
      state.ownHost = undefined;
      throw new Error(
        `the terminal host could not start: ${startError instanceof Error ? startError.message : String(startError)}`,
      );
    });
  // Set before waiting, so terminals opened at the same moment share one new host.
  state.ownHost ??= start();
  const current = await state.ownHost;
  if (current.isOpen) return current;
  state.ownHost = start();
  return state.ownHost;
}

/** Disconnects from every host as CMM stops: each ends the terminals that aren't jobs and keeps the jobs. */
export function disconnectTerminalHosts(): void {
  const state = getHostState();
  for (const host of [...state.hosts]) host.disconnect();
  state.ownHost = undefined;
}
