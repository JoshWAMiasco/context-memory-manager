"use client";

import type { ComponentType } from "react";
import { FilePlus, FolderPlus, ListCollapse, PanelLeftClose, RefreshCw, Upload } from "lucide-react";
import { Tooltip } from "@/components/interactive/tooltip";
import { BrainIcon } from "@/components/icons/cmm-icons";
import { useExplorer } from "@/components/explorer/explorer-context";
import { TREE_TOGGLE_SHORTCUT, useTreeVisibility } from "@/components/explorer/tree-visibility";
import { formatShortcut } from "@/lib/client/shortcuts";

function ToolbarButton({
  label,
  icon: ButtonIcon,
  onClick,
  disabledReason,
  testId,
}: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  disabledReason?: string;
  testId?: string;
}) {
  return (
    <Tooltip content={disabledReason ?? label}>
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabledReason !== undefined}
        data-testid={testId}
        onClick={() => !disabledReason && onClick()}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-muted hover:text-brand aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-foreground-muted"
      >
        <ButtonIcon className="h-4 w-4 stroke-[1.5]" />
      </button>
    </Tooltip>
  );
}

/**
 * The buttons above the file tree: new file, new folder, new memory, upload,
 * refresh, collapse all and hide the tree. New items and uploads go into the selected folder.
 *
 * @example
 * <TreeToolbar />
 */
export function TreeToolbar() {
  const explorer = useExplorer();
  const { toggleTree } = useTreeVisibility();
  const writeReason = explorer.readWriteReason(explorer.readTargetFolder());
  return (
    <div
      className="flex items-center gap-0.5 border-b border-line/60 px-2 py-1.5"
      role="toolbar"
      aria-label="File actions"
    >
      <ToolbarButton
        label="New file"
        icon={FilePlus}
        testId="toolbar-new-file"
        disabledReason={writeReason}
        onClick={() => explorer.startDraft("file")}
      />
      <ToolbarButton
        label="New folder"
        icon={FolderPlus}
        testId="toolbar-new-folder"
        disabledReason={writeReason}
        onClick={() => explorer.startDraft("directory")}
      />
      <ToolbarButton
        label="New memory"
        icon={BrainIcon}
        testId="toolbar-new-memory"
        disabledReason={writeReason}
        onClick={() => explorer.openDialog({ kind: "new-memory", parentPath: explorer.readTargetFolder() })}
      />
      <ToolbarButton
        label="Upload files"
        icon={Upload}
        testId="toolbar-upload"
        disabledReason={writeReason}
        onClick={() => explorer.openUploadPicker(explorer.readTargetFolder())}
      />
      <span className="ml-auto" />
      <ToolbarButton
        label="Refresh"
        icon={RefreshCw}
        testId="toolbar-refresh"
        onClick={() => void explorer.refresh()}
      />
      <ToolbarButton
        label="Collapse all"
        icon={ListCollapse}
        testId="toolbar-collapse"
        onClick={explorer.collapseAll}
      />
      <ToolbarButton
        label={`Hide file tree (${formatShortcut(TREE_TOGGLE_SHORTCUT)})`}
        icon={PanelLeftClose}
        testId="tree-hide"
        onClick={toggleTree}
      />
    </div>
  );
}
