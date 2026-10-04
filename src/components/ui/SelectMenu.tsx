import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useFieldLabelId } from "./FormField";

interface MenuOption<T extends string> {
  value: T;
  label: string;
  /** Optional small colored dot before the label — lets a status/priority
   * menu carry the same color coding its list rows already use. */
  dotClassName?: string;
}

/**
 * Same visual language as the rest of the design system (bg-bg/bg-surface,
 * border-border, accent), not a native <select> — so it can actually show
 * a checkmark next to the current value, fit a narrow column without the
 * browser's own dropdown chrome fighting the layout, and get the same
 * fade-in the rest of the app uses.
 *
 * Accessibility: it follows the WAI-ARIA "collapsible dropdown listbox"
 * pattern. The trigger announces as a popup button that is expanded/collapsed
 * and is named "<ariaLabel>, <current value>"; the list is a `listbox` of
 * `option`s. Keyboard: ArrowDown/ArrowUp on the trigger opens it; inside,
 * ArrowUp/ArrowDown/Home/End move, Enter/Space choose, Escape closes and
 * returns focus to the trigger, Tab closes. Also closes on outside click.
 * Pass `ariaLabel` whenever there is no visible label tied to the control.
 */
export function SelectMenu<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  tone = "default",
  disabled = false,
  className = "",
  ariaLabel,
}: {
  options: MenuOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  tone?: "default" | "surface";
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const valueId = useId();
  // The visible label of a surrounding <FormField>, when there is one.
  const fieldLabelId = useFieldLabelId();
  const nameIds = ariaLabel ? labelId : fieldLabelId;
  const listId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Move focus onto the current option when the list opens, so arrow keys
  // work immediately and a screen reader lands on the selected value.
  useEffect(() => {
    if (open) optionRefs.current[selectedIndex]?.focus();
    // Only when it opens; selectedIndex is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function focusOption(i: number) {
    const n = options.length;
    optionRefs.current[((i % n) + n) % n]?.focus();
  }

  function handleTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleListKey(e: KeyboardEvent<HTMLDivElement>) {
    const current = optionRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusOption(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusOption(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusOption(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusOption(options.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const current = options.find((o) => o.value === value);
  const sizeClasses = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";
  const toneClasses = tone === "surface" ? "bg-surface" : "bg-bg";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {ariaLabel && (
        <span id={labelId} className="sr-only">
          {ariaLabel}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={nameIds ? `${nameIds} ${valueId}` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKey}
        className={`w-full flex items-center justify-between gap-2 rounded-md border border-border ${toneClasses} text-left transition-colors hover:border-accent disabled:opacity-40 disabled:pointer-events-none ${sizeClasses}`}
      >
        <span id={valueId} className="flex items-center gap-1.5 min-w-0 truncate">
          {current?.dotClassName && (
            <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${current.dotClassName}`} />
          )}
          {current?.label ?? value}
        </span>
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`shrink-0 text-text-secondary transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : fieldLabelId}
          onKeyDown={handleListKey}
          className="absolute right-0 z-20 mt-1 min-w-full w-max max-w-[220px] rounded-md border border-border bg-surface shadow-lg py-1 animate-fade-slide-in"
        >
          {options.map((opt, i) => (
            <button
              key={opt.value}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors hover:bg-bg focus-visible:bg-bg ${
                opt.value === value ? "text-accent-text font-medium" : "text-text"
              }`}
            >
              {opt.dotClassName && (
                <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${opt.dotClassName}`} />
              )}
              <span className="min-w-0 truncate">{opt.label}</span>
              {opt.value === value && (
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="ml-auto shrink-0">
                  <path
                    d="M2.5 6.5 5 9l4.5-6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
