import "server-only";
import { randomUUID } from "node:crypto";
import { constants, accessSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { TerminalSummary, TerminalUnavailableCode } from "@/lib/api-types";
import { MAX_TERMINALS_PER_USER, type TerminalServerMessage } from "@/lib/terminal";
import { getConfig } from "@/server/config";
import { ApiRouteError, notFound, validationFailed } from "@/server/http/api-error";
import { readManifest } from "@/server/meta/effective";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { resolveInStorage } from "@/server/security/path-jail";
import type { BackgroundService } from "@/server/services";
import { getSetting } from "@/server/settings/store";
import type { ActiveStorage, StorageActor } from "@/server/storage/roots";
import {
  discoverTerminalHosts,
  disconnectTerminalHosts,
  requireOwnTerminalHost,
  type TerminalHostConnection,
} from "@/server/terminal/host-client";
import type { TerminalHostSessionState } from "@/server/terminal/host-protocol";
import { withUserBinOnPath } from "@/server/terminal/shell-path";

/**
 * Lines of history the server's copy of each terminal keeps for a panel that (re)attaches, besides
 * the screen itself.
 */
const SCROLLBACK_LINES = 2000;

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/*
 * Variables that belong to CMM's own process and must not reach a user's shell: the desktop launch
 * token and data paths (CMM_*, CCM_*), Next's and Electron's internals, and NODE_ENV=production,
 * which would make `npm install` skip dev dependencies.
 */
const PRIVATE_ENVIRONMENT_PATTERN = /^(CMM_|CCM_|__NEXT|NEXT_|ELECTRON_|NODE_ENV$|NODE_OPTIONS$|PORT$)/;

/** A panel attached to a terminal. Outputs carry the host's sequence number, so a snapshot can skip what it already shows. */
type SessionListener = (message: TerminalServerMessage, sequence?: number) => void;

/**
 * A terminal as CMM's server knows it. The shell itself and the server's copy of its screen live
 * in a terminal host process (`host-process.ts`), so a job keeps running after CMM stops; a
 * program that repaints only what changes (Claude Code, vim, htop) still attaches as a clean screen.
 */
export interface TerminalSession {
  summary: TerminalSummary;
  ownerId: string;
  host: TerminalHostConnection;
  listeners: Set<SessionListener>;
}

type NodePty = typeof import("node-pty");

interface TerminalRegistry {
  sessions: Map<string, TerminalSession>;
  /** Picking up the jobs that kept running while CMM was closed; set when the service starts. */
  discovery?: Promise<void>;
  isDiscovered: boolean;
}

function getTerminalRegistry(): TerminalRegistry {
  return getGlobalSingleton("terminal-registry", (): TerminalRegistry => ({
    sessions: new Map(),
    isDiscovered: false,
  }));
}

/**
 * node-pty 1.1.0's macOS and Linux prebuilds ship `spawn-helper` without its executable bit, so
 * every spawn fails with "posix_spawnp failed". It is set here for a development checkout; packaged
 * builds set it when the app is assembled (a signed app can't change its own files).
 */
function ensureSpawnHelperIsExecutable(packageDirectory: string): void {
  if (process.platform === "win32") return;
  /*
   * Runtime paths: without turbopackIgnore, Next traced the whole project into the build, and vendor/node's
   * 31 MB runtime tarball ended up in every server package. assemble-app copies node-pty itself.
   */
  for (const helperPath of [
    // eslint-disable-next-line no-inline-comments -- runtime path: keep Turbopack's tracer from following it
    path.join(/* turbopackIgnore: true */ packageDirectory, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    // eslint-disable-next-line no-inline-comments -- runtime path: keep Turbopack's tracer from following it
    path.join(/* turbopackIgnore: true */ packageDirectory, "build", "Release", "spawn-helper"),
  ]) {
    if (!existsSync(helperPath)) continue;
    try {
      accessSync(helperPath, constants.X_OK);
    } catch {
      chmodSync(helperPath, 0o755);
    }
  }
}

/**
 * node-pty, loaded on first use (a native module), or the reason it can't load on this machine.
 * The terminal host loads its own copy to run shells; this one proves it loads here.
 */
function loadNodePty(): { nodePty?: NodePty; problem?: string } {
  return getGlobalSingleton("terminal-node-pty", () => {
    try {
      const applicationRequire = createRequire(path.join(process.cwd(), "package.json"));
      ensureSpawnHelperIsExecutable(path.dirname(applicationRequire.resolve("node-pty/package.json")));
      return { nodePty: applicationRequire("node-pty") as NodePty };
    } catch (loadError) {
      console.error("[cmm] terminals are unavailable: node-pty did not load", loadError);
      return { problem: loadError instanceof Error ? loadError.message : String(loadError) };
    }
  });
}

/**
 * Whether `actor` may open terminals here: admins only (a terminal can do anything CMM's user can),
 * with `terminal.enabled` on (the default on the desktop, off on a server), on a machine where
 * node-pty loads.
 */
export function readTerminalAvailability(actor: StorageActor): {
  available: boolean;
  code?: TerminalUnavailableCode;
  reason?: string;
} {
  if (actor.role !== "admin") return { available: false, code: "ROLE", reason: "Only admins can open terminals." };
  if (!getSetting("terminal.enabled")) {
    return {
      available: false,
      code: "DISABLED",
      reason: "Terminals are turned off. An admin can turn them on in Settings › Security.",
    };
  }
  const { problem } = loadNodePty();
  if (problem) {
    return { available: false, code: "UNSUPPORTED", reason: `Terminals can't start on this computer (${problem}).` };
  }
  return { available: true };
}

function requireTerminalsAvailable(actor: StorageActor): void {
  const availability = readTerminalAvailability(actor);
  if (!availability.available) {
    throw new ApiRouteError(403, "FORBIDDEN", availability.reason ?? "Terminals are not available.");
  }
}

/** The shell a terminal runs: the user's login shell on macOS and Linux (so their PATH and tools load), cmd.exe on Windows. */
function resolveShell(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: process.env.COMSPEC || "cmd.exe", args: [] };
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return { file: shell, args: ["-l"] };
}

/** CMM's environment without its private variables, set up for a colour terminal. */
function buildShellEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !PRIVATE_ENVIRONMENT_PATTERN.test(name)) environment[name] = value;
  }
  environment.TERM = "xterm-256color";
  environment.COLORTERM = "truecolor";
  environment.TERM_PROGRAM = "CMM";
  // Apps opened from the Dock or Finder get no locale, and CLIs then draw boxes and emoji as "?".
  if (process.platform !== "win32" && !environment.LANG) environment.LANG = "en_US.UTF-8";
  if (process.platform !== "win32") {
    const pathValue = withUserBinOnPath(environment.PATH, environment.HOME);
    if (pathValue) environment.PATH = pathValue;
  }
  /*
   * The server's systemd unit gives CMM a private /tmp, which systemd deletes when CMM stops: a job
   * still running after an update would lose its temporary files. They go in CMM's data folder.
   */
  if (getConfig().mode === "server" && process.platform === "linux") {
    const temporaryDirectory = path.join(getConfig().dataDir, "tmp");
    mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
    environment.TMPDIR = temporaryDirectory;
  }
  return environment;
}

function clampSize(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(2, Math.round(value)));
}

function emit(session: TerminalSession, message: TerminalServerMessage, sequence?: number): void {
  for (const listener of session.listeners) listener(message, sequence);
}

/** Registers a shell a host runs (just started, or found running when CMM started). */
function registerSession(host: TerminalHostConnection, state: TerminalHostSessionState): TerminalSession {
  const { ownerId, ...summaryFields } = state.metadata;
  const session: TerminalSession = {
    summary: {
      id: state.id,
      ...summaryFields,
      status: state.status,
      ...(state.exitCode === undefined ? {} : { exitCode: state.exitCode }),
      isJob: state.isJob,
    },
    ownerId,
    host,
    listeners: new Set(),
  };
  getTerminalRegistry().sessions.set(state.id, session);
  return session;
}

/** Routes one host's output, exits and disappearance to the sessions it runs. */
function handleHostEvents(host: TerminalHostConnection): void {
  host.onOutput = (terminalId, data, sequence) => {
    const session = getTerminalRegistry().sessions.get(terminalId);
    if (session) emit(session, { type: "output", data }, sequence);
  };
  host.onExit = (terminalId, exitCode) => {
    const session = getTerminalRegistry().sessions.get(terminalId);
    if (!session) return;
    session.summary = { ...session.summary, status: "exited", exitCode };
    emit(session, { type: "exit", exitCode });
  };
  host.onClose = () => {
    // The host is gone (killed, or it crashed): so are its shells.
    for (const session of [...getTerminalRegistry().sessions.values()]) {
      if (session.host !== host) continue;
      getTerminalRegistry().sessions.delete(session.summary.id);
      if (session.summary.status === "running") emit(session, { type: "exit", exitCode: -1 });
      session.listeners.clear();
    }
  };
}

/** Resolves once the jobs left running by an earlier CMM are listed (right away if they already are). */
export function whenTerminalsReady(): Promise<void> {
  return getTerminalRegistry().discovery ?? Promise.resolve();
}

/** Undefined once terminals are ready; else the promise to wait for (only briefly, as CMM starts). */
export function readTerminalsPending(): Promise<void> | undefined {
  const registry = getTerminalRegistry();
  return registry.isDiscovered || !registry.discovery ? undefined : registry.discovery;
}

/** A terminal `actor` opened, else 404 (other users' terminals don't exist for them). */
export function requireTerminal(actor: StorageActor, terminalId: string): TerminalSession {
  const session = getTerminalRegistry().sessions.get(terminalId);
  if (!session || session.ownerId !== actor.id) throw notFound("That terminal does not exist.");
  return session;
}

/** The terminals `actor` opened (jobs included), oldest first. */
export function listTerminals(actor: StorageActor): TerminalSummary[] {
  return [...getTerminalRegistry().sessions.values()]
    .filter((session) => session.ownerId === actor.id)
    .map((session) => session.summary)
    .toSorted((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/**
 * Starts a shell in a folder of a storage `actor` can open, at most 10 per user. The terminal is
 * titled after the memory, the folder or the storage. It keeps running, without panels, until it
 * exits or is closed; as a job (`isJob`), also after CMM stops.
 *
 * @example
 * const terminal = await openTerminal(actor, storage, "notes/persona", { cols: 120, rows: 30 });
 */
export async function openTerminal(
  actor: StorageActor,
  storage: ActiveStorage,
  folderPath: string,
  options: { cols?: number; rows?: number; isJob?: boolean } = {},
): Promise<TerminalSummary> {
  requireTerminalsAvailable(actor);
  await whenTerminalsReady();
  if (listTerminals(actor).length >= MAX_TERMINALS_PER_USER) {
    throw new ApiRouteError(
      409,
      "TOO_MANY_TERMINALS",
      `You have ${MAX_TERMINALS_PER_USER} terminals and jobs open. Close one to open another.`,
    );
  }
  const folder = await resolveInStorage(storage, folderPath);
  if (!(await stat(folder.absolutePath)).isDirectory())
    throw validationFailed("Choose a folder to open a terminal in.");
  const manifest = await readManifest(folder.absolutePath);
  const title =
    manifest?.kind === "memory"
      ? manifest.name
      : folder.relativePath === ""
        ? storage.label
        : path.posix.basename(folder.relativePath);
  const shell = resolveShell();
  const host = await requireOwnTerminalHost();
  handleHostEvents(host);
  const state: TerminalHostSessionState = {
    id: randomUUID(),
    metadata: {
      ownerId: actor.id,
      storageId: storage.id,
      storageLabel: storage.label,
      path: folder.relativePath,
      title,
      shell: path.basename(shell.file),
      createdAt: new Date().toISOString(),
    },
    isJob: options.isJob ?? false,
    status: "running",
  };
  // Registered first: the shell's first output can arrive before the host confirms the spawn.
  const session = registerSession(host, state);
  try {
    await host.spawn({
      id: state.id,
      file: shell.file,
      args: shell.args,
      cwd: folder.realPath ?? folder.absolutePath,
      env: buildShellEnvironment(),
      cols: clampSize(options.cols, DEFAULT_COLUMNS, 500),
      rows: clampSize(options.rows, DEFAULT_ROWS, 200),
      metadata: state.metadata,
      isJob: state.isJob,
    });
  } catch (spawnError) {
    getTerminalRegistry().sessions.delete(state.id);
    throw new ApiRouteError(
      500,
      "TERMINAL_FAILED",
      `The terminal could not start: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
    );
  }
  return session.summary;
}

/**
 * Connects a panel to a terminal: it gets the screen as it is now (with recent history, the cursor
 * and the modes programs set), then everything new, and the exit code if the shell has already
 * ended. Output that arrives while the screen is being captured is held back and sent right after
 * it unless the screen already shows it, so nothing is lost or sent twice. Returns a function that
 * disconnects it.
 */
export function attachToTerminal(
  session: TerminalSession,
  listener: (message: TerminalServerMessage) => void,
): () => void {
  let heldBack: { message: TerminalServerMessage; sequence?: number }[] | undefined = [];
  const attached: SessionListener = (message, sequence) => {
    if (heldBack) heldBack.push({ message, sequence });
    else listener(message);
  };
  session.listeners.add(attached);
  void session.host
    .snapshot(session.summary.id, SCROLLBACK_LINES)
    .catch(() => ({ sequence: 0, data: "" }))
    .then((snapshot) => {
      if (!session.listeners.has(attached) || !heldBack) return;
      if (snapshot.data !== "") listener({ type: "output", data: snapshot.data });
      const pending = heldBack;
      heldBack = undefined;
      for (const { message, sequence } of pending) {
        if (sequence === undefined || sequence > snapshot.sequence) listener(message);
      }
      if (session.summary.status === "exited" && !pending.some(({ message }) => message.type === "exit")) {
        listener({ type: "exit", exitCode: session.summary.exitCode ?? 0 });
      }
    });
  return () => session.listeners.delete(attached);
}

/** Types into a running terminal (keys and pastes); ignored once it has exited. */
export function writeToTerminal(session: TerminalSession, data: string): void {
  if (session.summary.status === "running") session.host.send({ type: "input", id: session.summary.id, data });
}

/** Tells the shell its new size, so full-screen programs redraw for the panel. */
export function resizeTerminal(session: TerminalSession, cols: number, rows: number): void {
  if (session.summary.status !== "running") return;
  session.host.send({
    type: "resize",
    id: session.summary.id,
    cols: clampSize(cols, DEFAULT_COLUMNS, 500),
    rows: clampSize(rows, DEFAULT_ROWS, 200),
  });
}

/**
 * Makes a terminal a job (it keeps running when CMM closes, restarts or is updated) or an ordinary
 * terminal again (it ends with CMM).
 */
export function setTerminalJob(actor: StorageActor, terminalId: string, isJob: boolean): TerminalSummary {
  const session = requireTerminal(actor, terminalId);
  session.host.send({ type: "set-job", id: terminalId, isJob });
  session.summary = { ...session.summary, isJob };
  return session.summary;
}

/** Ends a terminal's shell (and whatever runs in it) and forgets it: nothing of it is kept. */
export function closeTerminal(actor: StorageActor, terminalId: string): void {
  const session = requireTerminal(actor, terminalId);
  getTerminalRegistry().sessions.delete(terminalId);
  session.listeners.clear();
  session.host.send({ type: "kill", id: terminalId });
}

/**
 * The terminal service: on start, picks up the jobs a terminal host kept running while CMM was
 * closed; on stop, disconnects from the hosts, which end every terminal that isn't a job.
 *
 * @example
 * const BACKGROUND_SERVICES = [createTerminalService(), …];
 */
export function createTerminalService(): BackgroundService {
  return {
    name: "terminal",
    start: () => {
      const registry = getTerminalRegistry();
      registry.discovery = discoverTerminalHosts()
        .then((hosts) => {
          for (const { host, sessions } of hosts) {
            handleHostEvents(host);
            for (const state of sessions) registerSession(host, state);
          }
          const jobCount = hosts.reduce((count, { sessions }) => count + sessions.length, 0);
          if (jobCount > 0) console.log(`[cmm] terminals: ${jobCount} job(s) still running from before`);
        })
        .catch((discoveryError: unknown) =>
          console.error("[cmm] terminals: could not find running jobs", discoveryError),
        )
        .finally(() => {
          registry.isDiscovered = true;
        });
    },
    stop: () => {
      const registry = getTerminalRegistry();
      for (const session of registry.sessions.values()) session.listeners.clear();
      registry.sessions.clear();
      disconnectTerminalHosts();
    },
  };
}
