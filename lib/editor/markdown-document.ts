/*
 * The TipTap schema the Markdown editor uses, and the Markdown text it saves. Kept free
 * of React so unit tests can round-trip documents through `MarkdownManager` in Node.
 */
import { mergeAttributes, Node, type AnyExtension, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/**
 * A line break inside a Markdown paragraph that isn't a hard break (the source just wraps). It is
 * drawn as a space, like the viewer does, and written back as the original line break. Kept as its
 * own node because a `\n` inside text turns into a hard break when ProseMirror re-reads the DOM.
 */
const SoftBreak = Node.create({
  name: "softBreak",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  parseHTML: () => [{ tag: "span.markdown-soft-break" }],
  renderHTML: () => ["span", { class: "markdown-soft-break" }, " "],
  renderText: () => "\n",
  renderMarkdown: () => "\n",
});

/**
 * Turns the line breaks Markdown leaves inside paragraph text into `softBreak` nodes. Code blocks
 * keep theirs.
 *
 * @example
 * splitSoftBreaks(markdownManager.parse("one\ntwo")); // paragraph: text "one", softBreak, text "two"
 */
export function splitSoftBreaks(document: JSONContent): JSONContent {
  if (!document.content || document.type === "codeBlock") return document;
  const content: JSONContent[] = [];
  for (const child of document.content) {
    if (child.type !== "text" || !child.text?.includes("\n")) {
      content.push(splitSoftBreaks(child));
      continue;
    }
    child.text.split("\n").forEach((part, partIndex) => {
      if (partIndex > 0) content.push({ type: "softBreak" });
      if (part !== "") content.push({ ...child, text: part });
    });
  }
  return { ...document, content };
}

export interface MarkdownExtensionOptions {
  /** Maps an image `src` from the file to the URL the browser loads; undefined blocks the image. */
  resolveImageSource?: (source: string) => string | undefined;
  placeholder?: string;
}

/**
 * The editor's extensions: StarterKit (headings, lists, code blocks, links…), tables, task lists
 * and images. Images keep their Markdown `src`; only the rendered `<img>` goes through
 * `resolveImageSource`, so relative paths load from the storage and remote images stay blocked.
 *
 * @example
 * useEditor({ extensions: [...createMarkdownExtensions({ resolveImageSource }), Markdown] });
 */
export function createMarkdownExtensions({
  resolveImageSource = (source) => source,
  placeholder,
}: MarkdownExtensionOptions = {}): AnyExtension[] {
  const StorageImage = Image.extend({
    renderHTML({ HTMLAttributes }) {
      const source = typeof HTMLAttributes.src === "string" ? HTMLAttributes.src : "";
      const resolvedSource = resolveImageSource(source);
      if (resolvedSource === undefined) {
        return [
          "span",
          mergeAttributes({ class: "markdown-blocked-image", "data-source": source, title: source }),
          `External image blocked: ${String(HTMLAttributes.alt ?? source)}`,
        ];
      }
      return ["img", mergeAttributes(HTMLAttributes, { src: resolvedSource })];
    },
  });
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: false },
    }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    StorageImage,
    SoftBreak,
    ...(placeholder === undefined ? [] : [Placeholder.configure({ placeholder })]),
  ];
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Tidies TipTap's Markdown output: empty paragraphs (which TipTap writes as `&nbsp;`) are dropped,
 * runs of blank lines outside code blocks become one blank line, and the text ends with exactly
 * one line break when the original did.
 *
 * @example
 * normalizeSerializedMarkdown("# A\n\n\n\nB", { endsWithNewline: true }); // "# A\n\nB\n"
 */
export function normalizeSerializedMarkdown(markdown: string, { endsWithNewline }: { endsWithNewline: boolean }) {
  const outputLines: string[] = [];
  let openFence: string | undefined;
  for (const line of markdown.split("\n")) {
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch?.[1]) {
      if (openFence === undefined) openFence = fenceMatch[1];
      else if (fenceMatch[1].startsWith(openFence)) openFence = undefined;
    }
    const isBlank = line.trim() === "" || (openFence === undefined && line.trim() === "&nbsp;");
    if (openFence === undefined && isBlank && outputLines.at(-1)?.trim() === "") continue;
    outputLines.push(isBlank && openFence === undefined ? "" : line);
  }
  const joinedMarkdown = outputLines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return endsWithNewline && joinedMarkdown !== "" ? `${joinedMarkdown}\n` : joinedMarkdown;
}

/**
 * Parses Markdown into the editor's document (with soft breaks as nodes) and writes it back, the
 * way the rich editor does. The editor loads its content through this; saving uses the `Markdown`
 * extension's serializer.
 *
 * @example
 * const markdown = createMarkdownConverter();
 * markdown.serialize(markdown.parse("# Title\n")); // "# Title\n"
 */
export function createMarkdownConverter() {
  const manager = new MarkdownManager({ extensions: createMarkdownExtensions() });
  return {
    parse: (markdown: string) => splitSoftBreaks(manager.parse(markdown)),
    serialize: (document: Parameters<MarkdownManager["serialize"]>[0], endsWithNewline = true) =>
      normalizeSerializedMarkdown(manager.serialize(document), { endsWithNewline }),
  };
}
