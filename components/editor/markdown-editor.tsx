"use client";

import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/button";
import { CodeEditor } from "@/components/editor/code-editor";
import { MarkdownToolbar, type MarkdownEditorMode } from "@/components/editor/markdown-toolbar";
import { FrontmatterCard } from "@/components/viewer/markdown-viewer";
import type { LineEnding } from "@/lib/api-types";
import { buildRawUrl } from "@/lib/client/fs";
import {
  createMarkdownConverter,
  createMarkdownExtensions,
  normalizeSerializedMarkdown,
} from "@/lib/editor/markdown-document";
import { FIDELITY_RISK_LABELS, findFidelityRisks, splitFrontmatter } from "@/lib/editor/markdown-fidelity";
import { resolveMarkdownImage } from "@/lib/fs/resolve-link";

interface RichBaseline {
  /** The document as parsed from `text`; while the editor's document equals it, the text is unchanged. */
  document?: ProseMirrorNode;
  text: string;
  frontmatter: string;
  endsWithNewline: boolean;
}

function createBaseline(text: string): RichBaseline {
  return { text, frontmatter: splitFrontmatter(text).frontmatter, endsWithNewline: text.endsWith("\n") };
}

function describeRisks(markdown: string): string {
  return findFidelityRisks(markdown)
    .map((risk) => FIDELITY_RISK_LABELS[risk])
    .join(", ");
}

/**
 * The Markdown editor: a TipTap rich editor that reads and writes Markdown, and a Source
 * mode in CodeMirror. Frontmatter is kept aside and re-attached unchanged. Files with HTML,
 * comments, footnotes, reference links or math open in Source mode with a banner, because the rich
 * editor would rewrite them; switching to Rich stays possible. Undoing back to the opened text
 * leaves the file unchanged byte for byte.
 *
 * @example
 * <MarkdownEditor content={draft} onChange={setDraft} onSave={save} storageId={storageId} filePath="notes/today.md" lineEnding="lf" />
 */
export function MarkdownEditor({
  content,
  onChange,
  onSave,
  storageId,
  filePath,
  lineEnding,
}: {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  storageId: string;
  filePath: string;
  lineEnding: LineEnding;
}) {
  const fileName = filePath.slice(filePath.lastIndexOf("/") + 1);
  const [openedInSourceBecause] = useState(() => describeRisks(content));
  const [mode, setMode] = useState<MarkdownEditorMode>(openedInSourceBecause ? "source" : "rich");
  const [isRiskBannerShown, setIsRiskBannerShown] = useState(openedInSourceBecause !== "");
  const [richModeRisks, setRichModeRisks] = useState("");
  const baselineRef = useRef<RichBaseline>(createBaseline(content));
  const lastEmittedRef = useRef(content);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const resolveImageSource = useCallback(
    (source: string) => {
      const imageSource = resolveMarkdownImage(filePath, source);
      if (imageSource.kind === "blocked") return undefined;
      return imageSource.kind === "inline" ? imageSource.source : buildRawUrl(storageId, imageSource.path);
    },
    [filePath, storageId],
  );

  const [markdownConverter] = useState(createMarkdownConverter);
  const [initialDocument] = useState(() => markdownConverter.parse(splitFrontmatter(content).body));
  const editor = useEditor({
    extensions: [...createMarkdownExtensions({ resolveImageSource, placeholder: "Start writing…" }), Markdown],
    content: initialDocument,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "markdown-body markdown-editor-content mx-auto max-w-4xl",
        "aria-label": `Editing ${fileName}`,
        "data-testid": "markdown-rich-editor",
      },
    },
    onCreate: ({ editor: createdEditor }) => {
      baselineRef.current = { ...baselineRef.current, document: createdEditor.state.doc };
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const baseline = baselineRef.current;
      const nextText =
        baseline.document && updatedEditor.state.doc.eq(baseline.document)
          ? baseline.text
          : baseline.frontmatter +
            normalizeSerializedMarkdown(updatedEditor.getMarkdown(), { endsWithNewline: baseline.endsWithNewline });
      lastEmittedRef.current = nextText;
      onChangeRef.current(nextText);
    },
  });

  const loadIntoRichEditor = useCallback(
    (text: string) => {
      if (!editor) return;
      const baseline = createBaseline(text);
      editor.commands.setContent(markdownConverter.parse(splitFrontmatter(text).body), { emitUpdate: false });
      baselineRef.current = { ...baseline, document: editor.state.doc };
    },
    [editor, markdownConverter],
  );

  useEffect(() => {
    if (content === lastEmittedRef.current) return;
    lastEmittedRef.current = content;
    if (mode === "rich") loadIntoRichEditor(content);
  }, [content, loadIntoRichEditor, mode]);

  const frontmatterYaml = splitFrontmatter(content).yaml;

  const switchMode = (nextMode: MarkdownEditorMode) => {
    if (nextMode === mode) return;
    if (nextMode === "rich") {
      loadIntoRichEditor(content);
      setRichModeRisks(describeRisks(content));
    }
    setMode(nextMode);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="markdown-editor" data-mode={mode}>
      <MarkdownToolbar editor={editor} mode={mode} onModeChange={switchMode} />
      {mode === "source" && isRiskBannerShown && (
        <div
          role="status"
          data-testid="source-mode-banner"
          className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
        >
          <TriangleAlert className="h-4 w-4 flex-none text-warning" aria-hidden />
          <span className="flex-1">
            Opened in source mode to preserve formatting. This file uses {openedInSourceBecause}, which the rich editor
            would change.
          </span>
          <Button variant="outline-secondary" size="small" onClick={() => switchMode("rich")}>
            Use rich mode anyway
          </Button>
          <Button variant="outline-secondary" size="small" onClick={() => setIsRiskBannerShown(false)}>
            Dismiss
          </Button>
        </div>
      )}
      {mode === "rich" && richModeRisks && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs">
          <TriangleAlert className="h-3.5 w-3.5 flex-none text-warning" aria-hidden />
          Saving from rich mode may change this file&rsquo;s {richModeRisks}.
        </div>
      )}
      {mode === "rich" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {frontmatterYaml && (
            <div className="mx-auto max-w-4xl px-6 pt-5">
              <FrontmatterCard yaml={frontmatterYaml} />
            </div>
          )}
          <EditorContent editor={editor} className="h-full" />
        </div>
      ) : (
        <CodeEditor
          content={content}
          onChange={(text) => {
            lastEmittedRef.current = text;
            onChange(text);
          }}
          onSave={onSave}
          language="markdown"
          fileName={fileName}
          lineEnding={lineEnding}
        />
      )}
    </div>
  );
}
