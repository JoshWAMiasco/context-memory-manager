"use client";

import { useEffect, useRef, useState } from "react";
import { ContentError, ContentLoader } from "@/components/viewer/content-loader";
import type { FileEntry } from "@/lib/api-types";
import { openExternalLink } from "@/lib/client/desktop";
import { fetchBytes } from "@/lib/client/fs";
import { sanitizeRenderedDocument } from "@/lib/client/sanitize-document";
import { isExternalLink } from "@/lib/desktop-bridge";

/**
 * A Word document (docx) laid out as pages, rendered in the browser by docx-preview (nothing is
 * sent anywhere). The file is untrusted, so embedded HTML isn't rendered, embedded fonts aren't
 * loaded, and the result is made inert (`sanitizeRenderedDocument`). Links open outside CMM
 * (the desktop app asks first); in-document links scroll.
 *
 * @example
 * <DocumentViewer entry={entry} source={rawUrl} onDownload={download} />
 */
export function DocumentViewer({
  entry,
  source,
  onDownload,
}: {
  entry: FileEntry;
  source: string;
  onDownload: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ source: string; error?: unknown }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const body = bodyRef.current;
    const styles = styleRef.current;
    if (!body || !styles) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [buffer, { renderAsync }] = await Promise.all([
          fetchBytes(source, controller.signal),
          import("docx-preview"),
        ]);
        if (controller.signal.aborted) return;
        await renderAsync(buffer, body, styles, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreFonts: true,
          renderAltChunks: false,
          useBase64URL: true,
          experimental: false,
          debug: false,
        });
        sanitizeRenderedDocument(body);
        sanitizeRenderedDocument(styles);
        if (!controller.signal.aborted) setStatus({ source });
      } catch (renderError) {
        if (controller.signal.aborted) return;
        body.replaceChildren();
        setStatus({
          source,
          error:
            renderError instanceof Error && !("status" in renderError)
              ? new Error("This document couldn't be shown. It may be damaged or not a Word (.docx) file.")
              : renderError,
        });
      }
    })();
    return () => {
      controller.abort();
      body.replaceChildren();
      styles.replaceChildren();
    };
  }, [attempt, source]);

  const isLoading = status?.source !== source;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="document-viewer">
      {isLoading && <ContentLoader entry={entry} variant="text" label="Laying out the document…" />}
      {status?.error !== undefined && (
        <ContentError
          error={status.error}
          onDownload={onDownload}
          onRetry={() => {
            setStatus(undefined);
            setAttempt(attempt + 1);
          }}
        />
      )}
      <div ref={styleRef} hidden />
      <div
        ref={bodyRef}
        className={isLoading || status?.error !== undefined ? "hidden" : "min-h-0 flex-1 overflow-auto"}
        data-testid="document-pages"
        onClick={(clickEvent) => {
          const link = (clickEvent.target as Element).closest("a");
          const href = link?.getAttribute("href");
          if (!href || href.startsWith("#")) return;
          clickEvent.preventDefault();
          if (isExternalLink(href)) void openExternalLink(href);
        }}
      />
    </div>
  );
}
