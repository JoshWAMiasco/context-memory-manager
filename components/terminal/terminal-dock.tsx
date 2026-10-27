"use client";

import { SquareTerminal } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { announceError } from "@/components/explorer/explorer-context";
import { DropdownMenu, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { TERMINAL_MINIMIZED_WIDTH, TerminalPanel } from "@/components/terminal/terminal-panel";
import type { TerminalSummary } from "@/lib/api-types";
import {
  bringPanelToFront,
  dockTerminal,
  isDockedPanel,
  prunePanels,
  readPanelLayout,
  useIsDockColumnShown,
  useTerminalDockState,
  useTerminalMutations,
  useTerminals,
} from "@/lib/client/terminals";

const DOCK_EDGE = 16;
const PANEL_GAP = 12;
const OVERFLOW_BUTTON_WIDTH = 56;

function subscribeToWindowWidth(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

interface PlacedPanel {
  terminal: TerminalSummary;
  isCollapsed: boolean;
  isHidden: boolean;
}

/**
 * Places the panels right to left, the front one rightmost, like chat windows: each keeps its size
 * while it fits; one that doesn't is shown as its title bar, and one without room even for that
 * goes to the "+N" overflow menu.
 */
function placePanels(
  terminals: readonly TerminalSummary[],
  dockState: ReturnType<typeof useTerminalDockState>,
  availableWidth: number,
): PlacedPanel[] {
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const ordered = [
    ...dockState.order.flatMap((id) => byId.get(id) ?? []),
    ...terminals.filter((terminal) => !dockState.order.includes(terminal.id)).toReversed(),
  ];
  const place = (widthLimit: number) => {
    let usedWidth = 0;
    return ordered.map((terminal): PlacedPanel => {
      const layout = readPanelLayout(dockState, terminal.id);
      const gap = usedWidth === 0 ? 0 : PANEL_GAP;
      const expandedWidth = Math.min(layout.width, widthLimit);
      if (!layout.isMinimized && usedWidth + gap + expandedWidth <= widthLimit) {
        usedWidth += gap + expandedWidth;
        return { terminal, isCollapsed: false, isHidden: false };
      }
      if (usedWidth + gap + TERMINAL_MINIMIZED_WIDTH <= widthLimit) {
        usedWidth += gap + TERMINAL_MINIMIZED_WIDTH;
        return { terminal, isCollapsed: true, isHidden: false };
      }
      return { terminal, isCollapsed: true, isHidden: true };
    });
  };
  const placed = place(availableWidth);
  return placed.some((panel) => panel.isHidden) ? place(availableWidth - OVERFLOW_BUTTON_WIDTH - PANEL_GAP) : placed;
}

/**
 * The terminals, pinned along the bottom of every signed-in page like chat windows: each can be
 * minimized to its title bar, opened again, resized, and closed, and several can be open at once.
 * Terminals keep running on the server while their panels are minimized or the page reloads. It
 * shows nothing for users who can't open terminals. On explorer pages a panel can be docked beside
 * the editor (`DockedTerminalColumn`); docked terminals leave the dock there, and wait in it as
 * title bars on other pages.
 *
 * @example
 * <TerminalDock />
 */
export function TerminalDock() {
  const { data, refetch } = useTerminals();
  const dockState = useTerminalDockState();
  const { openTerminal, closeTerminal } = useTerminalMutations();
  const isDockColumnShown = useIsDockColumnShown();
  const windowWidth = useSyncExternalStore(
    subscribeToWindowWidth,
    () => window.innerWidth,
    () => 0,
  );
  const allTerminals = data?.available ? data.terminals : [];
  const terminals = isDockColumnShown
    ? allTerminals.filter((terminal) => !isDockedPanel(dockState, terminal.id))
    : allTerminals;

  // Panels of terminals that are gone (closed in another tab, or CMM restarted) are forgotten.
  const terminalIdsKey = data ? allTerminals.map((terminal) => terminal.id).join(",") : undefined;
  useEffect(() => {
    if (terminalIdsKey !== undefined) prunePanels(new Set(terminalIdsKey.split(",").filter(Boolean)));
  }, [terminalIdsKey]);

  if (terminals.length === 0 || windowWidth === 0) return null;
  const availableWidth = windowWidth - 2 * DOCK_EDGE;
  const placedPanels = placePanels(terminals, dockState, availableWidth);
  const hiddenPanels = placedPanels.filter((panel) => panel.isHidden);

  const restart = (terminal: TerminalSummary) => {
    openTerminal.mutate(
      { storageId: terminal.storageId, path: terminal.path },
      {
        onSuccess: () => closeTerminal.mutate(terminal.id),
        onError: (openError) => announceError("Couldn't restart the terminal", openError),
      },
    );
  };

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 flex flex-row-reverse items-end gap-3 md:bottom-0"
      data-testid="terminal-dock"
    >
      {placedPanels.map(({ terminal, isCollapsed, isHidden }) => (
        <TerminalPanel
          key={terminal.id}
          terminal={terminal}
          layout={readPanelLayout(dockState, terminal.id)}
          isCollapsed={isCollapsed}
          isHidden={isHidden}
          maxWidth={availableWidth}
          onFocus={() => bringPanelToFront(terminal.id)}
          onClose={() =>
            closeTerminal.mutate(terminal.id, {
              onError: (closeError) => announceError("Couldn't close the terminal", closeError),
            })
          }
          onRestart={() => restart(terminal)}
          onDock={isDockColumnShown ? () => dockTerminal(terminal.id) : undefined}
          onDisconnect={() => void refetch()}
        />
      ))}
      {hiddenPanels.length > 0 && (
        <DropdownMenu
          className="pointer-events-auto mb-1"
          placement="top end"
          triggerLabel={`${hiddenPanels.length} more terminals`}
          triggerClassName="h-9 rounded-full border border-line-strong bg-surface-strong px-3 text-sm shadow-overlay hover:bg-surface-heavy"
          trigger={<span data-testid="terminal-overflow">+{hiddenPanels.length}</span>}
        >
          {hiddenPanels.map(({ terminal }) => (
            <DropdownMenuItem
              key={terminal.id}
              icon={<SquareTerminal className="mr-2 h-4 w-4 text-brand" />}
              onSelect={() => bringPanelToFront(terminal.id)}
            >
              {terminal.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      )}
    </div>
  );
}
