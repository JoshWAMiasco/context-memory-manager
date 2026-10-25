"use client";

import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Tooltip } from "@/components/interactive/tooltip";
import { mergeClassNames } from "@/utilities/merge-class-names";

const MINIMUM_SCALE = 0.25;
const MAXIMUM_SCALE = 8;
const ZOOM_STEP = 1.25;

const CHECKERBOARD_STYLE = {
  backgroundColor: "var(--color-surface-subtle)",
  backgroundImage:
    "linear-gradient(45deg, var(--color-surface-strong) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-strong) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-strong) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-strong) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

function clampScale(scale: number): number {
  return Math.min(MAXIMUM_SCALE, Math.max(MINIMUM_SCALE, scale));
}

function ToolbarButton({
  label,
  onClick,
  isActive = false,
  children,
  testId,
}: {
  label: string;
  onClick: () => void;
  isActive?: boolean;
  children: ReactNode;
  testId?: string;
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

/**
 * An image preview loaded through `<img>` only, so an SVG's scripts never run. Fit or
 * 100%, zoom 25%–800% with the buttons or Cmd/Ctrl + scroll wheel, drag to pan when zoomed, and a
 * checkerboard behind transparent images. `onFail` fires when the image can't be decoded.
 *
 * @example
 * <ImageViewer source={buildRawUrl(storageId, path)} name="chart.png" onFail={() => setHasFailed(true)} />
 */
export function ImageViewer({ source, name, onFail }: { source: string; name: string; onFail: () => void }) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>();
  const [chosenScale, setChosenScale] = useState<number | "fit">("fit");
  const [dragStart, setDragStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number }>();

  useEffect(() => {
    if (!viewportElement) return;
    const resizeObserver = new ResizeObserver(([observedEntry]) => {
      if (observedEntry)
        setViewportSize({ width: observedEntry.contentRect.width, height: observedEntry.contentRect.height });
    });
    resizeObserver.observe(viewportElement);
    return () => resizeObserver.disconnect();
  }, [viewportElement]);

  const fitScale =
    naturalSize && viewportSize.width > 0
      ? Math.min(1, (viewportSize.width - 32) / naturalSize.width, (viewportSize.height - 32) / naturalSize.height)
      : 1;
  const scale = chosenScale === "fit" ? Math.max(0.01, fitScale) : chosenScale;
  const zoomBy = (factor: number) => setChosenScale(clampScale(scale * factor));

  useEffect(() => {
    if (!viewportElement) return;
    const handleWheel = (wheelEvent: WheelEvent) => {
      if (!wheelEvent.metaKey && !wheelEvent.ctrlKey) return;
      wheelEvent.preventDefault();
      setChosenScale((currentScale) => {
        const baseScale = currentScale === "fit" ? scale : currentScale;
        return clampScale(baseScale * (wheelEvent.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      });
    };
    viewportElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewportElement.removeEventListener("wheel", handleWheel);
  }, [scale, viewportElement]);

  const isPannable =
    naturalSize !== undefined &&
    (naturalSize.width * scale > viewportSize.width || naturalSize.height * scale > viewportSize.height);

  const handlePointerMove = (pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const viewport = pointerEvent.currentTarget;
    viewport.scrollLeft = dragStart.scrollLeft - (pointerEvent.clientX - dragStart.x);
    viewport.scrollTop = dragStart.scrollTop - (pointerEvent.clientY - dragStart.y);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="image-viewer">
      <div className="flex items-center gap-1 border-b border-line/60 px-3 py-1.5">
        <ToolbarButton
          label="Fit to window"
          isActive={chosenScale === "fit"}
          onClick={() => setChosenScale("fit")}
          testId="image-fit"
        >
          <Maximize className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Actual size"
          isActive={chosenScale === 1}
          onClick={() => setChosenScale(1)}
          testId="image-actual-size"
        >
          100%
        </ToolbarButton>
        <ToolbarButton label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} testId="image-zoom-out">
          <ZoomOut className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} testId="image-zoom-in">
          <ZoomIn className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="ml-1 w-12 text-xs text-foreground-muted tabular-nums" data-testid="image-zoom-level">
          {Math.round(scale * 100)}%
        </span>
        {naturalSize && (
          <span className="ml-auto text-xs text-foreground-subtle" data-testid="image-dimensions">
            {naturalSize.width} × {naturalSize.height} px
          </span>
        )}
      </div>
      <div
        ref={setViewportElement}
        className={mergeClassNames(
          "relative min-h-0 flex-1 overflow-auto",
          isPannable && (dragStart ? "cursor-grabbing" : "cursor-grab"),
        )}
        style={CHECKERBOARD_STYLE}
        onPointerDown={(pointerEvent) => {
          if (!isPannable || !viewportElement || pointerEvent.button !== 0) return;
          pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
          setDragStart({
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
            scrollLeft: viewportElement.scrollLeft,
            scrollTop: viewportElement.scrollTop,
          });
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragStart(undefined)}
        onPointerCancel={() => setDragStart(undefined)}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: "max-content" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={source}
            alt={name}
            draggable={false}
            data-testid="image-preview"
            className="max-w-none select-none"
            style={
              naturalSize ? { width: naturalSize.width * scale, height: naturalSize.height * scale } : { opacity: 0 }
            }
            onLoad={(loadEvent) =>
              setNaturalSize({
                width: loadEvent.currentTarget.naturalWidth || 300,
                height: loadEvent.currentTarget.naturalHeight || 150,
              })
            }
            onError={onFail}
          />
        </div>
      </div>
    </div>
  );
}
