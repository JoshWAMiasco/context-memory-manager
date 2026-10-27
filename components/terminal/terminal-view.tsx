"use client";

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { ClipboardPaste } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { announceError } from "@/components/explorer/explorer-context";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { readDesktopBridge } from "@/lib/client/desktop";
import { ENTRY_DRAG_TYPE, readDraggedEntries } from "@/lib/client/entry-drag";
import { requestDroppedPathText } from "@/lib/client/terminals";
import { resolvedTheme } from "@/lib/client/theme";
import {
  buildTerminalSocketPath,
  formatDroppedPaths,
  MAX_DROPPED_PATHS,
  readShellQuoting,
  TERMINAL_SOCKET_LOCKED_CODE,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "@/lib/terminal";

export type TerminalConnection = "connecting" | "connected" | "disconnected";

/** Waits before reconnecting a dropped socket: quickly at first, then every 5 seconds. */
const RECONNECT_DELAYS_MILLISECONDS = [500, 1000, 2000, 5000];

type TerminalTheme = NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"];

/**
 * The ANSI colours on Light: darker than the theme's tokens for the dark colours, so yellow and
 * the "white" programs use for plain text stay readable on a white background.
 */
const LIGHT_ANSI_COLORS: TerminalTheme = {
  black: "#1d2b38",
  red: "#c42744",
  green: "#08744f",
  yellow: "#8a5300",
  blue: "#2f55c8",
  magenta: "#6d3fd6",
  cyan: "#0a6f96",
  white: "#5d7082",
  brightBlack: "#4e6680",
  brightRed: "#a81f3a",
  brightGreen: "#065f41",
  brightYellow: "#6f4300",
  brightBlue: "#2445a8",
  brightMagenta: "#5a2fbf",
  brightCyan: "#075a7a",
  brightWhite: "#0a1826",
};

/** The terminal's colours, from the theme's tokens, so it matches the rest of CMM in Dark and Light. */
function readTerminalTheme(): TerminalTheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const foreground = token("--color-foreground", "#d8f1ff");
  if (resolvedTheme.read() === "light") {
    return {
      ...LIGHT_ANSI_COLORS,
      background: token("--color-field", "#ffffff"),
      foreground,
      cursor: token("--color-brand", "#0a6f96"),
      cursorAccent: token("--color-field", "#ffffff"),
      selectionBackground: "rgba(10, 111, 150, 0.22)",
    };
  }
  return {
    background: token("--color-field", "#061420"),
    foreground,
    cursor: token("--color-brand", "#4cc9f0"),
    cursorAccent: token("--color-field", "#061420"),
    selectionBackground: "rgba(76, 201, 240, 0.3)",
    black: token("--color-surface-strong", "#153049"),
    red: token("--color-danger", "#ff6b81"),
    green: token("--color-success", "#5ef0b4"),
    yellow: token("--color-warning", "#ffd166"),
    blue: token("--color-info", "#7aa2ff"),
    magenta: token("--color-accent", "#b388ff"),
    cyan: token("--color-brand", "#4cc9f0"),
    white: foreground,
    brightBlack: token("--color-foreground-faint", "#4f6a80"),
    brightRed: token("--color-danger", "#ff6b81"),
    brightGreen: token("--color-success", "#5ef0b4"),
    brightYellow: token("--color-warning", "#ffd166"),
    brightBlue: token("--color-info", "#7aa2ff"),
    brightMagenta: token("--color-accent", "#b388ff"),
    brightCyan: token("--color-brand", "#4cc9f0"),
    brightWhite: token("--color-foreground-strong", "#eef8ff"),
  };
}

/** A drag the terminal takes: CMM entries, or files from the computer. */
function isPathDrag(dragEvent: DragEvent<HTMLDivElement>): boolean {
  const { types } = dragEvent.dataTransfer;
  return types.includes(ENTRY_DRAG_TYPE) || types.includes("Files");
}

/**
 * The text a drop on the terminal pastes, or undefined (with a message) when it has no paths:
 * CMM entries get their absolute paths from the server, files from the computer their local paths
 * from the desktop app. In a browser, a file from the computer has no path on the server.
 */
async function readDroppedPathText(
  dataTransfer: DataTransfer,
  terminalId: string,
  shell: string,
): Promise<string | undefined> {
  const dragged = readDraggedEntries(dataTransfer);
  if (dragged) {
    return requestDroppedPathText(terminalId, dragged.storageId, dragged.paths.slice(0, MAX_DROPPED_PATHS));
  }
  const bridge = readDesktopBridge();
  const localPaths = bridge
    ? [...dataTransfer.files].flatMap((file) => bridge.getPathForFile(file) ?? []).slice(0, MAX_DROPPED_PATHS)
    : [];
  if (localPaths.length > 0) return formatDroppedPaths(localPaths, readShellQuoting(shell));
  showToastNotification({
    title: "No path to paste",
    tone: "warning",
    description: bridge
      ? "These items have no path on this computer."
      : "Files from your computer have no path on the server. Drop them on the file pane to upload them.",
  });
  return undefined;
}

function openSocket(terminalId: string): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${window.location.host}${buildTerminalSocketPath(terminalId)}`);
}

/**
 * One terminal, drawn by xterm.js and connected to its shell over a WebSocket. On every
 * (re)connect the screen is cleared and the server replays the kept output, so a panel that was
 * reloaded or reconnected shows what happened meanwhile. It follows its container's size (and tells
 * the shell), reconnects a dropped socket on its own (not after the session locks), and opens links
 * in the browser. Files and folders dropped on it paste their quoted full paths at the prompt,
 * without pressing Enter.
 *
 * @example
 * <TerminalView terminalId={id} shell="zsh" isVisible onOutput={markUnread} onExit={showExit} onConnectionChange={setConnection} />
 */
export function TerminalView({
  terminalId,
  shell,
  isVisible,
  onOutput,
  onExit,
  onConnectionChange,
}: {
  terminalId: string;
  /** The shell's executable name (`TerminalSummary.shell`), for quoting dropped paths. */
  shell: string;
  /** False while the panel is minimized: output still arrives, the size isn't measured. */
  isVisible: boolean;
  /** New output; `isReplay` for the kept output the server sends first on every connect. */
  onOutput: (isReplay: boolean) => void;
  onExit: (exitCode: number) => void;
  onConnectionChange: (connection: TerminalConnection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const fitRef = useRef<(() => void) | undefined>(undefined);
  const callbacksRef = useRef({ onOutput, onExit, onConnectionChange });
  const isVisibleRef = useRef(isVisible);
  const [isDropTarget, setIsDropTarget] = useState(false);
  useEffect(() => {
    callbacksRef.current = { onOutput, onExit, onConnectionChange };
    isVisibleRef.current = isVisible;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let isDisposed = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let resizeFrame: number | undefined;
    const disposers: (() => void)[] = [];

    const send = (message: TerminalClientMessage) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    void (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      if (isDisposed) return;
      const terminal = new Terminal({
        theme: readTerminalTheme(),
        fontFamily: getComputedStyle(document.body).fontFamily || "ui-monospace, monospace",
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: false,
        macOptionIsMeta: true,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      // window.open goes through the desktop app's "leaves CMM" confirmation, then the browser.
      terminal.loadAddon(new WebLinksAddon((_event, url) => window.open(url, "_blank", "noopener")));
      terminal.open(container);
      terminalRef.current = terminal;
      if (isVisibleRef.current) terminal.focus();

      const fit = () => {
        if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined;
          if (container.clientWidth === 0 || container.clientHeight === 0) return;
          fitAddon.fit();
          send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
        });
      };
      fitRef.current = fit;
      const resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(container);
      disposers.push(() => resizeObserver.disconnect());
      const inputSubscription = terminal.onData((data) => send({ type: "input", data }));
      disposers.push(() => inputSubscription.dispose());
      // A theme change (or the computer's, under System) recolours the terminal in place.
      disposers.push(
        resolvedTheme.subscribe(() => {
          terminal.options.theme = readTerminalTheme();
        }),
      );

      const connect = () => {
        callbacksRef.current.onConnectionChange("connecting");
        const nextSocket = openSocket(terminalId);
        socket = nextSocket;
        let isFirstMessage = true;
        nextSocket.addEventListener("open", () => {
          reconnectAttempt = 0;
          terminal.reset();
          callbacksRef.current.onConnectionChange("connected");
          fit();
        });
        nextSocket.addEventListener("message", (messageEvent) => {
          const message = JSON.parse(String(messageEvent.data)) as TerminalServerMessage;
          const isReplay = isFirstMessage;
          isFirstMessage = false;
          if (message.type === "output") {
            terminal.write(message.data);
            callbacksRef.current.onOutput(isReplay);
            return;
          }
          terminal.write(`\r\n\x1b[2m[The shell ended with exit code ${message.exitCode}.]\x1b[0m\r\n`);
          callbacksRef.current.onExit(message.exitCode);
        });
        nextSocket.addEventListener("close", (closeEvent) => {
          if (isDisposed || socket !== nextSocket) return;
          callbacksRef.current.onConnectionChange("disconnected");
          // A locked session takes the user to the lock page; the terminal reconnects after unlocking.
          if (closeEvent.code === TERMINAL_SOCKET_LOCKED_CODE) return;
          const delay =
            RECONNECT_DELAYS_MILLISECONDS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MILLISECONDS.length - 1)];
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(connect, delay);
        });
      };
      connect();
    })();

    return () => {
      isDisposed = true;
      window.clearTimeout(reconnectTimer);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      for (const dispose of disposers) dispose();
      socket?.close();
      terminalRef.current?.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
    };
  }, [terminalId]);

  useEffect(() => {
    if (!isVisible) return;
    fitRef.current?.();
    terminalRef.current?.focus();
  }, [isVisible]);

  const handleDrop = (dragEvent: DragEvent<HTMLDivElement>) => {
    // Captured before xterm's text area sees it: the browser would type the dragged text into the shell.
    if (!isPathDrag(dragEvent)) return;
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    setIsDropTarget(false);
    void readDroppedPathText(dragEvent.dataTransfer, terminalId, shell).then(
      (text) => {
        const terminal = terminalRef.current;
        if (text === undefined || !terminal) return;
        terminal.paste(text);
        terminal.focus();
      },
      (pasteError: unknown) => announceError("Couldn't paste the path", pasteError),
    );
  };

  return (
    <div
      className="relative h-full w-full"
      data-testid="terminal-drop-target"
      onDragOverCapture={(dragEvent) => {
        if (!isPathDrag(dragEvent)) return;
        dragEvent.preventDefault();
        dragEvent.stopPropagation();
        dragEvent.dataTransfer.dropEffect = "copy";
        if (!isDropTarget) setIsDropTarget(true);
      }}
      onDragLeave={(dragEvent) => {
        if (!dragEvent.currentTarget.contains(dragEvent.relatedTarget as Node | null)) setIsDropTarget(false);
      }}
      onDropCapture={handleDrop}
    >
      <div ref={containerRef} className="h-full w-full overflow-hidden" data-testid="terminal-view" />
      {isDropTarget && (
        <div className="pointer-events-none absolute inset-1 z-10 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-brand bg-field/85 text-brand">
          <ClipboardPaste className="h-7 w-7 stroke-[1.25]" />
          <p className="text-sm font-medium">Drop to paste the full path</p>
        </div>
      )}
    </div>
  );
}
