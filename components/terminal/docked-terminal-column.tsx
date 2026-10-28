"use client";

import { Minimize2, PanelBottom, RotateCcw, ServerCog, SquareTerminal, X } from "lucide-react";
import { useState } from "react";
import { announceError } from "@/components/explorer/explorer-context";
import { ConfirmDialog } from "@/components/interactive/confirm-dialog";
import { runAsJob } from "@/components/jobs/run-as-job";
import { Tooltip } from "@/components/interactive/tooltip";
import { TerminalView } from "@/components/terminal/terminal-view";
import type { TerminalSummary } from "@/lib/api-types";
import { formatShortcut } from "@/lib/client/shortcuts";
import {
  dockTerminal,
  readPanelLayout,
  setDockMinimized,
  showDockedTerminal,
  undockTerminal,
  updatePanelLayout,
  useTerminalDockState,
  useTerminalMutations,
} from "@/lib/client/terminals";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** ⌘J (Ctrl+J elsewhere) folds or unfolds the docked terminal column. */
export const TERMINAL_TOGGLE_SHORTCUT = "Mod-J";

function ColumnButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The docked terminals, as a column beside the editor: a tab per terminal (marked when it has
 * new output), and for the open one Restart (once its shell ended), Run as a job (it moves to the
 * Jobs page and keeps running after CMM closes), Undock (back to the floating
 * dock at the bottom), Minimize (fold the column to its rail, ⌘J) and Close (asks first while it
 * runs). Every docked terminal stays connected; only the open tab is shown. On phones
 * (`isFullWidth`) it fills the explorer: there is nowhere to undock or fold it to.
 *
 * @example
 * <DockedTerminalColumn terminals={dockedTerminals} isFolded={false} />
 */
export function DockedTerminalColumn({
  terminals,
  isFolded,
  isFullWidth = false,
}: {
  /** The docked terminals, in tab order. */
  terminals: readonly TerminalSummary[];
  /** The column is folded to its rail: the terminals stay connected but aren't measured. */
  isFolded: boolean;
  /** The explorer's Terminal view on phones: no Undock or Minimize, no border beside an editor. */
  isFullWidth?: boolean;
}) {
  const dockState = useTerminalDockState();
  const { openTerminal, closeTerminal, setJob } = useTerminalMutations();
  const [exitCodes, setExitCodes] = useState<Record<string, number>>({});
  const [closingTerminal, setClosingTerminal] = useState<TerminalSummary>();
  const active = terminals.find((terminal) => terminal.id === dockState.dockedActiveId) ?? terminals[0];
  if (!active) return null;
  const hasExited = (terminal: TerminalSummary) => terminal.status === "exited" || terminal.id in exitCodes;

  const close = (terminal: TerminalSummary) =>
    closeTerminal.mutate(terminal.id, {
      onError: (closeError) => announceError("Couldn't close the terminal", closeError),
    });
  const restart = (terminal: TerminalSummary) =>
    openTerminal.mutate(
      { storageId: terminal.storageId, path: terminal.path },
      {
        onSuccess: (restarted) => {
          dockTerminal(restarted.id);
          close(terminal);
        },
        onError: (openError) => announceError("Couldn't restart the terminal", openError),
      },
    );

  return (
    <section
      className={mergeClassNames(
        "flex h-full min-h-0 flex-col bg-surface-subtle",
        !isFullWidth && "border-l border-line/60",
      )}
      aria-label="Docked terminals"
      data-testid="docked-terminals"
    >
      <header className="flex h-10 flex-none items-center gap-1 border-b border-line/60 pr-1.5 pl-1">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {terminals.map((terminal) => {
            const isActive = terminal.id === active.id;
            const hasUnread = !isActive && readPanelLayout(dockState, terminal.id).hasUnread;
            return (
              <div
                key={terminal.id}
                className={mergeClassNames(
                  "group/tab flex max-w-48 min-w-0 flex-none items-center rounded-md",
                  isActive ? "bg-surface-strong" : "hover:bg-surface-muted",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => showDockedTerminal(terminal.id)}
                  title={terminal.path === "" ? terminal.storageLabel : `${terminal.storageLabel} / ${terminal.path}`}
                  className="flex min-w-0 cursor-pointer items-center gap-1.5 py-1 pr-1 pl-2 text-xs"
                  data-testid="docked-terminal-tab"
                  data-terminal-id={terminal.id}
                >
                  <span className="relative flex-none text-brand">
                    <SquareTerminal className="h-3.5 w-3.5 stroke-[1.5]" />
                    {hasUnread && (
                      <span
                        className="absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full bg-accent"
                        aria-label="New output"
                        data-testid="docked-terminal-unread"
                      />
                    )}
                  </span>
                  <span className={mergeClassNames("truncate", isActive && "font-medium")}>{terminal.title}</span>
                  {terminal.isJob && <span className="flex-none text-brand">· job</span>}
                  {hasExited(terminal) && <span className="flex-none text-foreground-subtle">· ended</span>}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${terminal.title}`}
                  onClick={() => (hasExited(terminal) ? close(terminal) : setClosingTerminal(terminal))}
                  className="mr-0.5 flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded text-foreground-subtle hover:bg-surface-heavy hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        {hasExited(active) && (
          <ColumnButton label="Restart in the same folder" onClick={() => restart(active)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </ColumnButton>
        )}
        {!active.isJob && !hasExited(active) && (
          <ColumnButton label="Run as a job (keeps running after CMM closes)" onClick={() => runAsJob(setJob, active)}>
            <ServerCog className="h-4 w-4" />
          </ColumnButton>
        )}
        {!isFullWidth && (
          <>
            <ColumnButton label="Undock to the bottom" onClick={() => undockTerminal(active.id)}>
              <PanelBottom className="h-4 w-4" />
            </ColumnButton>
            <ColumnButton
              label={`Minimize (${formatShortcut(TERMINAL_TOGGLE_SHORTCUT)})`}
              onClick={() => setDockMinimized(true)}
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </ColumnButton>
          </>
        )}
      </header>
      <div className="relative min-h-0 flex-1 bg-field">
        {terminals.map((terminal) => {
          const isShown = terminal.id === active.id;
          return (
            <div
              key={terminal.id}
              className={mergeClassNames(
                "absolute inset-0 pt-1",
                !isFullWidth && "pb-1 pl-2",
                isFullWidth && "pl-1",
                !isShown && "hidden",
              )}
              data-terminal-id={terminal.id}
              data-testid="docked-terminal"
            >
              <TerminalView
                terminalId={terminal.id}
                shell={terminal.shell}
                isVisible={isShown && !isFolded}
                onOutput={(isReplay) => {
                  if (!isReplay && (!isShown || isFolded) && !readPanelLayout(dockState, terminal.id).hasUnread) {
                    updatePanelLayout(terminal.id, { hasUnread: true });
                  }
                }}
                onExit={(exitCode) => setExitCodes((codes) => ({ ...codes, [terminal.id]: exitCode }))}
                onConnectionChange={() => undefined}
              />
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        isOpen={closingTerminal !== undefined}
        onOpenChange={(isOpen) => !isOpen && setClosingTerminal(undefined)}
        title={
          closingTerminal?.isJob
            ? `Discard the job "${closingTerminal.title}"?`
            : `Close "${closingTerminal?.title ?? ""}"?`
        }
        confirmLabel={closingTerminal?.isJob ? "Discard job" : "Close terminal"}
        confirmVariant="danger"
        testId="close-terminal-dialog"
        onConfirm={() => {
          if (closingTerminal) close(closingTerminal);
        }}
      >
        Whatever is running in it stops{closingTerminal?.isJob ? ", and nothing of it is kept" : ""}.
      </ConfirmDialog>
    </section>
  );
}
