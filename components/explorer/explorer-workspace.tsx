"use client";

import Link from "next/link";
import { FolderTree, HardDrive, PanelLeftOpen, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Group, Panel, Separator, usePanelRef, type Layout } from "react-resizable-panels";
import { Slideover } from "@/components/interactive/slideover";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
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
import { FilePane } from "@/components/viewer/file-pane";
import type { UserRole } from "@/lib/auth/policy";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { StorageSummary } from "@/lib/api-types";
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

function StackedView() {
  const [isTreeOpen, setIsTreeOpen] = useState(false);
  const toggleTree = useCallback(() => setIsTreeOpen((wasOpen) => !wasOpen), []);
  useTreeToggleShortcut(toggleTree);
  return (
    <TreeVisibilityContext.Provider value={{ isTreeHidden: !isTreeOpen, toggleTree }}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-line/60 p-2">
          <Button
            variant="outline-secondary"
            size="small"
            onClick={() => setIsTreeOpen(true)}
            leadingIcon={<FolderTree className="mr-1.5 h-4 w-4" />}
          >
            Files
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <FilePane />
        </div>
        <Slideover
          isOpen={isTreeOpen}
          onOpenChange={setIsTreeOpen}
          side="left"
          title="Files"
          size="small"
          panelClassName="h-full"
        >
          <div className="h-[calc(100dvh-4rem)]">
            <TreeColumn />
          </div>
        </Slideover>
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
 * (resizable, folded to a rail with ⌘J or by dragging the divider). Narrow screens stack them, with
 * the tree in a "Files" drawer and terminals floating. The URL path is the selected entry.
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
      <div className="box h-[calc(100dvh-9rem)] min-h-[420px] overflow-hidden" data-testid="explorer" data-full-width>
        {isClient ? isNarrow ? <StackedView /> : <SplitView /> : null}
      </div>
      <ExplorerContextMenu />
      <ExplorerDialogs />
    </ExplorerProvider>
  );
}
