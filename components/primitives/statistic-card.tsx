import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/primitives/badge";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type StatisticTrend = "increase" | "decrease";

export interface StatisticCardProps {
  label: ReactNode;
  value: ReactNode;
  changePercentage?: number;
  trend?: StatisticTrend;
  icon?: ReactNode;
  className?: string;
}

/**
 * A dashed-border KPI tile: label, large value and an up/down change badge.
 *
 * @example
 * <StatisticCard label="Registered Users" value="457,204" changePercentage={3} trend="decrease" />
 */
export function StatisticCard({ label, value, changePercentage, trend = "increase", icon, className }: StatisticCardProps) {
  const TrendIcon = trend === "increase" ? ChevronUp : ChevronDown;
  return (
    <div className={mergeClassNames("box relative rounded-box border border-dashed border-line-strong/80 p-5 shadow-xs", className)}>
      {icon}
      <div className="text-base text-foreground-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-medium font-display">{value}</div>
      {changePercentage !== undefined && (
        <div className="absolute inset-y-0 right-0 mr-5 flex flex-col justify-center">
          <Badge tone={trend === "increase" ? "success" : "danger"} icon={<TrendIcon className="ml-px h-4 w-4 stroke-[1.5]" />} className="pr-1">
            {changePercentage}%
          </Badge>
        </div>
      )}
    </div>
  );
}
