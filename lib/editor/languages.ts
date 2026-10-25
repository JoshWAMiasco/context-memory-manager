/*
 * CodeMirror language support by editor language id. Each language is a lazy `import()`
 * of a local package, so its code is a separate chunk loaded on first use; nothing comes from a
 * CDN. Ids are the ones `describeFileKind` returns.
 */
import { LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";

type LanguageLoader = (fileName: string) => Promise<LanguageSupport>;

function legacy(loadParser: () => Promise<StreamParser<unknown>>): LanguageLoader {
  return async () => new LanguageSupport(StreamLanguage.define(await loadParser()));
}

const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  javascript: async (fileName) =>
    (await import("@codemirror/lang-javascript")).javascript({ jsx: /\.jsx$/i.test(fileName) }),
  typescript: async (fileName) =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: /\.tsx$/i.test(fileName) }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  scss: async () => (await import("@codemirror/lang-css")).css(),
  less: async () => (await import("@codemirror/lang-css")).css(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  php: async () => (await import("@codemirror/lang-php")).php(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  shell: legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell),
  toml: legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml),
  dockerfile: legacy(async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile),
  ini: legacy(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties),
  powershell: legacy(async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
  ruby: legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby),
  lua: legacy(async () => (await import("@codemirror/legacy-modes/mode/lua")).lua),
  swift: legacy(async () => (await import("@codemirror/legacy-modes/mode/swift")).swift),
  kotlin: legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin),
  dart: legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).dart),
  csharp: legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp),
  scala: legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).scala),
  r: legacy(async () => (await import("@codemirror/legacy-modes/mode/r")).r),
  protobuf: legacy(async () => (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf),
};

/** The language ids with syntax support; anything else is plain text. */
export const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_LOADERS);

/**
 * Loads the CodeMirror support for `language`, or undefined for plain text and unknown ids.
 * `fileName` picks variants such as JSX/TSX.
 *
 * @example
 * const support = await loadLanguage("typescript", "app.tsx");
 */
export async function loadLanguage(language: string | undefined, fileName = ""): Promise<LanguageSupport | undefined> {
  const loadSupport = language ? LANGUAGE_LOADERS[language] : undefined;
  return loadSupport ? loadSupport(fileName) : undefined;
}
