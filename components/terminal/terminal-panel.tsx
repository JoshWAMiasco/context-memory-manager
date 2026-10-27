"use client";

import { ChevronUp, Minus, RotateCcw, SquareTerminal, X } from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { TerminalView, type TerminalConnection } from "@/components/terminal/terminal-view";
import type { TerminalSummary } from "@/lib/api-types";
import {
  TERMINAL_PANEL_MINIMUM_HEIGHT,
  TERMINAL_PANEL_MINIMUM_WIDTH,
  updatePanelLayout,
  type TerminalPanelLayout,
} from "@/lib/client/terminals";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** A minimized panel: just its title bar. */
export const TERMINAL_MINIMIZED_WIDTH = 260;
const HEADER_HEIGHT = 40;
/** Room kept above an expanded panel, so the top bar stays reachable. */
const TOP_CLEARANCE = 80;

type ResizeEdge = "top" | "left" | "corner";

function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.round(Math.min(Math.max(width, TERMINAL_PANEL_MINIMUM_WIDTH), window.innerWidth - 32)),
    height: Math.round(Math.min(Math.max(height, TERMINAL_PANEL_MINIMUM_HEIGHT), window.innerHeight - TOP_CLEARANCE)),
  };
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * One terminal in the dock, like a chat window: a title bar (the memory or folder, its storage,
 * whether the shell ended) with Restart, Minimize and Close, and the terminal below it. Drag the top
 * edge, the left edge or the top-left corner to resize it; the size is remembered. Minimized it is
 * just the title bar, marked when new output arrives; click it to open it again. Closing a running
 * terminal asks first, since whatever runs in it stops.
 *
 * @example
 * <TerminalPanel terminal={terminal} layout={layout} isCollapsed={false} onFocus={…} onClose={…} onRestart={…} />
 */
export function TerminalPanel({
  terminal,
  layout,
  isCollapsed,
  isHidden,
  maxWidth,
  onFocus,
  onClose,
  onRestart,
  onDisconnect,
}: {
  terminal: TerminalSummary;
  layout: TerminalPanelLayout;
  /** Shown as its title bar: minimized, or squeezed out by the panels in front of it. */
  isCollapsed: boolean;
  /** Listed in the dock's overflow menu instead (no room even for its title bar). */
  isHidden: boolean;
  /** The widest it may be: the window's width less the dock's margins. */
  maxWidth: number;
  onFocus: () => void;
  onClose: () => void;
  onRestart: () => void;
  onDisconnect: () => void;
}) {
  const [connection, setConnection] = useState<TerminalConnection>("connecting");
  const [exitCode, setExitCode] = useState<number | undefined>(terminal.exitCode);
  const [isConfirmingClose, setIsConfirmingClose] = useState(false);
  const [draftSize, setDraftSize] = useState<{ width: number; height: number }>();
  const hasExited = exitCode !== undefined || terminal.status === "exited";
  const size = draftSize ?? { width: layout.width, height: layout.height };
  const location = terminal.path === "" ? terminal.storageLabel : `${terminal.storageLabel} / ${terminal.path}`;

  const startResize = (edge: ResizeEdge) => (pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    pointerEvent.preventDefault();
    const handle = pointerEvent.currentTarget;
    handle.setPointerCapture(pointerEvent.pointerId);
    const start = { x: pointerEvent.clientX, y: pointerEvent.clientY, width: size.width, height: size.height };
    let latest = start;
    const handleMove = (moveEvent: PointerEvent) => {
      // The panel is pinned to the bottom right, so dragging left or up makes it bigger.
      latest = {
        ...start,
        ...clampSize(
          edge === "top" ? start.width : start.width + (start.x - moveEvent.clientX),
          edge === "left" ? start.height : start.height + (start.y - moveEvent.clientY),
        ),
      };
      setDraftSize({ width: latest.width, height: latest.height });
    };
    const handleUp = () => {
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
      handle.removeEventListener("pointercancel", handleUp);
      updatePanelLayout(terminal.id, { width: latest.width, height: latest.height });
      setDraftSize(undefined);
    };
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
    handle.addEventListener("pointercancel", handleUp);
  };

  const requestClose = () => {
    if (hasExited) onClose();
    else setIsConfirmingClose(true);
  };

  return (
    <section
      aria-label={`Terminal: ${terminal.title}`}
      data-testid="terminal-panel"
      data-terminal-id={terminal.id}
      data-collapsed={isCollapsed}
      className={mergeClassNames(
        "pointer-events-auto relative flex flex-none flex-col overflow-hidden rounded-t-lg border border-b-0 border-line-strong bg-surface-strong shadow-overlay",
        isHidden && "hidden",
      )}
      style={
        isCollapsed
          ? { width: TERMINAL_MINIMIZED_WIDTH, height: HEADER_HEIGHT }
          : { width: Math.min(size.width, maxWidth), height: size.height }
      }
    >
      {!isCollapsed && (
        <>
          <div
            className="absolute inset-x-3 top-0 z-10 h-1.5 cursor-ns-resize"
            onPointerDown={startResize("top")}
            aria-hidden
          />
          <div
            className="absolute inset-y-3 left-0 z-10 w-1.5 cursor-ew-resize"
            onPointerDown={startResize("left")}
            aria-hidden
          />
          <div
            className="absolute top-0 left-0 z-20 h-3 w-3 cursor-nwse-resize"
            onPointerDown={startResize("corner")}
            data-testid="terminal-resize-corner"
            aria-hidden
          />
        </>
      )}
      <header
        className={mergeClassNames(
          "flex h-10 flex-none cursor-pointer items-center gap-2 border-b border-line pr-1.5 pl-3 select-none",
          isCollapsed && "border-b-0 hover:bg-surface-heavy",
        )}
        onClick={() => {
          if (isCollapsed) onFocus();
        }}
        onDoubleClick={() => {
          if (!isCollapsed) updatePanelLayout(terminal.id, { isMinimized: true });
        }}
        title={location}
      >
        <span className="relative flex-none text-brand">
          <SquareTerminal className="h-4 w-4 stroke-[1.5]" />
          {isCollapsed && layout.hasUnread && (
            <span
              className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent"
              aria-label="New output"
              data-testid="terminal-unread"
            />
          )}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">{terminal.title}</div>
          {!isCollapsed && <div className="truncate text-[11px] text-foreground-subtle">{location}</div>}
        </div>
        {hasExited ? (
          <span className="flex-none text-[11px] text-foreground-subtle" data-testid="terminal-exited">
            Ended{exitCode ? ` (${exitCode})` : ""}
          </span>
        ) : (
          connection === "disconnected" && (
            <span className="flex-none text-[11px] text-warning" data-testid="terminal-disconnected">
              Reconnecting…
            </span>
          )
        )}
        {hasExited && (
          <HeaderButton label="Restart in the same folder" onClick={onRestart}>
            <RotateCcw className="h-3.5 w-3.5" />
          </HeaderButton>
        )}
        {isCollapsed ? (
          <HeaderButton label="Open" onClick={onFocus}>
            <ChevronUp className="h-4 w-4" />
          </HeaderButton>
        ) : (
          <HeaderButton label="Minimize" onClick={() => updatePanelLayout(terminal.id, { isMinimized: true })}>
            <Minus className="h-4 w-4" />
          </HeaderButton>
        )}
        <HeaderButton label="Close terminal" onClick={requestClose}>
          <X className="h-4 w-4" />
        </HeaderButton>
      </header>
      <div className={mergeClassNames("min-h-0 flex-1 bg-field py-1 pl-2", isCollapsed && "hidden")}>
        <TerminalView
          terminalId={terminal.id}
          shell={terminal.shell}
          isVisible={!isCollapsed && !isHidden}
          onOutput={(isReplay) => {
            if (!isReplay && (isCollapsed || isHidden) && !layout.hasUnread) {
              updatePanelLayout(terminal.id, { hasUnread: true });
            }
          }}
          onExit={setExitCode}
          onConnectionChange={(nextConnection) => {
            setConnection(nextConnection);
            if (nextConnection === "disconnected") onDisconnect();
          }}
        />
      </div>
      <ConfirmDialog
        isOpen={isConfirmingClose}
        onOpenChange={setIsConfirmingClose}
        title={`Close "${terminal.title}"?`}
        confirmLabel="Close terminal"
        confirmVariant="danger"
        testId="close-terminal-dialog"
        onConfirm={onClose}
      >
        Whatever is running in it stops.
      </ConfirmDialog>
    </section>
  );
}
