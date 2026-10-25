/*
 * What kind of file a name is, from its extension: drives the viewer choice, the icon, and the
 * Content-Type of raw responses. Isomorphic: no server-only imports here. Content checks (binary,
 * BOM, line endings) live in server/storage/sniff.ts.
 */
import type { FileKind, LineEnding } from "@/lib/api-types";

export interface FileKindInfo {
  kind: FileKind;
  /** Editor language id for code and text files. */
  language?: string;
  mime: string;
}

/** What a look at the first bytes of a file tells us. */
export interface SniffResult {
  isBinary: boolean;
  hasBom: boolean;
  isUtf8: boolean;
  lineEnding: LineEnding;
}

const CODE_LANGUAGES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  json5: "json",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  dart: "dart",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  bat: "bat",
  cmd: "bat",
  sql: "sql",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  env: "ini",
  vue: "html",
  svelte: "html",
  lua: "lua",
  r: "r",
  scala: "scala",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

const MEDIA_TYPES: Record<string, { kind: FileKind; mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  avif: { kind: "image", mime: "image/avif" },
  bmp: { kind: "image", mime: "image/bmp" },
  ico: { kind: "image", mime: "image/x-icon" },
  svg: { kind: "image", mime: "image/svg+xml" },
  mp4: { kind: "video", mime: "video/mp4" },
  m4v: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mov: { kind: "video", mime: "video/quicktime" },
  ogv: { kind: "video", mime: "video/ogg" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  wav: { kind: "audio", mime: "audio/wav" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  oga: { kind: "audio", mime: "audio/ogg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  flac: { kind: "audio", mime: "audio/flac" },
  aac: { kind: "audio", mime: "audio/aac" },
  pdf: { kind: "pdf", mime: "application/pdf" },
  zip: { kind: "archive", mime: "application/zip" },
  tar: { kind: "archive", mime: "application/x-tar" },
  gz: { kind: "archive", mime: "application/gzip" },
  tgz: { kind: "archive", mime: "application/gzip" },
  bz2: { kind: "archive", mime: "application/x-bzip2" },
  xz: { kind: "archive", mime: "application/x-xz" },
  "7z": { kind: "archive", mime: "application/x-7z-compressed" },
  rar: { kind: "archive", mime: "application/vnd.rar" },
};

const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "text", "log", "rst", "adoc", "tex", "gitignore", "editorconfig"]);

/** Names without a useful extension that are still code. */
const CODE_FILE_NAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".bashrc": "shell",
  ".zshrc": "shell",
  ".profile": "shell",
  ".env": "ini",
};

/** The lower-cased extension of `fileName`, without the dot; "" when it has none. */
export function readExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * Classifies a file by its name. Code is always `text/plain`, so a raw response never renders as
 * a page. SVG is an image for viewing (always shown through `<img>`), with the XML language for
 * editing.
 *
 * @example
 * describeFileKind("notes.md"); // { kind: "markdown", language: "markdown", mime: "text/markdown; charset=utf-8" }
 */
export function describeFileKind(fileName: string): FileKindInfo {
  const lowerName = fileName.toLowerCase();
  const extension = readExtension(lowerName);
  if (extension === "md" || extension === "markdown" || extension === "mdx") {
    return { kind: "markdown", language: "markdown", mime: "text/markdown; charset=utf-8" };
  }
  if (extension === "csv" || extension === "tsv") {
    return { kind: "csv", language: "plaintext", mime: `text/${extension === "csv" ? "csv" : "tab-separated-values"}` };
  }
  const mediaType = MEDIA_TYPES[extension];
  if (mediaType) return extension === "svg" ? { ...mediaType, language: "xml" } : mediaType;
  const codeLanguage = CODE_LANGUAGES[extension] ?? CODE_FILE_NAMES[lowerName];
  if (codeLanguage) {
    return { kind: "code", language: codeLanguage, mime: "text/plain; charset=utf-8" };
  }
  if (PLAIN_TEXT_EXTENSIONS.has(extension) || lowerName.startsWith("readme") || lowerName.startsWith("license")) {
    return { kind: "text", language: "plaintext", mime: "text/plain; charset=utf-8" };
  }
  return { kind: "binary", mime: "application/octet-stream" };
}

/** Whether files of this kind open in the text editor. */
export function isTextKind(kind: FileKind): boolean {
  return kind === "markdown" || kind === "code" || kind === "text" || kind === "csv";
}
