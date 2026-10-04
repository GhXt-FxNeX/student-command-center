import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { passwordStrength } from "./journalUtils";
import { EyeIcon, EyeOffIcon } from "./icons";

/** Password input with a show/hide toggle. `!pr-10` (important) rather than
 * a plain `pr-10` because Input already sets horizontal padding — same
 * one-off-override rule documented in engineering-notes. */
export function PasswordField({
  value,
  onChange,
  placeholder,
  label,
  autoFocus = false,
  disabled = false,
  autoComplete = "off",
  focusSignal = 0,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  /** Bump this number to move focus back into the field (e.g. after a
   * failed attempt cleared it). Input has no forwardRef, so this goes
   * through a wrapper instead of a ref on the input itself. */
  focusSignal?: number;
}) {
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSignal > 0) wrapRef.current?.querySelector("input")?.focus();
  }, [focusSignal]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete={autoComplete}
        className="w-full !pr-10 disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text hover:bg-surface transition-colors disabled:opacity-40"
      >
        {visible ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
      </button>
    </div>
  );
}

const LEVEL_COLOR = ["bg-border", "bg-red-500", "bg-amber-500", "bg-emerald-500"] as const;

/** Three-segment advisory strength meter (see `passwordStrength`). */
export function StrengthMeter({ password }: { password: string }) {
  const { level, label } = passwordStrength(password);
  if (level === 0) return null;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3].map((seg) => (
          <span
            key={seg}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${seg <= level ? LEVEL_COLOR[level] : "bg-border"}`}
          />
        ))}
      </div>
      <span className="text-xs text-text-secondary whitespace-nowrap">{label}</span>
    </div>
  );
}
