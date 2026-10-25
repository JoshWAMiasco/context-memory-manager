"use client";

import { CodeMirrorView } from "@/components/editor/code-mirror-view";
import { CodeToolbar } from "@/components/editor/code-toolbar";
import { useWordWrap } from "@/hooks/use-word-wrap";
import type { LineEnding } from "@/lib/api-types";

/**
 * The code and text editor: CodeMirror with line numbers, active line, bracket matching
 * and auto-close, history, search and replace, the file's own indentation, word wrap, and
 * Cmd/Ctrl+S to save. Also edits CSV as text and Markdown in Source mode.
 *
 * @example
 * <CodeEditor content={draft} onChange={setDraft} onSave={save} language="typescript" fileName="app.ts" lineEnding="crlf" />
 */
export function CodeEditor({
  content,
  onChange,
  onSave,
  language,
  fileName,
  lineEnding,
}: {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  language?: string;
  fileName: string;
  lineEnding?: LineEnding;
}) {
  const [isWrapped, toggleWrapped] = useWordWrap();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CodeToolbar language={language} lineEnding={lineEnding} isWrapped={isWrapped} onToggleWrap={toggleWrapped} />
      <CodeMirrorView
        value={content}
        language={language}
        fileName={fileName}
        isWrapped={isWrapped}
        onChange={onChange}
        onSave={onSave}
        ariaLabel={`Editing ${fileName}`}
        testId="code-editor"
        className="flex-1"
      />
    </div>
  );
}
