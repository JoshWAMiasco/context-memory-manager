"use client";

import { ChevronRight, LoaderCircle } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { FileIcon } from "@/components/explorer/file-icon";
import { ItemBadges } from "@/components/explorer/item-badges";
import type { FileEntry } from "@/lib/api-types";
import { findNameProblem } from "@/lib/fs/validate-name";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** Height of a tree row in pixels; the virtualised list relies on it. */
export const TREE_ROW_HEIGHT = 26;
/** Indent per tree level in pixels. */
export const TREE_INDENT = 14;

/**
 * A text field for naming an entry in place (inline rename, new file or folder). Enter or leaving
 * the field saves; Escape cancels. The name is checked against the same rules as the server's
 * path jail before anything is sent.
 *
 * @example
 * <InlineNameInput initialName="notes.md" onCommit={rename} onCancel={stopRename} />
 */
export function InlineNameInput({
  initialName,
  onCommit,
  onCancel,
  label,
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  label: string;
}) {
  const [name, setName] = useState(initialName);
  const [isDone, setIsDone] = useState(false);
  const nameProblem = name === "" ? undefined : findNameProblem(name);

  const finish = (shouldCommit: boolean) => {
    if (isDone) return;
    setIsDone(true);
    const trimmedName = name.trim();
    if (shouldCommit && trimmedName !== "" && !findNameProblem(trimmedName)) onCommit(trimmedName);
    else onCancel();
  };

  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLInputElement>) => {
    keyboardEvent.stopPropagation();
    if (keyboardEvent.key === "Enter") {
      keyboardEvent.preventDefault();
      if (!nameProblem) finish(true);
    }
    if (keyboardEvent.key === "Escape") {
      keyboardEvent.preventDefault();
      finish(false);
    }
  };

  return (
    <span className="relative min-w-0 flex-1">
      <input
        aria-label={label}
        aria-invalid={nameProblem !== undefined}
        value={name}
        autoFocus
        spellCheck={false}
        onFocus={(focusEvent) => {
          const dotIndex = initialName.lastIndexOf(".");
          focusEvent.currentTarget.setSelectionRange(0, dotIndex > 0 ? dotIndex : initialName.length);
        }}
        onChange={(changeEvent) => setName(changeEvent.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => finish(!nameProblem)}
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        className={mergeClassNames(
          "h-[22px] w-full rounded-sm border bg-field px-1.5 text-sm text-foreground outline-none",
          nameProblem ? "border-danger" : "border-brand",
        )}
        data-testid="inline-name-input"
      />
      {nameProblem && (
        <span
          role="alert"
          className="absolute top-full left-0 z-10 mt-1 rounded-sm bg-danger px-2 py-1 text-xs whitespace-nowrap text-on-primary"
        >
          {nameProblem}
        </span>
      )}
    </span>
  );
}

export interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  rowId: string;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isDropTarget: boolean;
  isRenaming: boolean;
  isCut: boolean;
  /** A running move keeps this entry's folder busy: it can't be opened, dragged or dropped on. */
  isBusy?: boolean;
  onClick: (mouseEvent: MouseEvent<HTMLDivElement>) => void;
  onToggle: () => void;
  onContextMenu: (mouseEvent: MouseEvent<HTMLDivElement>) => void;
  onDragStart: (dragEvent: DragEvent<HTMLDivElement>) => void;
  onDragOver: (dragEvent: DragEvent<HTMLDivElement>) => void;
  onDrop: (dragEvent: DragEvent<HTMLDivElement>) => void;
  onRenameCommit: (newName: string) => void;
  onRenameCancel: () => void;
}

/**
 * One tree row: chevron for folders, vscode or memory icon, the name (or an inline
 * rename field) and the entry's badges.
 *
 * @example
 * <FileTreeNode entry={entry} depth={1} … />
 */
export function FileTreeNode({
  entry,
  depth,
  rowId,
  isExpanded,
  isSelected,
  isFocused,
  isDropTarget,
  isRenaming,
  isCut,
  isBusy = false,
  onClick,
  onToggle,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onRenameCommit,
  onRenameCancel,
}: FileTreeNodeProps) {
  const isDirectory = entry.type === "directory";
  return (
    <div
      id={rowId}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-selected={isSelected}
      aria-disabled={isBusy || undefined}
      aria-busy={isBusy || undefined}
      title={isBusy ? "Files are being moved here. Wait for the move to finish." : undefined}
      draggable={!isRenaming && !isBusy}
      data-testid={`tree-row-${entry.path}`}
      data-path={entry.path}
      onClick={onClick}
      onDoubleClick={() => isDirectory && onToggle()}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ height: TREE_ROW_HEIGHT, paddingLeft: 6 + depth * TREE_INDENT }}
      className={mergeClassNames(
        "flex cursor-pointer items-center gap-1.5 pr-2 text-sm whitespace-nowrap select-none",
        isSelected ? "bg-brand/15 text-foreground-strong" : "text-foreground hover:bg-surface-muted",
        isFocused && "outline outline-1 -outline-offset-1 outline-brand/70",
        isDropTarget && "bg-brand/25 outline outline-1 -outline-offset-1 outline-brand",
        isCut && "opacity-50",
        isBusy && "cursor-progress opacity-60",
      )}
    >
      {isDirectory ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            onToggle();
          }}
          className="flex h-4 w-4 flex-none cursor-pointer items-center justify-center text-foreground-subtle hover:text-foreground"
        >
          <ChevronRight className={mergeClassNames("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")} />
        </button>
      ) : (
        <span className="w-4 flex-none" />
      )}
      <FileIcon entry={entry} isOpen={isExpanded} />
      {isRenaming ? (
        <InlineNameInput
          initialName={entry.name}
          label={`New name for ${entry.name}`}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate" data-testid="tree-row-name">
          {entry.badges.memory && entry.badges.memory.name !== entry.name ? (
            <>
              {entry.badges.memory.name}
              <span className="ml-1.5 text-foreground-faint">{entry.name}</span>
            </>
          ) : (
            entry.name
          )}
        </span>
      )}
      {isBusy && (
        <LoaderCircle
          className="h-3.5 w-3.5 flex-none animate-spin text-brand motion-reduce:animate-none"
          aria-label="Moving"
          data-testid="tree-row-busy"
        />
      )}
      <ItemBadges badges={entry.badges} path={entry.path} />
    </div>
  );
}
