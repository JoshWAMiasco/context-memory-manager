"use client";

import { WrapText } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/interactive/tooltip";
import type { LineEnding } from "@/lib/api-types";
import { mergeClassNames } from "@/utilities/merge-class-names";

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  python: "Python",
  markdown: "Markdown",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  yaml: "YAML",
  sql: "SQL",
  xml: "XML",
  rust: "Rust",
  c: "C",
  cpp: "C++",
  java: "Java",
  php: "PHP",
  go: "Go",
  shell: "Shell",
  toml: "TOML",
  dockerfile: "Dockerfile",
  ini: "INI",
  powershell: "PowerShell",
  ruby: "Ruby",
  lua: "Lua",
  swift: "Swift",
  kotlin: "Kotlin",
  dart: "Dart",
  csharp: "C#",
  scala: "Scala",
  r: "R",
  protobuf: "Protocol Buffers",
};

/**
 * The strip above the code viewer and editor: language, line endings, word wrap, and any extra
 * controls passed as children.
 *
 * @example
 * <CodeToolbar language="typescript" lineEnding="crlf" isWrapped={isWrapped} onToggleWrap={toggleWrapped} />
 */
export function CodeToolbar({
  language,
  lineEnding,
  lineCount,
  isWrapped,
  onToggleWrap,
  children,
}: {
  language?: string;
  lineEnding?: LineEnding;
  lineCount?: number;
  isWrapped: boolean;
  onToggleWrap: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line/60 bg-surface-subtle px-3 py-1 text-xs text-foreground-subtle">
      <span data-testid="code-language">{(language && LANGUAGE_LABELS[language]) ?? "Plain text"}</span>
      {lineEnding && <span data-testid="code-line-ending">{lineEnding === "crlf" ? "CRLF" : "LF"}</span>}
      {lineCount !== undefined && <span>{lineCount.toLocaleString()} lines</span>}
      <div className="ml-auto flex items-center gap-1">
        {children}
        <Tooltip content={isWrapped ? "Turn word wrap off" : "Turn word wrap on"}>
          <button
            type="button"
            aria-label="Word wrap"
            aria-pressed={isWrapped}
            data-testid="code-wrap-toggle"
            onClick={onToggleWrap}
            className={mergeClassNames(
              "flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-surface-strong hover:text-foreground",
              isWrapped && "bg-surface-strong text-brand",
            )}
          >
            <WrapText className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
