import type { ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * A centered placeholder for lists and tables with no data.
 *
 * @example
 * <EmptyState icon={<Inbox className="h-10 w-10 stroke-[1]" />} title="No messages" description="New mail will appear here." />
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={mergeClassNames("flex flex-col items-center justify-center px-5 py-16 text-center", className)}>
      {icon && <div className="text-foreground-subtle">{icon}</div>}
      <div className="mt-3 text-base font-medium font-display">{title}</div>
      {description && <div className="mt-1 text-foreground-muted">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
