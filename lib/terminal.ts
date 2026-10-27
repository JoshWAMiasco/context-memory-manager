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

/** How a terminal's shell wants a path quoted: POSIX shells, PowerShell, or cmd.exe. */
export type ShellQuoting = "posix" | "powershell" | "cmd";

/** Paths at most this many per drop, so a huge selection can't flood the prompt. */
export const MAX_DROPPED_PATHS = 100;

/** Characters a POSIX shell reads literally, so a path made only of them needs no quotes. */
const POSIX_SAFE_PATH = /^[\w/.,:@%+=-]+$/;

/**
 * The quoting a terminal's shell needs, from its executable name (`TerminalSummary.shell`).
 *
 * @example
 * readShellQuoting("zsh"); // "posix"
 * readShellQuoting("cmd.exe"); // "cmd"
 */
export function readShellQuoting(shellName: string): ShellQuoting {
  const name = shellName.toLowerCase();
  if (name === "cmd" || name === "cmd.exe") return "cmd";
  if (/^(powershell|pwsh)(\.exe)?$/.test(name)) return "powershell";
  return "posix";
}

/**
 * Quotes one path for a shell prompt, or returns undefined when it can't be pasted safely: control
 * characters (a newline would run the line), and `"` or `%` for cmd.exe, which has no way to escape
 * them inside quotes.
 *
 * @example
 * quoteShellPath("/srv/cmm/notes/today.md", "posix"); // "/srv/cmm/notes/today.md"
 * quoteShellPath("/srv/cmm/it's here", "posix"); // "'/srv/cmm/it'\''s here'"
 */
export function quoteShellPath(path: string, quoting: ShellQuoting): string | undefined {
  if (path === "" || /[\u0000-\u001F\u007F]/.test(path)) return undefined;
  if (quoting === "cmd") return /["%]/.test(path) ? undefined : /[\s&()^|<>,;=!]/.test(path) ? `"${path}"` : path;
  if (quoting === "powershell") return `'${path.replaceAll("'", "''")}'`;
  return POSIX_SAFE_PATH.test(path) ? path : `'${path.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * The text a drop pastes at the prompt: the quoted paths separated by spaces, with a trailing
 * space so the next word can be typed straight away. Never a newline, so nothing runs. Throws when
 * a path can't be quoted safely.
 *
 * @example
 * formatDroppedPaths(["/srv/a.md", "/srv/b c.md"], "posix"); // "/srv/a.md '/srv/b c.md' "
 */
export function formatDroppedPaths(paths: readonly string[], quoting: ShellQuoting): string {
  const quoted = paths.map((path) => {
    const quotedPath = quoteShellPath(path, quoting);
    if (quotedPath === undefined) throw new Error(`"${path}" has characters that can't be pasted into this shell.`);
    return quotedPath;
  });
  return `${quoted.join(" ")} `;
}
