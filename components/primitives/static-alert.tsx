import type { ComponentProps, ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type AlertTone = "primary" | "secondary" | "success" | "warning" | "pending" | "danger" | "dark";
export type AlertVariant = "solid" | "outline" | "soft";

const alertClassNames: Record<AlertVariant, Record<AlertTone, string>> = {
  solid: {
    primary: "bg-primary border-primary text-on-primary",
    secondary: "bg-secondary/70 border-secondary/70 text-foreground-muted",
    success: "bg-success border-success text-on-primary",
    warning: "bg-warning border-warning text-on-primary",
    pending: "bg-pending border-pending text-on-primary",
    danger: "bg-danger border-danger text-on-primary",
    dark: "bg-dark border-dark text-on-neutral",
  },
  outline: {
    primary: "border-primary text-primary",
    secondary: "border-secondary text-foreground-muted",
    success: "border-success text-success",
    warning: "border-warning text-warning",
    pending: "border-pending text-pending",
    danger: "border-danger text-danger",
    dark: "border-line-strong text-foreground-strong",
  },
  soft: {
    primary: "bg-primary/20 border-primary/5 text-primary",
    secondary: "bg-surface-heavy/10 border-secondary text-foreground-muted",
    success: "bg-success/20 border-success/5 text-success",
    warning: "bg-warning/20 border-warning/5 text-warning",
    pending: "bg-pending/20 border-pending/5 text-pending",
    danger: "bg-danger/20 border-danger/5 text-danger",
    dark: "bg-dark/60 border-line text-foreground-strong",
  },
};

export interface StaticAlertProps extends Omit<ComponentProps<"div">, "title"> {
  tone?: AlertTone;
  variant?: AlertVariant;
  icon?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
}

/**
 * Returns the class names of an alert box, shared by `StaticAlert` and `DismissibleAlert`.
 *
 * @example
 * createAlertClassNames({ tone: "warning", variant: "soft" });
 */
export function createAlertClassNames({ tone = "primary", variant = "solid", className }: { tone?: AlertTone; variant?: AlertVariant; className?: string }): string {
  return mergeClassNames("alert relative rounded-md border px-5 py-4", alertClassNames[variant][tone], className);
}

/**
 * An alert message box. Server component; use `DismissibleAlert` when users can close it.
 *
 * @example
 * <StaticAlert tone="warning" variant="soft" icon={<AlertTriangle className="mr-2 h-6 w-6" />}>
 *   Your subscription expires in 3 days.
 * </StaticAlert>
 */
export function StaticAlert({ tone, variant, icon, title, actions, className, children, ...divisionAttributes }: StaticAlertProps) {
  const hasLayout = Boolean(icon || actions);
  return (
    <div role="alert" className={createAlertClassNames({ tone, variant, className: mergeClassNames(hasLayout && "flex items-center", className) })} {...divisionAttributes}>
      {icon}
      <div className={hasLayout ? "flex-1" : undefined}>
        {title && <div className="text-lg font-medium font-display">{title}</div>}
        {title ? <div className="mt-1">{children}</div> : children}
      </div>
      {actions}
    </div>
  );
}
