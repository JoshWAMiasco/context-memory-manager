import "server-only";
import { randomUUID } from "node:crypto";
import { constants, accessSync, chmodSync, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { IPty } from "node-pty";
import type { TerminalSummary, TerminalUnavailableCode } from "@/lib/api-types";
import { MAX_TERMINALS_PER_USER, type TerminalServerMessage } from "@/lib/terminal";
import { ApiRouteError, notFound, validationFailed } from "@/server/http/api-error";
import { readManifest } from "@/server/meta/effective";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { resolveInStorage } from "@/server/security/path-jail";
import type { BackgroundService } from "@/server/services";
import { getSetting } from "@/server/settings/store";
import type { ActiveStorage, StorageActor } from "@/server/storage/roots";

/** Output kept for a panel that (re)attaches: about the last few screens of a busy program. */
const SCROLLBACK_CHARACTERS = 256 * 1024;

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/*
 * Variables that belong to CMM's own process and must not reach a user's shell: the desktop launch
 * token and data paths (CMM_*, CCM_*), Next's and Electron's internals, and NODE_ENV=production,
 * which would make `npm install` skip dev dependencies.
 */
const PRIVATE_ENVIRONMENT_PATTERN = /^(CMM_|CCM_|__NEXT|NEXT_|ELECTRON_|NODE_ENV$|NODE_OPTIONS$|PORT$)/;

type TerminalListener = (message: TerminalServerMessage) => void;

interface TerminalSession {
  summary: TerminalSummary;
  ownerId: string;
  pty: IPty;
  scrollback: string;
  listeners: Set<TerminalListener>;
}

type NodePty = typeof import("node-pty");

function getTerminalRegistry(): Map<string, TerminalSession> {
  return getGlobalSingleton("terminal-sessions", () => new Map<string, TerminalSession>());
}

/**
 * node-pty 1.1.0's macOS and Linux prebuilds ship `spawn-helper` without its executable bit, so
 * every spawn fails with "posix_spawnp failed". It is set here for a development checkout; packaged
 * builds set it when the app is assembled (a signed app can't change its own files).
 */
function ensureSpawnHelperIsExecutable(packageDirectory: string): void {
  if (process.platform === "win32") return;
  for (const helperPath of [
    path.join(packageDirectory, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    path.join(packageDirectory, "build", "Release", "spawn-helper"),
  ]) {
    if (!existsSync(helperPath)) continue;
    try {
      accessSync(helperPath, constants.X_OK);
    } catch {
      chmodSync(helperPath, 0o755);
    }
  }
}

/** node-pty, loaded on first use (a native module), or the reason it can't load on this machine. */
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

function requireTerminalsAvailable(actor: StorageActor): NodePty {
  const availability = readTerminalAvailability(actor);
  const { nodePty } = loadNodePty();
  if (!availability.available || !nodePty) {
    throw new ApiRouteError(403, "FORBIDDEN", availability.reason ?? "Terminals are not available.");
  }
  return nodePty;
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
  return environment;
}

function clampSize(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(2, Math.round(value)));
}

function emit(session: TerminalSession, message: TerminalServerMessage): void {
  for (const listener of session.listeners) listener(message);
}

/** A terminal `actor` opened, else 404 (other users' terminals don't exist for them). */
export function requireTerminal(actor: StorageActor, terminalId: string): TerminalSession {
  const session = getTerminalRegistry().get(terminalId);
  if (!session || session.ownerId !== actor.id) throw notFound("That terminal does not exist.");
  return session;
}

/** The terminals `actor` opened, oldest first. */
export function listTerminals(actor: StorageActor): TerminalSummary[] {
  return [...getTerminalRegistry().values()]
    .filter((session) => session.ownerId === actor.id)
    .map((session) => session.summary);
}

/**
 * Starts a shell in a folder of a storage `actor` can open, at most 10 per user. The terminal is
 * titled after the memory, the folder or the storage. Its output is kept (the last 256 KB) for
 * panels that attach later; it keeps running, without panels, until it exits or is closed.
 *
 * @example
 * const terminal = await openTerminal(actor, storage, "notes/persona", { cols: 120, rows: 30 });
 */
export async function openTerminal(
  actor: StorageActor,
  storage: ActiveStorage,
  folderPath: string,
  size: { cols?: number; rows?: number } = {},
): Promise<TerminalSummary> {
  const nodePty = requireTerminalsAvailable(actor);
  if (listTerminals(actor).length >= MAX_TERMINALS_PER_USER) {
    throw new ApiRouteError(
      409,
      "TOO_MANY_TERMINALS",
      `You have ${MAX_TERMINALS_PER_USER} terminals open. Close one to open another.`,
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
  const pty = nodePty.spawn(shell.file, shell.args, {
    name: "xterm-256color",
    cols: clampSize(size.cols, DEFAULT_COLUMNS, 500),
    rows: clampSize(size.rows, DEFAULT_ROWS, 200),
    cwd: folder.realPath ?? folder.absolutePath,
    env: buildShellEnvironment(),
  });
  const session: TerminalSession = {
    summary: {
      id: randomUUID(),
      storageId: storage.id,
      storageLabel: storage.label,
      path: folder.relativePath,
      title,
      shell: path.basename(shell.file),
      status: "running",
      createdAt: new Date().toISOString(),
    },
    ownerId: actor.id,
    pty,
    scrollback: "",
    listeners: new Set(),
  };
  pty.onData((data) => {
    session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_CHARACTERS);
    emit(session, { type: "output", data });
  });
  pty.onExit(({ exitCode }) => {
    session.summary = { ...session.summary, status: "exited", exitCode };
    emit(session, { type: "exit", exitCode });
  });
  getTerminalRegistry().set(session.summary.id, session);
  return session.summary;
}

/**
 * Connects a panel to a terminal: it gets the kept output at once, then everything new, and the
 * exit code if the shell has already ended. Returns a function that disconnects it.
 */
export function attachToTerminal(session: TerminalSession, listener: TerminalListener): () => void {
  if (session.scrollback !== "") listener({ type: "output", data: session.scrollback });
  if (session.summary.status === "exited") listener({ type: "exit", exitCode: session.summary.exitCode ?? 0 });
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

/** Types into a running terminal (keys and pastes); ignored once it has exited. */
export function writeToTerminal(session: TerminalSession, data: string): void {
  if (session.summary.status === "running") session.pty.write(data);
}

/** Tells the shell its new size, so full-screen programs redraw for the panel. */
export function resizeTerminal(session: TerminalSession, cols: number, rows: number): void {
  if (session.summary.status !== "running") return;
  session.pty.resize(clampSize(cols, DEFAULT_COLUMNS, 500), clampSize(rows, DEFAULT_ROWS, 200));
}

/** Ends a terminal's shell (and whatever runs in it) and forgets it. */
export function closeTerminal(actor: StorageActor, terminalId: string): void {
  const session = requireTerminal(actor, terminalId);
  getTerminalRegistry().delete(terminalId);
  session.listeners.clear();
  if (session.summary.status === "running") session.pty.kill();
}

/**
 * The terminal service: ends every shell when CMM stops, so none is left running without it.
 *
 * @example
 * const BACKGROUND_SERVICES = [createTerminalService(), …];
 */
export function createTerminalService(): BackgroundService {
  return {
    name: "terminal",
    start: () => undefined,
    stop: () => {
      const registry = getTerminalRegistry();
      for (const session of registry.values()) {
        if (session.summary.status === "running") session.pty.kill();
      }
      registry.clear();
    },
  };
}
