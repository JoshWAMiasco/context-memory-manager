"use client";

import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip } from "@/components/interactive/tooltip";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** Where scripts/copy-pdfjs-assets.ts puts the worker, fonts, CMaps and image decoders. */
const PDFJS_ASSETS = "/vendor/pdfjs";
const MINIMUM_SCALE = 0.25;
const MAXIMUM_SCALE = 5;
const ZOOM_STEP = 1.25;
const PAGE_GAP = 16;

type PdfLoadState = { status: "loading" } | { status: "ready"; document: PDFDocumentProxy } | { status: "failed" };

function clampScale(scale: number): number {
  return Math.min(MAXIMUM_SCALE, Math.max(MINIMUM_SCALE, scale));
}

function ToolbarButton({
  label,
  onClick,
  isActive = false,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={isActive}
        data-testid={testId}
        onClick={onClick}
        className={mergeClassNames(
          "flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md px-1.5 text-xs text-foreground-muted hover:bg-surface-strong hover:text-foreground",
          isActive && "bg-surface-strong text-brand",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** One page: a sized placeholder until it scrolls near the viewport, then a canvas. */
function PdfPage({
  document,
  pageNumber,
  scale,
  estimatedSize,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  estimatedSize: { width: number; height: number };
}) {
  const [pageElement, setPageElement] = useState<HTMLDivElement | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [isNear, setIsNear] = useState(false);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>();

  useEffect(() => {
    if (!pageElement) return;
    const observer = new IntersectionObserver(
      ([observedEntry]) => {
        if (observedEntry?.isIntersecting) setIsNear(true);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(pageElement);
    return () => observer.disconnect();
  }, [pageElement]);

  useEffect(() => {
    if (!isNear || !canvasElement) return;
    let renderTask: RenderTask | undefined;
    let isCurrent = true;
    void document.getPage(pageNumber).then((page) => {
      if (!isCurrent) return;
      const outputScale = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * outputScale });
      canvasElement.width = Math.floor(viewport.width);
      canvasElement.height = Math.floor(viewport.height);
      setPageSize({ width: viewport.width / outputScale, height: viewport.height / outputScale });
      renderTask = page.render({ canvas: canvasElement, viewport });
      renderTask.promise.catch(() => undefined);
    });
    return () => {
      isCurrent = false;
      renderTask?.cancel();
    };
  }, [canvasElement, document, isNear, pageNumber, scale]);

  const size = pageSize ?? { width: estimatedSize.width * scale, height: estimatedSize.height * scale };
  return (
    <div
      ref={setPageElement}
      data-page-number={pageNumber}
      data-testid="pdf-page"
      className="relative mx-auto bg-white shadow-overlay"
      style={{ width: size.width, height: size.height }}
    >
      {isNear && <canvas ref={setCanvasElement} aria-label={`Page ${pageNumber}`} className="block h-full w-full" />}
    </div>
  );
}

/**
 * A read-only PDF preview, drawn to canvas by a locally bundled pdf.js (no browser plugin, no
 * `<iframe>`, `<embed>` or `<object>`). Pages render as they scroll into view, the file loads with
 * byte ranges, and a PDF's own JavaScript is never run. Fit to width, zoom 25%–500%, and a page
 * counter. `onFail` fires for damaged or password-protected files. `source` is the PDF's URL, or
 * its bytes when they were fetched already (an Office file converted on the server).
 *
 * @example
 * <PdfViewer source={buildRawUrl(storageId, "paper.pdf")} onFail={(reason) => setFailure(reason)} />
 */
export function PdfViewer({ source, onFail }: { source: string | ArrayBuffer; onFail: (reason: string) => void }) {
  const [loadState, setLoadState] = useState<PdfLoadState>({ status: "loading" });
  const [firstPageSize, setFirstPageSize] = useState({ width: 612, height: 792 });
  const [chosenScale, setChosenScale] = useState<number | "fit">("fit");
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const onFailRef = useRef(onFail);

  useEffect(() => {
    onFailRef.current = onFail;
  });

  useEffect(() => {
    let isCurrent = true;
    let destroyLoading: (() => void) | undefined;
    void import("pdfjs-dist").then(async (pdfjs) => {
      if (!isCurrent) return;
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}/pdf.worker.min.mjs`;
      const loadingTask = pdfjs.getDocument({
        // pdf.js hands the bytes to its worker, so it gets a copy each time.
        ...(typeof source === "string" ? { url: source } : { data: source.slice(0) }),
        cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
        wasmUrl: `${PDFJS_ASSETS}/wasm/`,
        iccUrl: `${PDFJS_ASSETS}/iccs/`,
        enableXfa: false,
      });
      destroyLoading = () => void loadingTask.destroy();
      try {
        const pdfDocument = await loadingTask.promise;
        const firstPage = await pdfDocument.getPage(1);
        if (!isCurrent) return;
        const { width, height } = firstPage.getViewport({ scale: 1 });
        setFirstPageSize({ width, height });
        setLoadState({ status: "ready", document: pdfDocument });
      } catch (loadError) {
        if (!isCurrent) return;
        setLoadState({ status: "failed" });
        onFailRef.current(
          loadError instanceof pdfjs.PasswordException
            ? "This PDF is password protected, so it can't be previewed. Download it to open it."
            : "This PDF couldn't be shown. It may be damaged.",
        );
      }
    });
    return () => {
      isCurrent = false;
      destroyLoading?.();
    };
  }, [source]);

  useEffect(() => {
    if (!viewportElement) return;
    const resizeObserver = new ResizeObserver(([observedEntry]) => {
      if (observedEntry) setViewportWidth(observedEntry.contentRect.width);
    });
    resizeObserver.observe(viewportElement);
    return () => resizeObserver.disconnect();
  }, [viewportElement]);

  const fitScale = viewportWidth > 0 ? clampScale((viewportWidth - 48) / firstPageSize.width) : 1;
  const scale = chosenScale === "fit" ? fitScale : chosenScale;
  const pageCount = loadState.status === "ready" ? loadState.document.numPages : 0;

  const trackCurrentPage = (scrollElement: HTMLDivElement) => {
    const probeLine = scrollElement.scrollTop + scrollElement.clientHeight / 3;
    const pageHeight = firstPageSize.height * scale + PAGE_GAP;
    setCurrentPage(Math.min(pageCount, Math.max(1, Math.floor(probeLine / pageHeight) + 1)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pdf-viewer">
      <div className="flex items-center gap-1 border-b border-line/60 px-3 py-1.5">
        <ToolbarButton
          label="Fit to width"
          isActive={chosenScale === "fit"}
          onClick={() => setChosenScale("fit")}
          testId="pdf-fit"
        >
          <Maximize className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Zoom out"
          onClick={() => setChosenScale(clampScale(scale / ZOOM_STEP))}
          testId="pdf-zoom-out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Zoom in"
          onClick={() => setChosenScale(clampScale(scale * ZOOM_STEP))}
          testId="pdf-zoom-in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="ml-1 w-12 text-xs text-foreground-muted tabular-nums" data-testid="pdf-zoom-level">
          {Math.round(scale * 100)}%
        </span>
        {pageCount > 0 && (
          <span className="ml-auto text-xs text-foreground-subtle" data-testid="pdf-page-indicator">
            Page {currentPage} of {pageCount}
          </span>
        )}
      </div>
      <div
        ref={setViewportElement}
        onScroll={(scrollEvent) => trackCurrentPage(scrollEvent.currentTarget)}
        className="min-h-0 flex-1 overflow-auto bg-surface-subtle"
      >
        {loadState.status === "loading" && (
          <div className="mx-auto mt-6 h-[60vh] w-full max-w-lg animate-pulse rounded-md bg-surface-muted" />
        )}
        {loadState.status === "ready" && (
          <div className="flex w-max min-w-full flex-col py-4" style={{ gap: PAGE_GAP }}>
            {Array.from({ length: pageCount }, (_unused, pageIndex) => (
              <PdfPage
                key={pageIndex + 1}
                document={loadState.document}
                pageNumber={pageIndex + 1}
                scale={scale}
                estimatedSize={firstPageSize}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
