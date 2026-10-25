"use client";

import Link from "next/link";
import { FolderTree, HardDrive, PanelLeftOpen } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
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
import { FilePane } from "@/components/viewer/file-pane";
import type { UserRole } from "@/lib/auth/policy";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { StorageSummary } from "@/lib/api-types";
import { buildStorageHref } from "@/lib/client/routes";
import { formatShortcut } from "@/lib/client/shortcuts";

/** `localStorage` key of the tree/pane split. */
export const SPLIT_STORAGE_KEY = "cmm.split";

const TREE_PANEL_ID = "tree";
const PANE_PANEL_ID = "pane";

function readSavedLayout(): Layout | undefined {
  try {
    const savedText = window.localStorage.getItem(SPLIT_STORAGE_KEY);
    if (!savedText) return undefined;
    const savedLayout = JSON.parse(savedText) as Layout;
    const treeSize = savedLayout[TREE_PANEL_ID];
    const isUsable = typeof treeSize === "number" && (treeSize === 0 || (treeSize >= 16 && treeSize <= 45));
    return isUsable ? savedLayout : undefined;
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

function SplitView() {
  const [defaultLayout] = useState(readSavedLayout);
  const treePanelRef = usePanelRef();
  const [isTreeHidden, setIsTreeHidden] = useState(() => defaultLayout?.[TREE_PANEL_ID] === 0);
  const toggleTree = useCallback(() => {
    const treePanel = treePanelRef.current;
    if (!treePanel) return;
    if (treePanel.isCollapsed()) treePanel.expand();
    else treePanel.collapse();
  }, [treePanelRef]);
  useTreeToggleShortcut(toggleTree);
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
        </Group>
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
 * left, or ⌘\); a slim rail brings it back. Narrow screens stack them, with the tree in a "Files"
 * drawer. The URL path is the selected entry.
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
}: {
  storage: StorageSummary;
  memoryRoot?: MemoryRoot;
  mode: ApplicationMode;
  userRole: UserRole;
  initialPath: string;
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
