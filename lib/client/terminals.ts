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
}

interface TerminalDockState {
  /** Panel ids, the most recently opened or focused first (it sits rightmost). */
  order: string[];
  panels: Record<string, TerminalPanelLayout>;
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
    order: [terminalId, ...current.order.filter((id) => id !== terminalId)],
    panels: {
      ...current.panels,
      [terminalId]: { ...readPanelLayout(current, terminalId), isMinimized: false, hasUnread: false },
    },
  }));
}

/** Forgets panels whose terminals no longer exist (closed in another tab, or CMM restarted). */
export function prunePanels(existingIds: ReadonlySet<string>): void {
  const current = loadDockState();
  const staleIds = [...current.order, ...Object.keys(current.panels)].filter((id) => !existingIds.has(id));
  if (staleIds.length === 0) return;
  updateDockState((state) => ({
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
 * Opening and closing terminals. Opening one brings its panel to the front of the dock.
 *
 * @example
 * const { openTerminal } = useTerminalMutations();
 * openTerminal.mutate({ storageId: "home", path: "notes" });
 */
export function useTerminalMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.terminals() });
  const openTerminal = useMutation({
    mutationFn: (target: { storageId: string; path: string }) =>
      requestJson<{ terminal: TerminalSummary }>("/api/terminals", { method: "POST", body: target }).then(
        ({ terminal }) => terminal,
      ),
    onSuccess: (terminal) => {
      queryClient.setQueryData<TerminalListResponse>(QUERY_KEYS.terminals(), (current) =>
        current ? { ...current, terminals: [...current.terminals, terminal] } : current,
      );
      bringPanelToFront(terminal.id);
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
  return { openTerminal, closeTerminal };
}
