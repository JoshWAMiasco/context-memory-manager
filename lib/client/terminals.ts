"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { TerminalListResponse, TerminalSummary } from "@/lib/api-types";
import { requestJson } from "@/lib/client/api";
import { QUERY_KEYS } from "@/lib/client/query-keys";

/** A terminal panel's size and state in the dock. The terminals themselves live on the server. */
export interface TerminalPanelLayout {
  isMinimized: boolean;
  width: number;
  height: number;
  /** New output arrived while it was minimized. */
  hasUnread: boolean;
  /** "docked": a tab of the column beside the editor (on explorer pages); else a floating panel. */
  placement?: "floating" | "docked";
}

interface TerminalDockState {
  /** Panel ids, the most recently opened or focused first (it sits rightmost). */
  order: string[];
  panels: Record<string, TerminalPanelLayout>;
  /** The docked terminal whose tab is open. */
  dockedActiveId?: string;
  /** The docked column is folded to its rail. */
  isDockMinimized?: boolean;
  /** "Open in terminal" docks the new terminal (the user last docked one rather than undocked). */
  prefersDocked?: boolean;
}

export const TERMINAL_PANEL_DEFAULT_WIDTH = 640;
export const TERMINAL_PANEL_DEFAULT_HEIGHT = 420;
export const TERMINAL_PANEL_MINIMUM_WIDTH = 360;
export const TERMINAL_PANEL_MINIMUM_HEIGHT = 220;

const STORAGE_KEY = "cmm.terminal-dock";

const listeners = new Set<() => void>();
let dockState: TerminalDockState = { order: [], panels: {} };
let hasLoaded = false;

function loadDockState(): TerminalDockState {
  if (hasLoaded) return dockState;
  hasLoaded = true;
  try {
    const storedText = window.localStorage.getItem(STORAGE_KEY);
    if (storedText) dockState = JSON.parse(storedText) as TerminalDockState;
  } catch {
    // A private window or blocked storage: panels start at their default size.
  }
  return dockState;
}

function updateDockState(update: (current: TerminalDockState) => TerminalDockState): void {
  dockState = update(loadDockState());
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dockState));
  } catch {
    // Not saved; the dock still works for this page.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY_DOCK_STATE: TerminalDockState = { order: [], panels: {} };

/** The dock's panel layout (this browser only), kept across reloads. */
export function useTerminalDockState(): TerminalDockState {
  return useSyncExternalStore(subscribe, loadDockState, () => EMPTY_DOCK_STATE);
}

/** A panel's layout, or a new expanded one at the default size. */
export function readPanelLayout(state: TerminalDockState, terminalId: string): TerminalPanelLayout {
  return (
    state.panels[terminalId] ?? {
      isMinimized: false,
      width: TERMINAL_PANEL_DEFAULT_WIDTH,
      height: TERMINAL_PANEL_DEFAULT_HEIGHT,
      hasUnread: false,
    }
  );
}

/** Changes one panel's layout. */
export function updatePanelLayout(terminalId: string, changes: Partial<TerminalPanelLayout>): void {
  updateDockState((current) => ({
    ...current,
    panels: { ...current.panels, [terminalId]: { ...readPanelLayout(current, terminalId), ...changes } },
  }));
}

/** Moves a panel to the front (rightmost) and expands it, as when it is opened or picked from the overflow list. */
export function bringPanelToFront(terminalId: string): void {
  updateDockState((current) => ({
    ...current,
    order: [terminalId, ...current.order.filter((id) => id !== terminalId)],
    panels: {
      ...current.panels,
      [terminalId]: { ...readPanelLayout(current, terminalId), isMinimized: false, hasUnread: false },
    },
  }));
}

/** Docks a terminal as a tab of the column beside the editor, opens its tab and unfolds the column. */
export function dockTerminal(terminalId: string): void {
  updateDockState((current) => ({
    ...current,
    // Minimized while docked: on pages without the column it waits in the dock as its title bar.
    panels: {
      ...current.panels,
      [terminalId]: {
        ...readPanelLayout(current, terminalId),
        placement: "docked",
        isMinimized: true,
        hasUnread: false,
      },
    },
    dockedActiveId: terminalId,
    isDockMinimized: false,
    prefersDocked: true,
  }));
}

/** Sends a docked terminal back to the floating dock at the bottom, open and in front. */
export function undockTerminal(terminalId: string): void {
  updateDockState((current) => {
    const remainingDocked = current.order.filter(
      (id) => id !== terminalId && current.panels[id]?.placement === "docked",
    );
    return {
      ...current,
      order: [terminalId, ...current.order.filter((id) => id !== terminalId)],
      panels: {
        ...current.panels,
        [terminalId]: {
          ...readPanelLayout(current, terminalId),
          placement: "floating",
          isMinimized: false,
          hasUnread: false,
        },
      },
      dockedActiveId: current.dockedActiveId === terminalId ? remainingDocked[0] : current.dockedActiveId,
      prefersDocked: remainingDocked.length > 0,
    };
  });
}

/** Opens a docked terminal's tab. */
export function showDockedTerminal(terminalId: string): void {
  updateDockState((current) => ({
    ...current,
    dockedActiveId: terminalId,
    isDockMinimized: false,
    panels: { ...current.panels, [terminalId]: { ...readPanelLayout(current, terminalId), hasUnread: false } },
  }));
}

/** Folds the docked column to its rail, or unfolds it. */
export function setDockMinimized(isDockMinimized: boolean): void {
  if (loadDockState().isDockMinimized === isDockMinimized) return;
  updateDockState((current) => ({ ...current, isDockMinimized }));
}

/** Takes a panel out of the dock, as when its terminal becomes a job (it is on the Jobs page then). */
export function removePanel(terminalId: string): void {
  updateDockState((current) => {
    const remainingDocked = current.order.filter(
      (id) => id !== terminalId && current.panels[id]?.placement === "docked",
    );
    return {
      ...current,
      order: current.order.filter((id) => id !== terminalId),
      panels: Object.fromEntries(Object.entries(current.panels).filter(([id]) => id !== terminalId)),
      dockedActiveId: current.dockedActiveId === terminalId ? remainingDocked[0] : current.dockedActiveId,
    };
  });
}

/**
 * Whether a terminal belongs in the dock: every terminal does, a job only once it is opened in the
 * editor from the Jobs page (it has a panel then). Otherwise jobs run out of the way.
 */
export function isShownInDock(state: TerminalDockState, terminal: TerminalSummary): boolean {
  return !terminal.isJob || terminal.id in state.panels;
}

/** Whether a terminal is docked (shown in the column when the explorer has one). */
export function isDockedPanel(state: TerminalDockState, terminalId: string): boolean {
  return state.panels[terminalId]?.placement === "docked";
}

const dockColumnListeners = new Set<() => void>();
let dockColumnCount = 0;

/**
 * Called by the explorer's split view while it is on screen: docked terminals show in its column
 * then, and in the floating dock otherwise (other pages, narrow screens). Returns the unregister.
 */
export function registerDockColumn(): () => void {
  dockColumnCount += 1;
  for (const listener of dockColumnListeners) listener();
  return () => {
    dockColumnCount -= 1;
    for (const listener of dockColumnListeners) listener();
  };
}

/** Whether a docked-terminal column is on screen (see `registerDockColumn`). */
export function useIsDockColumnShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      dockColumnListeners.add(listener);
      return () => dockColumnListeners.delete(listener);
    },
    () => dockColumnCount > 0,
    () => false,
  );
}

/** Forgets panels whose terminals no longer exist (closed in another tab, or CMM restarted). */
export function prunePanels(existingIds: ReadonlySet<string>): void {
  const current = loadDockState();
  const staleIds = [...current.order, ...Object.keys(current.panels)].filter((id) => !existingIds.has(id));
  if (staleIds.length === 0) return;
  updateDockState((state) => ({
    ...state,
    order: state.order.filter((id) => existingIds.has(id)),
    panels: Object.fromEntries(Object.entries(state.panels).filter(([id]) => existingIds.has(id))),
  }));
}

/**
 * The text to paste for CMM entries dropped on a terminal: their absolute paths, quoted for its
 * shell by the server (only the terminal's owner gets them).
 *
 * @example
 * terminal.paste(await requestDroppedPathText(terminalId, "home", ["notes/today.md"]));
 */
export async function requestDroppedPathText(
  terminalId: string,
  storageId: string,
  paths: readonly string[],
): Promise<string> {
  const { text } = await requestJson<{ text: string }>(`/api/terminals/${encodeURIComponent(terminalId)}/paths`, {
    method: "POST",
    body: { storageId, paths },
  });
  return text;
}

/**
 * Whether this user may open terminals, and the terminals they have open (oldest first). Checked
 * again on focus, so a terminal closed in another tab leaves this one too.
 */
export function useTerminals() {
  return useQuery({
    queryKey: QUERY_KEYS.terminals(),
    queryFn: ({ signal }) => requestJson<TerminalListResponse>("/api/terminals", { signal }),
    staleTime: 30_000,
  });
}

/**
 * Opening and closing terminals, and making one a job (or a job a terminal again). Opening one
 * brings its panel to the front of the dock; a job opens on the Jobs page instead.
 *
 * @example
 * const { openTerminal } = useTerminalMutations();
 * openTerminal.mutate({ storageId: "home", path: "notes" });
 */
export function useTerminalMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.terminals() });
  const openTerminal = useMutation({
    mutationFn: (target: { storageId: string; path: string; isJob?: boolean }) =>
      requestJson<{ terminal: TerminalSummary }>("/api/terminals", { method: "POST", body: target }).then(
        ({ terminal }) => terminal,
      ),
    onSuccess: (terminal) => {
      queryClient.setQueryData<TerminalListResponse>(QUERY_KEYS.terminals(), (current) =>
        current ? { ...current, terminals: [...current.terminals, terminal] } : current,
      );
      if (terminal.isJob) return;
      bringPanelToFront(terminal.id);
      // Opened where the user keeps terminals: docked beside the editor when they last docked one.
      if (loadDockState().prefersDocked && dockColumnCount > 0) dockTerminal(terminal.id);
    },
    onSettled: refresh,
  });
  const closeTerminal = useMutation({
    mutationFn: (terminalId: string) =>
      requestJson<{ ok: true }>(`/api/terminals/${encodeURIComponent(terminalId)}`, { method: "DELETE" }),
    onSuccess: (_result, terminalId) => {
      queryClient.setQueryData<TerminalListResponse>(QUERY_KEYS.terminals(), (current) =>
        current
          ? { ...current, terminals: current.terminals.filter((terminal) => terminal.id !== terminalId) }
          : current,
      );
    },
    onSettled: refresh,
  });
  const setJob = useMutation({
    mutationFn: ({ terminalId, isJob }: { terminalId: string; isJob: boolean }) =>
      requestJson<{ terminal: TerminalSummary }>(`/api/terminals/${encodeURIComponent(terminalId)}`, {
        method: "PATCH",
        body: { isJob },
      }).then(({ terminal }) => terminal),
    onSuccess: (terminal) => {
      queryClient.setQueryData<TerminalListResponse>(QUERY_KEYS.terminals(), (current) =>
        current
          ? { ...current, terminals: current.terminals.map((known) => (known.id === terminal.id ? terminal : known)) }
          : current,
      );
      // A new job leaves the dock for the Jobs page.
      if (terminal.isJob) removePanel(terminal.id);
    },
    onSettled: refresh,
  });
  return { openTerminal, closeTerminal, setJob };
}
