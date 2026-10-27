"use client";

import Link from "next/link";
import { FileText, FolderTree, HardDrive, PanelLeftOpen, SquareTerminal, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef, type Layout } from "react-resizable-panels";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
import { EmptyState } from "@/components/primitives/empty-state";
import { ExplorerContextMenu } from "@/components/explorer/explorer-context-menu";
import {
  ExplorerProvider,
  useExplorer,
  type ApplicationMode,
  type MemoryRoot,
} from "@/components/explorer/explorer-context";
import { ExplorerDialogs } from "@/components/explorer/explorer-dialogs";
import { FileTree } from "@/components/explorer/file-tree";
import { MemoryIcon } from "@/components/explorer/memory-icon";
import { TreeToolbar } from "@/components/explorer/tree-toolbar";
import {
  TREE_TOGGLE_SHORTCUT,
  TreeVisibilityContext,
  useTreeToggleShortcut,
} from "@/components/explorer/tree-visibility";
import { DockedTerminalColumn, TERMINAL_TOGGLE_SHORTCUT } from "@/components/terminal/docked-terminal-column";
import { useOpenTerminal } from "@/components/terminal/use-open-terminal";
import { FilePane } from "@/components/viewer/file-pane";
import type { UserRole } from "@/lib/auth/policy";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { StorageSummary } from "@/lib/api-types";
import { readBaseName } from "@/lib/client/query-keys";
import { buildStorageHref } from "@/lib/client/routes";
import { formatShortcut, isCommandShortcut } from "@/lib/client/shortcuts";
import {
  dockTerminal,
  isDockedPanel,
  readPanelLayout,
  registerDockColumn,
  setDockMinimized,
  useTerminalDockState,
  useTerminals,
} from "@/lib/client/terminals";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** `localStorage` key of the tree/pane/terminal split. */
export const SPLIT_STORAGE_KEY = "cmm.split";

const TREE_PANEL_ID = "tree";
const PANE_PANEL_ID = "pane";
const TERMINAL_PANEL_ID = "terminal";
/** The docked terminal column's width the first time a terminal is docked. */
const TERMINAL_DEFAULT_SIZE = "35%";

/**
 * The saved split, or undefined when it is unusable. A 1.1.2 split (tree and pane only) gets a
 * folded terminal column.
 */
function readSavedLayout(): Layout | undefined {
  try {
    const savedText = window.localStorage.getItem(SPLIT_STORAGE_KEY);
    if (!savedText) return undefined;
    const savedLayout = JSON.parse(savedText) as Layout;
    const treeSize = savedLayout[TREE_PANEL_ID];
    const isUsable = typeof treeSize === "number" && (treeSize === 0 || (treeSize >= 16 && treeSize <= 45));
    if (!isUsable) return undefined;
    const terminalSize = savedLayout[TERMINAL_PANEL_ID] ?? 0;
    return {
      [TREE_PANEL_ID]: treeSize,
      [PANE_PANEL_ID]: 100 - treeSize - terminalSize,
      [TERMINAL_PANEL_ID]: terminalSize,
    };
  } catch {
    return undefined;
  }
}

function saveLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    return;
  }
}

const subscribeToNothing = () => () => undefined;

/** Above a memory's own tree: the memory's icon and name, and a way back to the whole storage. */
function MemoryTreeHeader({ memoryRoot }: { memoryRoot: MemoryRoot }) {
  const { storage, selectedPath } = useExplorer();
  const { memory } = memoryRoot;
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2" data-testid="memory-tree-header">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-line bg-surface-subtle">
        <MemoryIcon icon={memory.icon} color={memory.color} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={memory.name}>
          {memory.name}
        </div>
        <div className="truncate text-xs text-foreground-subtle">Memory in {storage.label}</div>
      </div>
      <Tooltip content={`Open in ${storage.label}`}>
        <Link
          href={buildStorageHref(storage.id, selectedPath)}
          aria-label={`Open in ${storage.label}`}
          data-testid="memory-exit"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-muted hover:text-brand"
        >
          <HardDrive className="h-4 w-4 stroke-[1.5]" />
        </Link>
      </Tooltip>
    </div>
  );
}

function TreeColumn() {
  const { memoryRoot } = useExplorer();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {memoryRoot && <MemoryTreeHeader memoryRoot={memoryRoot} />}
      <TreeToolbar />
      <FileTree />
    </div>
  );
}

function ShowTreeRail({ onShow }: { onShow: () => void }) {
  return (
    <div className="flex h-full w-10 flex-none flex-col items-center border-r border-line/60 py-1.5">
      <Tooltip content={`Show file tree (${formatShortcut(TREE_TOGGLE_SHORTCUT)})`}>
        <button
          type="button"
          aria-label="Show file tree"
          data-testid="tree-show"
          onClick={onShow}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-muted hover:text-brand"
        >
          <PanelLeftOpen className="h-4 w-4 stroke-[1.5]" />
        </button>
      </Tooltip>
    </div>
  );
}

function ShowTerminalRail({ hasUnread, onShow }: { hasUnread: boolean; onShow: () => void }) {
  return (
    <div className="flex h-full w-10 flex-none flex-col items-center border-l border-line/60 py-1.5">
      <Tooltip content={`Show terminals (${formatShortcut(TERMINAL_TOGGLE_SHORTCUT)})`}>
        <button
          type="button"
          aria-label="Show terminals"
          data-testid="terminal-show"
          onClick={onShow}
          className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-muted hover:text-brand"
        >
          <SquareTerminal className="h-4 w-4 stroke-[1.5]" />
          {hasUnread && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent" aria-label="New output" />
          )}
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The docked terminals of the split view: which are docked, whether the column is folded, and the
 * ⌘J toggle (which docks the front floating terminal when none is docked yet). Registers the
 * column, so docked terminals leave the floating dock while the split view is on screen.
 */
function useDockedTerminals() {
  const { data } = useTerminals();
  const dockState = useTerminalDockState();
  const terminals = data?.available ? data.terminals : [];
  const docked = terminals.filter((terminal) => isDockedPanel(dockState, terminal.id));
  const isFolded = dockState.isDockMinimized === true;
  useEffect(() => registerDockColumn(), []);
  const frontFloatingId = dockState.order.find(
    (id) => terminals.some((terminal) => terminal.id === id) && !isDockedPanel(dockState, id),
  );
  useEffect(() => {
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (!isCommandShortcut(keyEvent, "j")) return;
      if (docked.length > 0) setDockMinimized(!isFolded);
      else if (frontFloatingId) dockTerminal(frontFloatingId);
      else return;
      keyEvent.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [docked.length, frontFloatingId, isFolded]);
  const hasUnread = docked.some((terminal) => readPanelLayout(dockState, terminal.id).hasUnread);
  return { docked, isFolded, hasUnread };
}

function SplitView() {
  const [defaultLayout] = useState(readSavedLayout);
  const treePanelRef = usePanelRef();
  const terminalPanelRef = usePanelRef();
  const [isTreeHidden, setIsTreeHidden] = useState(() => defaultLayout?.[TREE_PANEL_ID] === 0);
  const toggleTree = useCallback(() => {
    const treePanel = treePanelRef.current;
    if (!treePanel) return;
    if (treePanel.isCollapsed()) treePanel.expand();
    else treePanel.collapse();
  }, [treePanelRef]);
  useTreeToggleShortcut(toggleTree);
  const { docked, isFolded, hasUnread } = useDockedTerminals();
  const hasDocked = docked.length > 0;
  const isTerminalShown = hasDocked && !isFolded;

  // The column follows the dock: unfolded while a docked terminal is shown, folded otherwise.
  useEffect(() => {
    const terminalPanel = terminalPanelRef.current;
    if (!terminalPanel) return;
    if (isTerminalShown && terminalPanel.isCollapsed()) {
      terminalPanel.expand();
      if (terminalPanel.getSize().asPercentage <= 20) terminalPanel.resize(TERMINAL_DEFAULT_SIZE);
    } else if (!isTerminalShown && !terminalPanel.isCollapsed()) {
      terminalPanel.collapse();
    }
  }, [isTerminalShown, terminalPanelRef]);

  return (
    <TreeVisibilityContext.Provider value={{ isTreeHidden, toggleTree }}>
      <div className="flex h-full">
        {isTreeHidden && <ShowTreeRail onShow={toggleTree} />}
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={(layout) => saveLayout(layout)}
          className="h-full min-w-0 flex-1"
          id="explorer-split"
        >
          <Panel
            id={TREE_PANEL_ID}
            panelRef={treePanelRef}
            defaultSize="24%"
            minSize="16%"
            maxSize="45%"
            collapsible
            collapsedSize={0}
            onResize={(panelSize) => setIsTreeHidden(panelSize.asPercentage === 0)}
            className="h-full border-r border-line/60"
            data-testid="tree-panel"
          >
            <TreeColumn />
          </Panel>
          <Separator className="w-1 bg-transparent transition-colors hover:bg-brand/40 data-[separator=active]:bg-brand/60" />
          <Panel id={PANE_PANEL_ID} className="h-full">
            <FilePane />
          </Panel>
          <Separator
            disabled={!hasDocked}
            className={
              hasDocked
                ? "w-1 bg-transparent transition-colors hover:bg-brand/40 data-[separator=active]:bg-brand/60"
                : "w-0"
            }
          />
          <Panel
            id={TERMINAL_PANEL_ID}
            panelRef={terminalPanelRef}
            defaultSize={0}
            minSize="20%"
            maxSize="70%"
            collapsible
            collapsedSize={0}
            disabled={!hasDocked}
            onResize={(panelSize) => {
              // Dragging the divider all the way to the right folds the column, like the tree's.
              if (hasDocked && !isFolded && panelSize.asPercentage === 0) setDockMinimized(true);
            }}
            className="h-full"
            data-testid="terminal-column"
          >
            {hasDocked && <DockedTerminalColumn terminals={docked} isFolded={!isTerminalShown} />}
          </Panel>
        </Group>
        {hasDocked && isFolded && <ShowTerminalRail hasUnread={hasUnread} onShow={() => setDockMinimized(false)} />}
      </div>
    </TreeVisibilityContext.Provider>
  );
}

type StackedViewName = "files" | "pane" | "terminal";

function StackedViewTab({
  view,
  currentView,
  onSelect,
  icon: TabIcon,
  label,
  badge,
}: {
  view: StackedViewName;
  currentView: StackedViewName;
  onSelect: (view: StackedViewName) => void;
  icon: LucideIcon;
  label: string;
  badge?: ReactNode;
}) {
  const isCurrent = view === currentView;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isCurrent}
      onClick={() => onSelect(view)}
      data-testid={`stacked-tab-${view}`}
      className={mergeClassNames(
        "relative flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-foreground-muted transition-colors",
        isCurrent ? "bg-surface-strong font-medium text-brand" : "hover:text-foreground",
      )}
    >
      <TabIcon className="h-4 w-4 flex-none stroke-[1.5]" />
      <span className="truncate">{label}</span>
      {badge}
    </button>
  );
}

/** The Terminal view when no terminal is open yet: open one in the selected folder. */
function NoTerminal() {
  const explorer = useExplorer();
  const terminal = useOpenTerminal();
  const folderPath = explorer.readTargetFolder(explorer.selectedPath);
  return (
    <EmptyState
      className="m-auto p-6"
      title="No terminal open"
      description={terminal.disabledReason ?? "Open one in the selected folder."}
      action={
        <Button
          variant="outline-primary"
          size="small"
          disabled={terminal.disabledReason !== undefined}
          onClick={() => terminal.open(explorer.storage.id, folderPath)}
          leadingIcon={<SquareTerminal className="mr-1.5 h-4 w-4" />}
          data-testid="stacked-open-terminal"
        >
          Open terminal here
        </Button>
      }
    />
  );
}

/**
 * Phones: one view at a time, picked from a switch at the top: the file tree, the file pane
 * (viewer or editor) and the terminals. Opening a file shows it, opening a terminal shows it. Every
 * terminal is docked into the Terminal view, so none floats over the editor; all three stay
 * mounted, keeping the tree's state and the terminals' screens while another view is shown.
 */
function StackedView() {
  const explorer = useExplorer();
  const { selectedPath, historyPath, findEntry } = explorer;
  const [view, setView] = useState<StackedViewName>(() => (selectedPath === "" ? "files" : "pane"));
  const toggleTree = useCallback(() => setView((current) => (current === "files" ? "pane" : "files")), []);
  useTreeToggleShortcut(toggleTree);
  const terminal = useOpenTerminal();
  const { data } = useTerminals();
  const dockState = useTerminalDockState();
  const terminals = useMemo(() => (data?.available ? data.terminals : []), [data]);
  useEffect(() => registerDockColumn(), []);

  // Every terminal goes to the Terminal view; a new one is shown at once.
  const knownTerminalIdsRef = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    for (const openTerminal of terminals) {
      if (!isDockedPanel(dockState, openTerminal.id)) dockTerminal(openTerminal.id);
    }
    const currentIds = new Set(terminals.map((openTerminal) => openTerminal.id));
    const knownIds = knownTerminalIdsRef.current;
    if (data && knownIds && [...currentIds].some((id) => !knownIds.has(id))) setView("terminal");
    if (data) knownTerminalIdsRef.current = currentIds;
  }, [data, dockState, terminals]);

  // Opening a file (or an entry's history) shows the file pane; folders stay in the tree.
  const selectedType = findEntry(selectedPath)?.type;
  const selection = `${selectedPath}|${historyPath ?? ""}`;
  const [shownSelection, setShownSelection] = useState(selection);
  if (selection !== shownSelection) {
    setShownSelection(selection);
    if (selectedType === "file" || historyPath === selectedPath) setView("pane");
  }

  const docked = terminals.filter((openTerminal) => isDockedPanel(dockState, openTerminal.id));
  const hasUnread =
    view !== "terminal" && docked.some((openTerminal) => readPanelLayout(dockState, openTerminal.id).hasUnread);
  const paneLabel = selectedType === "file" ? readBaseName(selectedPath) : "Details";
  const isTerminalOffered = terminal.isOffered || terminals.length > 0;
  return (
    <TreeVisibilityContext.Provider value={{ isTreeHidden: view !== "files", toggleTree }}>
      <div className="flex h-full min-h-0 flex-col" data-testid="stacked-view" data-view={view}>
        <div role="tablist" aria-label="Explorer views" className="flex flex-none gap-1 border-b border-line/60 p-1.5">
          <StackedViewTab view="files" currentView={view} onSelect={setView} icon={FolderTree} label="Files" />
          <StackedViewTab view="pane" currentView={view} onSelect={setView} icon={FileText} label={paneLabel} />
          {isTerminalOffered && (
            <StackedViewTab
              view="terminal"
              currentView={view}
              onSelect={setView}
              icon={SquareTerminal}
              label="Terminal"
              badge={
                hasUnread && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent" aria-label="New output" />
                )
              }
            />
          )}
        </div>
        <div className={mergeClassNames("min-h-0 flex-1", view !== "files" && "hidden")} data-testid="tree-panel">
          <TreeColumn />
        </div>
        <div className={mergeClassNames("min-h-0 flex-1", view !== "pane" && "hidden")}>
          <FilePane />
        </div>
        {isTerminalOffered && (
          <div className={mergeClassNames("flex min-h-0 flex-1 flex-col", view !== "terminal" && "hidden")}>
            {docked.length > 0 ? (
              <DockedTerminalColumn terminals={docked} isFolded={view !== "terminal"} isFullWidth />
            ) : (
              <NoTerminal />
            )}
          </div>
        )}
      </div>
    </TreeVisibilityContext.Provider>
  );
}

/**
 * The storage page, or a memory's own explorer when `memoryRoot` is given (its tree starts at the
 * memory folder, under a header with the memory's name): the file tree and the file pane side by side, with a resizable split
 * (tree 24% by default, 16–45%) remembered in `localStorage` under `cmm.split`. The tree can be
 * hidden to give the file pane the whole width (its toolbar button, dragging the split to the
 * left, or ⌘\); a slim rail brings it back. Docked terminals get a third column on the right
 * (resizable, folded to a rail with ⌘J or by dragging the divider). Narrow screens show one at a
 * time (Files, the file pane, Terminal) with a switch at the top. The URL path is the selected entry.
 *
 * @example
 * <ExplorerWorkspace storage={storage} mode="server" initialPath="notes" />
 */
export function ExplorerWorkspace({
  storage,
  memoryRoot,
  mode,
  userRole,
  initialPath,
  initialChanges,
}: {
  storage: StorageSummary;
  memoryRoot?: MemoryRoot;
  mode: ApplicationMode;
  userRole: UserRole;
  initialPath: string;
  /** `?changes=`: open the entry's "What changed" history on this step. */
  initialChanges?: string;
}) {
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const isNarrow = useMediaQuery("(max-width: 767px)");
  return (
    <ExplorerProvider
      storage={storage}
      memoryRoot={memoryRoot}
      mode={mode}
      userRole={userRole}
      initialPath={initialPath}
      initialChanges={initialChanges}
    >
      <h1 className="sr-only">{memoryRoot?.memory.name ?? storage.label}</h1>
      <div
        className="box h-[calc(100dvh-12rem)] min-h-[420px] overflow-hidden md:h-[calc(100dvh-9rem)]"
        data-testid="explorer"
        data-full-width
      >
        {isClient ? isNarrow ? <StackedView /> : <SplitView /> : null}
      </div>
      <ExplorerContextMenu />
      <ExplorerDialogs />
    </ExplorerProvider>
  );
}
