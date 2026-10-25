import type { ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type ProgressBarTone = "primary" | "success" | "warning" | "pending" | "danger" | "dark";
export type ProgressBarSize = "extra-small" | "small" | "medium" | "large";
export type ProgressBarAppearance = "solid" | "soft";

const progressBarToneClassNames: Record<ProgressBarTone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  pending: "bg-pending",
  danger: "bg-danger",
  dark: "bg-dark",
};

const softProgressBarToneClassNames: Record<ProgressBarTone, string> = {
  primary: "border-primary/20 bg-primary/40",
  success: "border-success/20 bg-success/40",
  warning: "border-warning/20 bg-warning/40",
  pending: "border-pending/20 bg-pending/40",
  danger: "border-danger/20 bg-danger/40",
  dark: "border-dark/20 bg-dark/40",
};

const progressBarSizeClassNames: Record<ProgressBarSize, string> = {
  "extra-small": "h-1",
  small: "h-2",
  medium: "h-3",
  large: "h-4",
};

export interface ProgressBarProps {
  value: number;
  maximum?: number;
  tone?: ProgressBarTone;
  size?: ProgressBarSize;
  appearance?: ProgressBarAppearance;
  label?: ReactNode;
  className?: string;
  fillClassName?: string;
}

/**
 * A horizontal progress bar. Show text inside the fill with `label` (use `size="large"`).
 * `appearance="soft"` is the thin outlined bar used in tables (profile completeness, stock).
 *
 * @example
 * <ProgressBar value={68} />
 * <ProgressBar value={61} appearance="soft" size="extra-small" />
 * <ProgressBar value={3} maximum={4} tone="success" size="large" label="75%" />
 */
export function ProgressBar({ value, maximum = 100, tone = "primary", size = "small", appearance = "solid", label, className, fillClassName }: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / maximum) * 100));
  if (appearance === "soft") {
    return (
      <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={maximum} className={mergeClassNames("flex rounded-xs border bg-surface-subtle", progressBarSizeClassNames[size], className)}>
        <div className={mergeClassNames("-m-px border first:rounded-l-sm last:rounded-r-sm", softProgressBarToneClassNames[tone], fillClassName)} style={{ width: `${percentage}%` }} />
      </div>
    );
  }
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={maximum}
      className={mergeClassNames("w-full rounded-sm bg-surface-strong", progressBarSizeClassNames[size], className)}
    >
      <div
        className={mergeClassNames("flex h-full items-center justify-center rounded-sm text-xs text-on-primary", progressBarToneClassNames[tone], fillClassName)}
        style={{ width: `${percentage}%` }}
      >
        {label}
      </div>
    </div>
  );
}
