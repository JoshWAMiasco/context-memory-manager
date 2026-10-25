import type { ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * The title row at the top of a page, with an optional `description` line under the title and
 * optional actions on the right. The title uses the theme's display font.
 *
 * @example
 * <PageHeader title="Users" actions={<ButtonLink href="/users/new" variant="primary">Add New User</ButtonLink>} />
 * <PageHeader title="Reports" description="Sales figures for the last 30 days." />
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={mergeClassNames("flex flex-col gap-y-3 md:flex-row md:items-center", description ? "md:min-h-10" : "md:h-10", className)}>
      <div>
        <div className="text-base font-medium font-display">{title}</div>
        {description && <div className="mt-1 leading-relaxed text-foreground-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-col gap-x-3 gap-y-2 sm:flex-row md:ml-auto">{actions}</div>}
    </div>
  );
}
