interface ColorSwatchInputProps {
  value: string;
  onChange: (hex: string) => void;
  /** Accessible name. The swatch has no visible text, so this is required. */
  ariaLabel: string;
  className?: string;
}

/**
 * A compact round colour picker for forms where a full-width `<input
 * type="color">` wastes a whole grid cell (category colour in Finance).
 *
 * The native colour input is kept — it still opens the OS colour panel and
 * stays keyboard-accessible — but it is laid invisibly over a 38px circle
 * painted with the chosen colour, so the control is exactly as big as the
 * information it carries. It is a plain <div>, never a <label> (see the
 * FormField note about labels forwarding clicks).
 *
 * The 38px height matches `Input`'s `md` height (py-2 + text-sm + 1px border)
 * closely enough to sit on the same baseline as neighbouring fields.
 */
export function ColorSwatchInput({ value, onChange, ariaLabel, className = "" }: ColorSwatchInputProps) {
  return (
    <div
      className={`relative h-[38px] w-[38px] shrink-0 rounded-full border border-border shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-accent-text hover:shadow ${className}`}
      style={{ background: value }}
    >
      <input
        type="color"
        aria-label={ariaLabel}
        title={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
      />
    </div>
  );
}
