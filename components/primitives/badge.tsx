import type { ComponentProps, ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type BadgeTone = "primary" | "secondary" | "success" | "warning" | "pending" | "danger" | "info" | "dark" | "slate";
export type BadgeVariant = "solid" | "soft" | "outline";

const badgeToneClassNames: Record<BadgeVariant, Record<BadgeTone, string>> = {
  solid: {
    primary: "bg-primary text-on-primary",
    secondary: "bg-secondary text-foreground",
    success: "bg-success text-on-primary",
    warning: "bg-warning text-on-primary",
    pending: "bg-pending text-on-primary",
    danger: "bg-danger text-on-primary",
    info: "bg-info text-on-primary",
    dark: "bg-dark text-on-neutral",
    slate: "bg-foreground-muted text-on-primary",
  },
  soft: {
    primary: "border-primary/10 bg-primary/10 text-primary",
    secondary: "border-line-strong/60 bg-surface-muted text-foreground-muted",
    success: "border-success/10 bg-success/10 text-success",
    warning: "border-warning/10 bg-warning/10 text-warning",
    pending: "border-pending/10 bg-pending/10 text-pending",
    danger: "border-danger/10 bg-danger/10 text-danger",
    info: "border-info/10 bg-info/10 text-info",
    dark: "border-line bg-dark/60 text-foreground-strong",
    slate: "border-line-strong/60 bg-surface-muted text-foreground-muted",
  },
  outline: {
    primary: "border-primary text-primary",
    secondary: "border-line-strong text-foreground-muted",
    success: "border-success text-success",
    warning: "border-warning text-warning",
    pending: "border-pending text-pending",
    danger: "border-danger text-danger",
    info: "border-info text-info",
    dark: "border-line-strong text-foreground-strong",
    slate: "border-line-strong text-foreground-muted",
  },
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  icon?: ReactNode;
}

/**
 * A small rounded label for statuses, counts and tags.
 *
 * @example
 * <Badge tone="success" variant="soft">Active</Badge>
 * <Badge tone="danger" variant="soft" icon={<ChevronDown className="ml-px h-4 w-4 stroke-[1.5]" />}>3%</Badge>
 */
export function Badge({ tone = "primary", variant = "soft", icon, className, children, ...spanAttributes }: BadgeProps) {
  return (
    <span
      className={mergeClassNames(
        "inline-flex items-center rounded-full border py-[2px] pr-1.5 pl-[7px] text-xs font-medium",
        variant === "solid" && "border-transparent",
        badgeToneClassNames[variant][tone],
        className,
      )}
      {...spanAttributes}
    >
      {children}
      {icon}
    </span>
  );
}
