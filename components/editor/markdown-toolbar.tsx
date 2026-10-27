"use client";

import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Braces,
  Code,
  FileCode,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
import { FormInput } from "@/components/primitives/form-input";
import { useClickOutside } from "@/hooks/use-click-outside";
import { formatShortcut } from "@/lib/client/shortcuts";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type MarkdownEditorMode = "rich" | "source";

interface ToolbarAction {
  key: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  run: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  isEnabled?: (editor: Editor) => boolean;
}

const ACTION_GROUPS: ToolbarAction[][] = [
  [
    {
      key: "undo",
      label: "Undo",
      icon: Undo2,
      shortcut: "Mod-Z",
      run: (editor) => editor.chain().focus().undo().run(),
      isEnabled: (editor) => editor.can().undo(),
    },
    {
      key: "redo",
      label: "Redo",
      icon: Redo2,
      shortcut: "Mod-Shift-Z",
      run: (editor) => editor.chain().focus().redo().run(),
      isEnabled: (editor) => editor.can().redo(),
    },
  ],
  [
    {
      key: "paragraph",
      label: "Paragraph",
      icon: Pilcrow,
      shortcut: "Mod-Alt-0",
      run: (editor) => editor.chain().focus().setParagraph().run(),
      isActive: (editor) => editor.isActive("paragraph"),
    },
    ...([1, 2, 3] as const).map((level): ToolbarAction => ({
      key: `heading-${level}`,
      label: `Heading ${level}`,
      icon: [Heading1, Heading2, Heading3][level - 1] ?? Heading1,
      shortcut: `Mod-Alt-${level}`,
      run: (editor) => editor.chain().focus().toggleHeading({ level }).run(),
      isActive: (editor) => editor.isActive("heading", { level }),
    })),
  ],
  [
    {
      key: "bold",
      label: "Bold",
      icon: Bold,
      shortcut: "Mod-B",
      run: (editor) => editor.chain().focus().toggleBold().run(),
      isActive: (editor) => editor.isActive("bold"),
    },
    {
      key: "italic",
      label: "Italic",
      icon: Italic,
      shortcut: "Mod-I",
      run: (editor) => editor.chain().focus().toggleItalic().run(),
      isActive: (editor) => editor.isActive("italic"),
    },
    {
      key: "strike",
      label: "Strikethrough",
      icon: Strikethrough,
      shortcut: "Mod-Shift-S",
      run: (editor) => editor.chain().focus().toggleStrike().run(),
      isActive: (editor) => editor.isActive("strike"),
    },
    {
      key: "code",
      label: "Inline code",
      icon: Code,
      shortcut: "Mod-E",
      run: (editor) => editor.chain().focus().toggleCode().run(),
      isActive: (editor) => editor.isActive("code"),
    },
  ],
  [
    {
      key: "bullet-list",
      label: "Bullet list",
      icon: List,
      shortcut: "Mod-Shift-8",
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
      isActive: (editor) => editor.isActive("bulletList"),
    },
    {
      key: "ordered-list",
      label: "Numbered list",
      icon: ListOrdered,
      shortcut: "Mod-Shift-7",
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
      isActive: (editor) => editor.isActive("orderedList"),
    },
    {
      key: "task-list",
      label: "Task list",
      icon: ListChecks,
      shortcut: "Mod-Shift-9",
      run: (editor) => editor.chain().focus().toggleTaskList().run(),
      isActive: (editor) => editor.isActive("taskList"),
    },
  ],
  [
    {
      key: "blockquote",
      label: "Block quote",
      icon: Quote,
      shortcut: "Mod-Shift-B",
      run: (editor) => editor.chain().focus().toggleBlockquote().run(),
      isActive: (editor) => editor.isActive("blockquote"),
    },
    {
      key: "code-block",
      label: "Code block",
      icon: Braces,
      shortcut: "Mod-Alt-C",
      run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      isActive: (editor) => editor.isActive("codeBlock"),
    },
    {
      key: "horizontal-rule",
      label: "Horizontal rule",
      icon: Minus,
      run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
  ],
];

const ALL_ACTIONS = ACTION_GROUPS.flat();

const CODE_BLOCK_LANGUAGES = [
  "",
  "bash",
  "c",
  "cpp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "toml",
  "typescript",
  "xml",
  "yaml",
];

interface TableAction {
  label: string;
  run: (editor: Editor) => boolean;
  canRun: (editor: Editor) => boolean;
  tone?: "danger";
}

const TABLE_ACTIONS: (TableAction | "divider")[] = [
  {
    label: "Add row above",
    run: (editor) => editor.chain().focus().addRowBefore().run(),
    canRun: (editor) => editor.can().addRowBefore(),
  },
  {
    label: "Add row below",
    run: (editor) => editor.chain().focus().addRowAfter().run(),
    canRun: (editor) => editor.can().addRowAfter(),
  },
  {
    label: "Add column left",
    run: (editor) => editor.chain().focus().addColumnBefore().run(),
    canRun: (editor) => editor.can().addColumnBefore(),
  },
  {
    label: "Add column right",
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
    canRun: (editor) => editor.can().addColumnAfter(),
  },
  "divider",
  {
    label: "Toggle header row",
    run: (editor) => editor.chain().focus().toggleHeaderRow().run(),
    canRun: (editor) => editor.can().toggleHeaderRow(),
  },
  "divider",
  {
    label: "Delete row",
    run: (editor) => editor.chain().focus().deleteRow().run(),
    canRun: (editor) => editor.can().deleteRow(),
    tone: "danger",
  },
  {
    label: "Delete column",
    run: (editor) => editor.chain().focus().deleteColumn().run(),
    canRun: (editor) => editor.can().deleteColumn(),
    tone: "danger",
  },
  {
    label: "Delete table",
    run: (editor) => editor.chain().focus().deleteTable().run(),
    canRun: (editor) => editor.can().deleteTable(),
    tone: "danger",
  },
];

function ToolbarButton({
  label,
  shortcut,
  icon: ActionIcon,
  isActive = false,
  isDisabled = false,
  onClick,
  testId,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  isActive?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Tooltip content={shortcut ? `${label} (${formatShortcut(shortcut)})` : label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={isActive}
        disabled={isDisabled}
        data-testid={testId}
        onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
        onClick={onClick}
        className={mergeClassNames(
          "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35",
          isActive && "bg-surface-strong text-brand",
        )}
      >
        <ActionIcon className="h-4 w-4 stroke-[1.6]" />
      </button>
    </Tooltip>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line-strong/70" aria-hidden />;
}

const TABLE_MENU_WIDTH = 208;

/**
 * The table menu. A plain popover rather than the shared dropdown menu: that one hands focus
 * back to its button when it closes, which would take the caret out of the table just inserted.
 */
function TableMenu({ editor, isInTable }: { editor: Editor; isInTable: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  /* Fixed, under the button: the toolbar row scrolls sideways on phones and would clip it. */
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    const buttonBox = buttonRef.current?.getBoundingClientRect();
    if (!isOpen && buttonBox) {
      setMenuPosition({
        top: buttonBox.bottom + 4,
        left: Math.max(8, Math.min(buttonBox.left, window.innerWidth - TABLE_MENU_WIDTH - 8)),
      });
    }
    setIsOpen(!isOpen);
  };
  const close = useCallback(() => setIsOpen(false), []);
  useClickOutside(menuRef, close);
  const items: (TableAction | "divider")[] = [
    {
      label: "Insert 3 × 3 table",
      run: (currentEditor) =>
        currentEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      canRun: () => true,
    },
    "divider",
    ...TABLE_ACTIONS,
  ];
  return (
    <div ref={menuRef} className="relative">
      <Tooltip content="Table">
        <button
          ref={buttonRef}
          type="button"
          aria-label="Table"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-testid="toolbar-table"
          onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={toggle}
          className={mergeClassNames(
            "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-strong hover:text-foreground",
            (isOpen || isInTable) && "bg-surface-strong text-brand",
          )}
        >
          <Table2 className="h-4 w-4 stroke-[1.6]" />
        </button>
      </Tooltip>
      {isOpen && (
        <div
          role="menu"
          aria-label="Table"
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === "Escape") close();
          }}
          style={{ top: menuPosition.top, left: menuPosition.left, width: TABLE_MENU_WIDTH }}
          className="fixed z-30 rounded-md border border-line-strong bg-surface-muted p-1.5 shadow-overlay"
        >
          {items.map((item, itemIndex) =>
            item === "divider" ? (
              <div key={`divider-${itemIndex}`} className="my-1.5 h-px bg-surface-strong/60" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.label !== "Insert 3 × 3 table" && (!isInTable || !item.canRun(editor))}
                onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
                onClick={() => {
                  item.run(editor);
                  close();
                }}
                className={mergeClassNames(
                  "flex w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-strong/60 disabled:cursor-not-allowed disabled:opacity-40",
                  item.tone === "danger" && "text-danger",
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const currentHref =
    typeof editor.getAttributes("link").href === "string" ? (editor.getAttributes("link").href as string) : "";
  const [address, setAddress] = useState(currentHref);
  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (address.trim() === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: address.trim() }).run();
    onClose();
  };
  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2 border-t border-line/60 px-3 py-2"
      data-testid="link-form"
    >
      <label htmlFor="markdown-link-address" className="text-xs text-foreground-muted">
        Link
      </label>
      <FormInput
        id="markdown-link-address"
        value={address}
        autoFocus
        placeholder="https://… or other-note.md"
        onChange={(changeEvent) => setAddress(changeEvent.target.value)}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === "Escape") onClose();
        }}
        className="h-8 max-w-sm flex-1 text-sm"
      />
      <Button type="submit" variant="outline-primary" size="small">
        {currentHref ? "Update" : "Add"}
      </Button>
      {currentHref && (
        <Button
          variant="outline-danger"
          size="small"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          Remove
        </Button>
      )}
      <Button variant="outline-secondary" size="small" onClick={onClose}>
        Cancel
      </Button>
    </form>
  );
}

/** What the toolbar shows for the current selection: active and enabled actions, link, table and code block. */
function readToolbarState(currentEditor: Editor) {
  return {
    active: Object.fromEntries(ALL_ACTIONS.map((action) => [action.key, action.isActive?.(currentEditor) ?? false])),
    enabled: Object.fromEntries(ALL_ACTIONS.map((action) => [action.key, action.isEnabled?.(currentEditor) ?? true])),
    isLink: currentEditor.isActive("link"),
    isInTable: currentEditor.isActive("table"),
    codeBlockLanguage: currentEditor.isActive("codeBlock")
      ? String(currentEditor.getAttributes("codeBlock").language ?? "")
      : undefined,
  };
}

/**
 * The Markdown editor's toolbar: history, block types, inline marks, lists, quote, code
 * block with a language, rule, link, table operations, and the Rich/Source switch. Buttons show
 * their shortcut in the tooltip and reflect the current selection. On phones the buttons are one row
 * that scrolls sideways, with the Rich/Source switch (icons only) kept in view at its end.
 *
 * @example
 * <MarkdownToolbar editor={editor} mode="rich" onModeChange={switchMode} />
 */
export function MarkdownToolbar({
  editor,
  mode,
  onModeChange,
}: {
  editor: Editor | null;
  mode: MarkdownEditorMode;
  onModeChange: (mode: MarkdownEditorMode) => void;
}) {
  const [isLinkFormOpen, setIsLinkFormOpen] = useState(false);
  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => (currentEditor ? readToolbarState(currentEditor) : undefined),
  });
  /* Until the editor's first transaction the hook has no state yet: read it directly, so the buttons show at once. */
  const toolbarState = editorState ?? (editor ? readToolbarState(editor) : undefined);
  const isRich = mode === "rich" && editor !== null && toolbarState !== undefined;

  return (
    <div className="sticky top-0 z-10 border-b border-line/60 bg-surface-subtle" data-testid="markdown-toolbar">
      <div className="flex items-center gap-1 px-2 py-1">
        <div
          role="toolbar"
          aria-label="Formatting"
          className="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto md:flex-wrap md:overflow-visible"
        >
          {isRich &&
            ACTION_GROUPS.map((actionGroup, groupIndex) => (
              <div key={actionGroup[0]?.key} className="flex flex-none items-center gap-0.5">
                {groupIndex > 0 && <Divider />}
                {actionGroup.map((action) => (
                  <ToolbarButton
                    key={action.key}
                    label={action.label}
                    shortcut={action.shortcut}
                    icon={action.icon}
                    isActive={toolbarState.active[action.key]}
                    isDisabled={!toolbarState.enabled[action.key]}
                    onClick={() => action.run(editor)}
                    testId={`toolbar-${action.key}`}
                  />
                ))}
              </div>
            ))}
          {isRich && toolbarState.codeBlockLanguage !== undefined && (
            <select
              aria-label="Code block language"
              value={toolbarState.codeBlockLanguage}
              onChange={(changeEvent) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes("codeBlock", { language: changeEvent.target.value || null })
                  .run()
              }
              className="ml-1 h-7 flex-none rounded-md border-line-strong bg-field py-0 pr-7 pl-2 text-xs"
            >
              {CODE_BLOCK_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {language || "Plain text"}
                </option>
              ))}
            </select>
          )}
          {isRich && (
            <>
              <Divider />
              <ToolbarButton
                label="Link"
                icon={Link2}
                isActive={toolbarState.isLink || isLinkFormOpen}
                onClick={() => setIsLinkFormOpen(!isLinkFormOpen)}
                testId="toolbar-link"
              />
              <TableMenu editor={editor} isInTable={toolbarState.isInTable} />
            </>
          )}
        </div>
        <div
          className="ml-auto flex flex-none items-center rounded-md border border-line-strong p-0.5"
          role="group"
          aria-label="Editor mode"
        >
          {(
            [
              ["rich", "Rich", Type],
              ["source", "Source", FileCode],
            ] as const
          ).map(([modeValue, modeLabel, ModeIcon]) => (
            <button
              key={modeValue}
              type="button"
              aria-label={modeLabel}
              title={modeLabel}
              aria-pressed={mode === modeValue}
              data-testid={`mode-${modeValue}`}
              onClick={() => onModeChange(modeValue)}
              className={mergeClassNames(
                "flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-xs text-foreground-muted hover:text-foreground",
                mode === modeValue && "bg-surface-strong text-brand",
              )}
            >
              <ModeIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{modeLabel}</span>
            </button>
          ))}
        </div>
      </div>
      {isRich && isLinkFormOpen && <LinkForm editor={editor} onClose={() => setIsLinkFormOpen(false)} />}
    </div>
  );
}
