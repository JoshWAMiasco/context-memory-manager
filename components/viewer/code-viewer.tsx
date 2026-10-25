"use client";

import { CodeMirrorView } from "@/components/editor/code-mirror-view";
import { CodeToolbar } from "@/components/editor/code-toolbar";
import { useWordWrap } from "@/hooks/use-word-wrap";
import type { LineEnding } from "@/lib/api-types";

/**
 * Read-only code and text: CodeMirror with line numbers, folding, highlighting, search
 * (Cmd/Ctrl+F) and a word-wrap toggle.
 *
 * @example
 * <CodeViewer content={text} language="typescript" fileName="app.ts" />
 */
export function CodeViewer({
  content,
  language,
  fileName,
  lineEnding,
}: {
  content: string;
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
        isReadOnly
        isWrapped={isWrapped}
        ariaLabel={`${fileName} (read-only)`}
        testId="code-viewer"
        className="flex-1"
      />
    </div>
  );
}
