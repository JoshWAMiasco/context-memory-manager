"use client";

import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { FileDiff as FileDiffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { FileDiff } from "@/lib/api-types";
import { describeFileKind } from "@/lib/file-kinds";
import { ccmTheme } from "@/lib/editor/ccm-theme";
import { loadLanguage } from "@/lib/editor/languages";

export type DiffLayout = "split" | "unified";

function describeSize(size: number | undefined): string {
  return size === undefined ? "none" : formatFileSize(size);
}

/**
 * A file before and after a commit, read-only: side by side (`split`) or in one column
 * with removed lines above added ones (`unified`). Binary or very large files show "Binary file
 * changed" with both sizes instead.
 *
 * @example
 * <DiffView diff={diff} fileName="notes.md" layout="split" />
 */
export function DiffView({ diff, fileName, layout }: { diff: FileDiff; fileName: string; layout: DiffLayout }) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const before = diff.before ?? "";
  const after = diff.after ?? "";

  useEffect(() => {
    if (!hostElement || diff.binary) return;
    let destroy: (() => void) | undefined;
    let isCurrent = true;
    void loadLanguage(describeFileKind(fileName).language, fileName).then((languageSupport) => {
      if (!isCurrent) return;
      const shared = [
        lineNumbers(),
        ccmTheme,
        languageSupport ?? [],
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ];
      if (layout === "split") {
        const mergeView = new MergeView({
          parent: hostElement,
          a: { doc: before, extensions: [...shared, EditorView.contentAttributes.of({ "aria-label": "Before" })] },
          b: { doc: after, extensions: [...shared, EditorView.contentAttributes.of({ "aria-label": "After" })] },
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 6 },
        });
        destroy = () => mergeView.destroy();
        return;
      }
      const editorView = new EditorView({
        parent: hostElement,
        doc: after,
        extensions: [
          ...shared,
          unifiedMergeView({ original: before, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 6 } }),
          EditorView.contentAttributes.of({ "aria-label": "Changes" }),
        ],
      });
      destroy = () => editorView.destroy();
    });
    return () => {
      isCurrent = false;
      destroy?.();
    };
  }, [after, before, diff.binary, fileName, hostElement, layout]);

  if (diff.binary) {
    return (
      <div
        className="flex items-center gap-3 rounded-md border border-line bg-surface-subtle p-4 text-sm"
        data-testid="diff-binary"
      >
        <FileDiffIcon className="h-5 w-5 flex-none text-foreground-muted" aria-hidden />
        <span>
          {diff.tooLarge ? "Too large to compare here." : "Binary file changed."}{" "}
          <span className="text-foreground-subtle">
            Before: {describeSize(diff.beforeSize)} · After: {describeSize(diff.afterSize)}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-line">
      {layout === "split" && (
        <div className="grid grid-cols-2 border-b border-line/60 text-xs text-foreground-subtle">
          <span className="px-3 py-1.5">{diff.beforeSize === undefined ? "Before (didn't exist)" : "Before"}</span>
          <span className="px-3 py-1.5">{diff.afterSize === undefined ? "After (deleted)" : "After"}</span>
        </div>
      )}
      <div
        key={layout}
        ref={setHostElement}
        data-testid="diff-view"
        data-layout={layout}
        className="max-h-[60vh] overflow-auto bg-field [&_.cm-mergeView]:min-h-24"
      />
    </div>
  );
}
