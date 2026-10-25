"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { MarkdownViewer } from "@/components/viewer/markdown-viewer";
import { useGitInstallHelp } from "@/lib/client/versioning";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * "How to install Git": the offline install notes for macOS, Windows and Ubuntu,
 * expanded on demand (or from the start when Git is missing).
 *
 * @example
 * <GitInstallHelp isInitiallyOpen={!git.installed} />
 */
export function GitInstallHelp({ isInitiallyOpen = false }: { isInitiallyOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  const { data: help, error } = useGitInstallHelp(isOpen);
  return (
    <div className="rounded-md border border-line" data-testid="git-install-help" data-open={isOpen}>
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium hover:bg-surface-muted"
      >
        How to install Git
        <ChevronDown className={mergeClassNames("h-4 w-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
      </button>
      {isOpen && (
        <div className="max-h-80 overflow-auto border-t border-line px-3 py-2 text-sm">
          {help ? (
            <MarkdownViewer content={help.markdown} filePath="help/git-install.md" />
          ) : (
            <p className="text-foreground-subtle">{error ? error.message : "Loading…"}</p>
          )}
        </div>
      )}
    </div>
  );
}
