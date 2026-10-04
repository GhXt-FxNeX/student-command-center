import type { ReactNode } from "react";
import { Card } from "@/components/Card";

/**
 * The large stat card (label + icon badge on top, the value fully BELOW so
 * the two can never overlap — a real bug fixed earlier). Finances and Exams
 * each had a byte-identical private copy; this is the single definition.
 * The Dashboard's smaller secondary `StatCell` is intentionally a different
 * density and stays separate.
 */
export function StatCard({
  label,
  value,
  valueClassName = "",
  icon,
  iconClassName,
  sub,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  icon: ReactNode;
  /** Badge fill + icon color, e.g. `TONE_BADGE.success`. */
  iconClassName: string;
  sub?: ReactNode;
}) {
  return (
    <Card className="transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-text-secondary text-sm truncate">{label}</p>
        <span aria-hidden="true" className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${iconClassName}`}>
          {icon}
        </span>
      </div>
      <p className={`text-2xl font-semibold mt-2 ${valueClassName}`}>{value}</p>
      {sub}
    </Card>
  );
}
