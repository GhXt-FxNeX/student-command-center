interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A single bordered track (bg-bg) holding all options, with the active one
 * rendered as a raised bg-surface pill (shadow-sm) inside it — replaces the
 * old pattern of several separately-bordered buttons sitting side by side
 * with gaps between them (still used pre-modernization for Theme, AI
 * routing mode, etc.).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** Names the group for screen readers ("Theme", "Time range", …). The
   * buttons alone only say "Day", "Week" — with no hint of what they choose. */
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex rounded-md border border-border bg-bg p-0.5 gap-0.5 ${className}`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`rounded-[5px] px-3 py-1.5 text-sm transition-all duration-150 ${
            value === opt.value
              ? "bg-surface text-accent-text shadow-sm font-medium"
              : "text-text-secondary hover:text-text"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
