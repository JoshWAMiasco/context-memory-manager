import { mergeClassNames } from "@/utilities/merge-class-names";

export interface LoadingSkeletonProps {
  /** How many placeholder rows to draw. */
  rows?: number;
  /** What is loading, for screen readers ("Loading users…"). */
  label?: string;
  className?: string;
}

/**
 * Placeholder rows shown while a list or table loads: soft bars in the shape of the content, which
 * pulse unless the user asked for reduced motion. Screen readers hear `label` once.
 *
 * @example
 * if (isLoading) return <LoadingSkeleton rows={4} label="Loading users…" />;
 */
export function LoadingSkeleton({ rows = 3, label = "Loading…", className }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={mergeClassNames("flex flex-col gap-3 py-2", className)}
      data-testid="loading-skeleton"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_unused, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3" aria-hidden>
          <div className="h-4 w-4 flex-none rounded bg-surface-strong motion-safe:animate-pulse" />
          <div
            className="h-3.5 rounded bg-surface-strong motion-safe:animate-pulse"
            style={{ width: `${[62, 48, 74, 55, 68][rowIndex % 5]}%` }}
          />
          <div className="ml-auto h-3.5 w-16 rounded bg-surface-muted motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
