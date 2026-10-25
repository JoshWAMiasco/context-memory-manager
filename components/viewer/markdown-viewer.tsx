"use client";

import { ChevronRight, ImageOff } from "lucide-react";
import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useExplorer } from "@/components/explorer/explorer-context";
import { openExternalLink, readDesktopBridge } from "@/lib/client/desktop";
import { buildRawUrl } from "@/lib/client/fs";
import { splitFrontmatter } from "@/lib/editor/markdown-fidelity";
import { resolveMarkdownImage, resolveMarkdownLink } from "@/lib/fs/resolve-link";

const BLOCKED_IMAGE_LABELS = {
  external: "External image blocked (offline/privacy)",
  outside: "Image outside this storage",
  unsupported: "Image not supported",
} as const;

/** The plain text inside rendered Markdown children. */
function readText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return readText(child.props.children);
      return "";
    })
    .join("");
}

/**
 * A heading's anchor id, the way GitHub makes them: lower case, punctuation dropped, spaces to
 * hyphens.
 *
 * @example
 * slugifyHeading("Text styles!"); // "text-styles"
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s/g, "-");
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function BlockedImage({ label, source }: { label: string; source: string }) {
  return (
    <span className="markdown-blocked-image" title={source} data-testid="blocked-image">
      <ImageOff className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

/**
 * YAML frontmatter as a collapsible card above the rendered Markdown.
 *
 * @example
 * <FrontmatterCard yaml={"title: Notes\n"} />
 */
export function FrontmatterCard({ yaml }: { yaml: string }) {
  return (
    <details className="group mb-5 rounded-md border border-line bg-surface-subtle" data-testid="frontmatter-card">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground-muted select-none">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
        Metadata
      </summary>
      <pre className="overflow-x-auto border-t border-line px-3 py-2 font-mono text-xs leading-relaxed text-foreground-muted">
        {yaml}
      </pre>
    </details>
  );
}

/**
 * Rendered Markdown: GitHub-flavoured (tables, task lists, strikethrough) with
 * highlighted code. Raw HTML is never rendered. Headings get GitHub-style ids, so `#section`
 * links scroll there. Relative links open inside CMM; external links open a new tab, or in the
 * desktop app the default browser after a confirmation. Relative images load from the storage;
 * remote images are blocked.
 *
 * @example
 * <MarkdownViewer content={text} filePath="notes/today.md" />
 */
export function MarkdownViewer({ content, filePath }: { content: string; filePath: string }) {
  const { storage, selectPath } = useExplorer();
  const { yaml, frontmatter, body } = splitFrontmatter(content);

  const components = useMemo<Components>(
    () => ({
      ...Object.fromEntries(
        HEADING_TAGS.map((HeadingTag) => [
          HeadingTag,
          ({ children }: { children?: ReactNode }) => (
            <HeadingTag id={slugifyHeading(readText(children))}>{children}</HeadingTag>
          ),
        ]),
      ),
      img: ({ src, alt }) => {
        const source = typeof src === "string" ? src : "";
        const imageSource = resolveMarkdownImage(filePath, source);
        if (imageSource.kind === "blocked") {
          return <BlockedImage label={BLOCKED_IMAGE_LABELS[imageSource.reason]} source={source} />;
        }
        const resolvedSource =
          imageSource.kind === "inline" ? imageSource.source : buildRawUrl(storage.id, imageSource.path);
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={resolvedSource} alt={alt ?? ""} loading="lazy" />;
      },
      a: ({ href, children }) => {
        const linkTarget = resolveMarkdownLink(filePath, href ?? "");
        if (linkTarget.kind === "external") {
          return (
            <a
              href={linkTarget.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(clickEvent) => {
                if (!readDesktopBridge()) return;
                clickEvent.preventDefault();
                void openExternalLink(linkTarget.href);
              }}
            >
              {children}
            </a>
          );
        }
        if (linkTarget.kind === "blocked") {
          return <span title={linkTarget.reason}>{children as ReactNode}</span>;
        }
        return (
          <a
            href={linkTarget.kind === "anchor" ? `#${linkTarget.hash}` : undefined}
            role="link"
            tabIndex={0}
            onClick={(clickEvent) => {
              clickEvent.preventDefault();
              if (linkTarget.kind === "storage") {
                selectPath(linkTarget.path);
                return;
              }
              const article = clickEvent.currentTarget.closest("article");
              const target = article?.querySelector(`[id="${CSS.escape(slugifyHeading(linkTarget.hash))}"]`);
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === "Enter" && linkTarget.kind === "storage") selectPath(linkTarget.path);
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [filePath, selectPath, storage.id],
  );

  return (
    <article className="markdown-body mx-auto max-w-4xl px-6 py-5" data-testid="markdown-viewer">
      {frontmatter && <FrontmatterCard yaml={yaml} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        skipHtml
        components={components}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
