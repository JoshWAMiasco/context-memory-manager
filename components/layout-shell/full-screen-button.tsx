"use client";

import { joinClassNames } from "@/utilities/join-class-names";
import type { ReactNode } from "react";

/**
 * A top-bar button that switches the browser to full screen.
 *
 * @example
 * <FullScreenButton className="rounded-full p-2 hover:bg-surface-muted"><Expand className="h-[18px] w-[18px] stroke-[1]" /></FullScreenButton>
 */
export function FullScreenButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label="Full screen"
      onClick={() => document.documentElement.requestFullscreen?.()}
      className={joinClassNames("request-full-screen cursor-pointer", className)}
    >
      {children}
    </button>
  );
}
