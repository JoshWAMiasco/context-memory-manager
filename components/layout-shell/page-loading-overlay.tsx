"use client";

import { useEffect, useState, type ReactNode } from "react";
import { joinClassNames } from "@/utilities/join-class-names";

type LoadingOverlayPhase = "visible" | "fading" | "hidden";

/**
 * The first-load overlay (`.loading-page`): the theme's classes paint a full-screen
 * gradient with a pulsing loader while `loading-page--before-hide` is set, and fade it out with
 * `loading-page--hide` once the page is interactive. Wraps the whole dashboard.
 *
 * @example
 * <PageLoadingOverlay className={SHELL_APPEARANCE.classNames.loadingPage}>{dashboard}</PageLoadingOverlay>
 */
export function PageLoadingOverlay({
  className,
  displayDurationInMilliseconds = 600,
  children,
}: {
  className?: string;
  displayDurationInMilliseconds?: number;
  children: ReactNode;
}) {
  const [overlayPhase, setOverlayPhase] = useState<LoadingOverlayPhase>("visible");
  useEffect(() => {
    const fadeTimeout = window.setTimeout(() => setOverlayPhase("fading"), displayDurationInMilliseconds);
    const hideTimeout = window.setTimeout(() => setOverlayPhase("hidden"), displayDurationInMilliseconds + 300);
    return () => {
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(hideTimeout);
    };
  }, [displayDurationInMilliseconds]);
  return (
    <div
      className={joinClassNames(
        "loading-page",
        className,
        overlayPhase !== "hidden" && "loading-page--before-hide",
        overlayPhase === "fading" && "loading-page--hide",
      )}
    >
      {children}
    </div>
  );
}
