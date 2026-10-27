"use client";

import { useEffect, useState } from "react";

/** A still frame of a video and what the video element read about it. */
export interface VideoStill {
  imageUrl: string;
  width: number;
  height: number;
  /** Seconds; undefined when the video doesn't say (a live or broken stream). */
  duration?: number;
}

/** Gives up on a video the browser can't decode (or that loads too slowly) after this long. */
const CAPTURE_TIMEOUT_MILLISECONDS = 8000;
/** The still is drawn at most this wide. */
const MAX_STILL_WIDTH = 960;
/** Stills kept for this session, newest last; older ones are released. */
const MAX_CACHED_STILLS = 30;

const stillCache = new Map<string, VideoStill>();

function rememberStill(source: string, still: VideoStill): void {
  stillCache.delete(source);
  stillCache.set(source, still);
  while (stillCache.size > MAX_CACHED_STILLS) {
    const [oldestSource, oldestStill] = stillCache.entries().next().value as [string, VideoStill];
    URL.revokeObjectURL(oldestStill.imageUrl);
    stillCache.delete(oldestSource);
  }
}

/**
 * Captures one frame of a video: a muted video element that is never attached to the page or
 * played loads the metadata, seeks to 1 second (or 10% of a shorter video) and the frame is
 * drawn to a canvas. Resolves undefined when the browser can't decode it in time.
 */
function captureStill(source: string, signal: AbortSignal): Promise<VideoStill | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let isDone = false;
    const finish = (still: VideoStill | undefined) => {
      if (isDone) return;
      isDone = true;
      window.clearTimeout(timer);
      // Stops the download of the rest of the video.
      video.removeAttribute("src");
      video.load();
      resolve(still);
    };
    const timer = window.setTimeout(() => finish(undefined), CAPTURE_TIMEOUT_MILLISECONDS);
    signal.addEventListener("abort", () => finish(undefined), { once: true });
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("error", () => finish(undefined), { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        const duration = Number.isFinite(video.duration) ? video.duration : undefined;
        video.currentTime = duration === undefined ? 0 : Math.min(1, duration * 0.1);
      },
      { once: true },
    );
    video.addEventListener(
      "seeked",
      () => {
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          finish(undefined);
          return;
        }
        const scale = Math.min(1, MAX_STILL_WIDTH / video.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          finish(undefined);
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const duration = Number.isFinite(video.duration) ? video.duration : undefined;
        canvas.toBlob(
          (blob) =>
            finish(
              blob
                ? { imageUrl: URL.createObjectURL(blob), width: video.videoWidth, height: video.videoHeight, duration }
                : undefined,
            ),
          "image/jpeg",
          0.85,
        );
      },
      { once: true },
    );
    video.src = source;
  });
}

/**
 * One still frame of a video, for its placeholder: video is never played in CMM. Kept in memory
 * for this session (never written to disk, which matters for encrypted folders). `still` is
 * undefined while it loads; `hasFailed` when the browser can't decode the video.
 *
 * @example
 * const { still, hasFailed } = useVideoStill(`${buildRawUrl(storageId, path)}&v=${etag}`);
 */
export function useVideoStill(source: string | undefined): { still?: VideoStill; hasFailed: boolean } {
  const [result, setResult] = useState<{ source?: string; still?: VideoStill; hasFailed: boolean }>({
    hasFailed: false,
  });
  useEffect(() => {
    if (!source || stillCache.has(source)) return;
    const controller = new AbortController();
    void captureStill(source, controller.signal).then((still) => {
      if (controller.signal.aborted) {
        if (still) URL.revokeObjectURL(still.imageUrl);
        return;
      }
      if (still) rememberStill(source, still);
      setResult({ source, still, hasFailed: still === undefined });
    });
    return () => controller.abort();
  }, [source]);
  if (!source) return { hasFailed: false };
  const cached = stillCache.get(source);
  if (cached) return { still: cached, hasFailed: false };
  return result.source === source ? { still: result.still, hasFailed: result.hasFailed } : { hasFailed: false };
}

/**
 * A duration as "1:02:03" or "4:05".
 *
 * @example
 * formatDuration(125); // "2:05"
 */
export function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = String(rounded % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
