import type { ComponentProps, ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface CardProps extends ComponentProps<"div"> {
  isStacked?: boolean;
}

/**
 * The theme's card surface (`.box`). `isStacked` adds the layered "card behind a card" look.
 *
 * @example
 * <Card isStacked className="p-5">
 *   <CardHeader title="Registered Users" actions={<Button size="small">Export</Button>} />
 *   …
 * </Card>
 */
export function Card({ isStacked = false, className, ...divisionAttributes }: CardProps) {
  return <div className={mergeClassNames("box", isStacked && "box--stacked", className)} {...divisionAttributes} />;
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * A title row with optional description and right-aligned actions, for the top of a `Card`
 * or a page section.
 *
 * @example
 * <CardHeader title="Sales Report" description="Last 30 days" actions={<DateRangeButton />} />
 */
export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
  return (
    <div className={mergeClassNames("flex flex-col gap-y-3 md:flex-row md:items-center", className)}>
      <div>
        <div className="text-base font-medium font-display">{title}</div>
        {description && <div className="mt-0.5 text-foreground-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-col gap-x-3 gap-y-2 sm:flex-row md:ml-auto">{actions}</div>}
    </div>
  );
}
