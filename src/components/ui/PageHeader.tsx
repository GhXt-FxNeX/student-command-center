import type { ReactNode } from "react";

/**
 * Page width presets. Before this, pages used six different `max-w-*` values
 * (xl, 2xl, 3xl, 4xl, 5xl, 6xl) with no rule. Now there are four, chosen by
 * what the content needs:
 *   narrow   — a single focused widget (Pomodoro)
 *   settings — forms (Settings and its category pages)
 *   default  — list/detail and chart pages (Tasks, Planner, Analytics, …)
 *   wide     — dashboards and grids (Dashboard, Calendar, Spotify)
 */
export type PageSize = "narrow" | "settings" | "default" | "wide";

const SIZE_CLASS: Record<PageSize, string> = {
  narrow: "max-w-xl",
  settings: "max-w-2xl",
  default: "max-w-4xl",
  wide: "max-w-6xl",
};

/** The standard page wrapper: padding, centered width, vertical rhythm
 * (`space-y-6` everywhere) and the entrance animation. */
export function PageContainer({
  size = "default",
  className = "",
  children,
}: {
  size?: PageSize;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`p-6 ${SIZE_CLASS[size]} mx-auto space-y-6 animate-fade-slide-in ${className}`}>{children}</div>;
}

/**
 * Title row. The description is OPTIONAL and most pages omit it on purpose
 * (an explicit earlier request: no restated explanation under the title);
 * Settings category pages use it. `actions` sits right-aligned.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
      </div>
      {/* Wraps under the title on a narrow window instead of overflowing. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
