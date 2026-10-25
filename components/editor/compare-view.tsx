"use client";

import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { cmmTheme } from "@/lib/editor/cmm-theme";
import { loadLanguage } from "@/lib/editor/languages";

/**
 * Disk version (left, read-only) against mine (right, editable), side by side. The arrows
 * between changed chunks copy the disk version's chunk into mine. `onChange` reports my side.
 *
 * @example
 * <CompareView diskText={disk.content} myText={draft} language="markdown" fileName="a.md" onChange={setMerged} />
 */
export function CompareView({
  diskText,
  myText,
  language,
  fileName,
  onChange,
}: {
  diskText: string;
  myText: string;
  language?: string;
  fileName: string;
  onChange: (text: string) => void;
}) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const initialTextsRef = useRef({ diskText, myText });
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!hostElement) return;
    let mergeView: MergeView | undefined;
    let isCurrent = true;
    void loadLanguage(language, fileName).then((languageSupport) => {
      if (!isCurrent) return;
      const sharedExtensions = [lineNumbers(), cmmTheme, languageSupport ?? []];
      mergeView = new MergeView({
        parent: hostElement,
        a: {
          doc: initialTextsRef.current.diskText,
          extensions: [
            ...sharedExtensions,
            EditorState.readOnly.of(true),
            EditorView.contentAttributes.of({ "aria-label": "Version on disk" }),
          ],
        },
        b: {
          doc: initialTextsRef.current.myText,
          extensions: [
            ...sharedExtensions,
            EditorView.contentAttributes.of({ "aria-label": "My version" }),
            EditorView.updateListener.of((viewUpdate) => {
              if (viewUpdate.docChanged) onChangeRef.current(viewUpdate.state.doc.toString());
            }),
          ],
        },
        revertControls: "a-to-b",
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 6 },
      });
    });
    return () => {
      isCurrent = false;
      mergeView?.destroy();
    };
  }, [fileName, hostElement, language]);

  return (
    <div>
      <div className="grid grid-cols-2 border-b border-line/60 text-xs text-foreground-subtle">
        <span className="px-3 py-1.5">On disk</span>
        <span className="px-3 py-1.5">Mine (editable)</span>
      </div>
      <div
        ref={setHostElement}
        data-testid="compare-view"
        className="max-h-[60vh] overflow-auto bg-field [&_.cm-mergeView]:min-h-48"
      />
    </div>
  );
}
