"use client";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { ccmTheme } from "@/lib/editor/ccm-theme";
import { detectIndentation } from "@/lib/editor/indentation";
import { loadLanguage } from "@/lib/editor/languages";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface CodeMirrorViewProps {
  /** The text. Changes from outside (a reload) replace the document; typing reports through `onChange`. */
  value: string;
  /** An editor language id from `describeFileKind`; unknown ids are plain text. */
  language?: string;
  fileName: string;
  isReadOnly?: boolean;
  isWrapped?: boolean;
  onChange?: (value: string) => void;
  /** Cmd/Ctrl+S. */
  onSave?: () => void;
  ariaLabel: string;
  className?: string;
  testId?: string;
}

/**
 * CodeMirror 6 for viewing and editing text: line numbers, folding, active line,
 * bracket matching and auto-close, history, search and replace (Cmd/Ctrl+F), indentation detected
 * from the file, optional word wrap, and Cmd/Ctrl+S. Read-only keeps selection and search.
 * The language loads lazily from a local chunk.
 *
 * @example
 * <CodeMirrorView value={text} language="typescript" fileName="app.ts" onChange={setText} onSave={save} ariaLabel="app.ts" />
 */
export function CodeMirrorView({
  value,
  language,
  fileName,
  isReadOnly = false,
  isWrapped = false,
  onChange,
  onSave,
  ariaLabel,
  className,
  testId,
}: CodeMirrorViewProps) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const [compartments] = useState(() => ({
    language: new Compartment(),
    readOnly: new Compartment(),
    wrap: new Compartment(),
  }));
  const viewRef = useRef<EditorView | undefined>(undefined);
  const lastValueRef = useRef(value);
  const callbacksRef = useRef({ onChange, onSave });

  useEffect(() => {
    callbacksRef.current = { onChange, onSave };
  });

  useEffect(() => {
    if (!hostElement) return;
    const initialText = lastValueRef.current;
    const indentation = detectIndentation(initialText);
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      history(),
      search({ top: true }),
      indentUnit.of(indentation.unit),
      EditorState.tabSize.of(indentation.tabSize),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            callbacksRef.current.onSave?.();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      ccmTheme,
      compartments.language.of([]),
      compartments.readOnly.of(EditorState.readOnly.of(false)),
      compartments.wrap.of([]),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      EditorView.updateListener.of((viewUpdate) => {
        if (!viewUpdate.docChanged) return;
        const nextText = viewUpdate.state.doc.toString();
        lastValueRef.current = nextText;
        callbacksRef.current.onChange?.(nextText);
      }),
    ];
    const view = new EditorView({ parent: hostElement, state: EditorState.create({ doc: initialText, extensions }) });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
  }, [ariaLabel, compartments, hostElement]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.readOnly.reconfigure(EditorState.readOnly.of(isReadOnly)) });
  }, [compartments, hostElement, isReadOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.wrap.reconfigure(isWrapped ? EditorView.lineWrapping : []) });
  }, [compartments, hostElement, isWrapped]);

  useEffect(() => {
    let isCurrent = true;
    void loadLanguage(language, fileName).then((languageSupport) => {
      if (isCurrent) viewRef.current?.dispatch({ effects: compartments.language.reconfigure(languageSupport ?? []) });
    });
    return () => {
      isCurrent = false;
    };
  }, [compartments, fileName, hostElement, language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValueRef.current) return;
    lastValueRef.current = value;
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [hostElement, value]);

  return (
    <div
      ref={setHostElement}
      data-testid={testId}
      data-read-only={isReadOnly}
      className={mergeClassNames("h-full min-h-0 overflow-hidden [&_.cm-editor]:h-full", className)}
    />
  );
}
