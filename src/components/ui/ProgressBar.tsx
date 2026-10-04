/**
 * The app's one "percent of something" bar (it replaces three near-identical
 * local copies in Finances, Study Analytics and the Companion stat bars —
 * same 1.5-unit track, same animated fill, now one definition).
 *
 * `pct` is clamped to 0–100 here so callers can't overflow the track. Pass
 * `label` when the bar isn't already described by adjacent text: it becomes
 * a real progressbar for screen readers. Without a label it is decorative
 * (aria-hidden) because the value is always printed next to it.
 */
export function ProgressBar({
  pct,
  tone = "accent",
  fillClassName,
  label,
  className = "",
}: {
  pct: number;
  tone?: "accent" | "danger";
  /** Overrides the tone's fill (e.g. the Companion's pink happiness bar). */
  fillClassName?: string;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const fill = fillClassName ?? (tone === "danger" ? "bg-red-500" : "bg-accent");
  const a11y = label
    ? { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(clamped) }
    : { "aria-hidden": true };
  return (
    <div className={`h-1.5 rounded-full bg-border overflow-hidden ${className}`} {...a11y}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${fill}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
