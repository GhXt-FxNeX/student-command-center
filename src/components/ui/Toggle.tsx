import { useId } from "react";

export type ToggleSize = "sm" | "md";

const DIMENSIONS: Record<ToggleSize, { track: string; thumb: string; translate: string }> = {
  sm: { track: "w-[34px] h-[18px]", thumb: "w-[14px] h-[14px]", translate: "translate-x-[16px]" },
  md: { track: "w-[42px] h-[22px]", thumb: "w-[18px] h-[18px]", translate: "translate-x-[20px]" },
};

/**
 * A real `role="switch"` button, not a styled checkbox — sliding thumb,
 * accent when on, neutral border color when off. Bare `<Toggle>` for
 * dense inline contexts (e.g. one per weekday in a class schedule);
 * `<ToggleField>` below pairs it with a label (and optional description)
 * the way the old `<label><input type="checkbox">text</label>` pattern
 * did, since a plain `<label>` doesn't forward clicks to a `<button>`
 * the way it does to a real `<input>`.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  ariaLabel,
  ariaDescribedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: ToggleSize;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}) {
  const dims = DIMENSIONS[size];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none ${dims.track} ${
        checked ? "bg-accent-fill" : "bg-border"
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] rounded-full bg-white shadow-sm transition-transform duration-150 ${dims.thumb} ${
          checked ? dims.translate : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** Toggle + clickable label (+ optional helper caption below it), for the
 * common "a setting with a short name and an explanation" case. */
export function ToggleField({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = "md",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  size?: ToggleSize;
}) {
  const descId = useId();
  return (
    <div className="flex items-start gap-3">
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        size={size}
        ariaLabel={label}
        ariaDescribedBy={description ? descId : undefined}
      />
      {/* A mouse-only click target that widens the hit area to the text. It is
          removed from the tab order and the accessibility tree because the
          switch beside it already carries the name, state and description —
          otherwise keyboard users tab through, and screen readers announce,
          the same control twice. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className="text-left disabled:cursor-default disabled:opacity-40"
      >
        <span className="text-sm block">{label}</span>
        {description && (
          <span id={descId} className="text-xs text-text-secondary block mt-0.5">
            {description}
          </span>
        )}
      </button>
    </div>
  );
}
