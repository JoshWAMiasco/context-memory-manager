/*
 * The CodeMirror look, built from the theme's CSS variables so the editor, the
 * viewer and the merge view match the rest of the app. The app is dark-only.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const editorTheme = EditorView.theme(
  {
    "&": {
      color: "var(--color-foreground)",
      backgroundColor: "var(--color-field)",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--color-brand)", padding: "8px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-brand)" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--color-brand) 28%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-surface-subtle)",
      color: "var(--color-foreground-faint)",
      borderRight: "1px solid var(--color-line)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-surface-strong) 45%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--color-surface-muted)", color: "var(--color-foreground-muted)" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--color-surface-strong)",
      border: "none",
      color: "var(--color-foreground-muted)",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "color-mix(in srgb, var(--color-success) 22%, transparent)",
      outline: "1px solid color-mix(in srgb, var(--color-success) 50%, transparent)",
    },
    ".cm-nonmatchingBracket": { backgroundColor: "color-mix(in srgb, var(--color-danger) 25%, transparent)" },
    ".cm-searchMatch": {
      backgroundColor: "color-mix(in srgb, var(--color-warning) 25%, transparent)",
      outline: "1px solid color-mix(in srgb, var(--color-warning) 55%, transparent)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "color-mix(in srgb, var(--color-warning) 45%, transparent)",
    },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--color-info) 18%, transparent)" },
    ".cm-panels": {
      backgroundColor: "var(--color-surface-muted)",
      color: "var(--color-foreground)",
      borderColor: "var(--color-line)",
    },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--color-line)" },
    ".cm-panel.cm-search": { padding: "6px 10px", fontFamily: "var(--font-body)", fontSize: "12px" },
    ".cm-panel.cm-search input, .cm-panel.cm-search button": { fontSize: "12px", borderRadius: "var(--radius-md)" },
    ".cm-textfield": {
      backgroundColor: "var(--color-field)",
      border: "1px solid var(--color-line-strong)",
      color: "var(--color-foreground)",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--color-surface-strong)",
      border: "1px solid var(--color-line-strong)",
      color: "var(--color-foreground)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--color-surface-strong)",
      border: "1px solid var(--color-line-strong)",
      color: "var(--color-foreground)",
    },
    ".cm-changedLine": { backgroundColor: "color-mix(in srgb, var(--color-info) 10%, transparent)" },
    ".cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--color-danger) 14%, transparent)" },
    ".cm-insertedLine, .cm-changedText": {
      backgroundColor: "color-mix(in srgb, var(--color-success) 16%, transparent)",
    },
    ".cm-deletedLine, .cm-deletedText": { backgroundColor: "color-mix(in srgb, var(--color-danger) 16%, transparent)" },
    ".cm-merge-revert button": { color: "var(--color-brand)", cursor: "pointer" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--color-accent)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--color-success)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--color-pending)" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--color-foreground-faint)",
    fontStyle: "italic",
  },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--color-brand)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--color-warning)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--color-info)" },
  { tag: [tags.tagName, tags.heading], color: "var(--color-brand)", fontWeight: "600" },
  { tag: [tags.definition(tags.variableName), tags.self], color: "var(--color-foreground-strong)" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "var(--color-foreground-subtle)" },
  { tag: tags.link, color: "var(--color-brand)", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.invalid, color: "var(--color-danger)" },
]);

/**
 * The CMM editor theme and syntax colours, as one extension.
 *
 * @example
 * EditorState.create({ doc, extensions: [cmmTheme, …] });
 */
export const cmmTheme = [editorTheme, syntaxHighlighting(highlightStyle)];
