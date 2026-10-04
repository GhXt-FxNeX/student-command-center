import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useFieldLabelId } from "./FormField";

export type FieldSize = "sm" | "md";
export type FieldTone = "default" | "surface";

const FIELD_BASE = "rounded-md border border-border text-sm transition-colors focus:border-accent";

// Padding and background both vary by call site (a prominent standalone
// field vs. a compact grid cell; a field sitting directly on the page
// background vs. one nested inside an already-bg-bg bordered box) — kept
// as explicit props rather than letting callers pass a conflicting
// py-*/bg-* via className, since two utilities for the same CSS property
// resolve in whatever order Tailwind's build happens to emit them, not
// the order they appear in the class string.
const SIZE_CLASSES: Record<FieldSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-3 py-2",
};

const TONE_CLASSES: Record<FieldTone, string> = {
  default: "bg-bg",
  surface: "bg-surface",
};

// Omit the DOM's own numeric `size` attribute: this component's `size` is
// the "sm" | "md" padding variant, and the two types can't coexist (TS2430).
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: FieldSize;
  tone?: FieldTone;
}

export function Input({ size = "md", tone = "default", className = "", ...rest }: InputProps) {
  // Named by the surrounding <FormField>'s label unless the caller named it.
  const fieldLabel = useFieldLabelId();
  const labelledBy = rest["aria-label"] || rest["aria-labelledby"] ? undefined : fieldLabel;
  return (
    <input
      aria-labelledby={labelledBy}
      className={`${FIELD_BASE} ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
      {...rest}
    />
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: FieldSize;
  tone?: FieldTone;
}

export function Select({ size = "md", tone = "default", className = "", children, ...rest }: SelectProps) {
  const fieldLabel = useFieldLabelId();
  const labelledBy = rest["aria-label"] || rest["aria-labelledby"] ? undefined : fieldLabel;
  return (
    <select
      aria-labelledby={labelledBy}
      className={`${FIELD_BASE} ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: FieldSize;
  tone?: FieldTone;
}

/** Same field styling as `Input`, for multi-line text. Vertical-resize
 * only so a user can't drag it wider than its container. */
export function Textarea({ size = "md", tone = "default", className = "", ...rest }: TextareaProps) {
  const fieldLabel = useFieldLabelId();
  const labelledBy = rest["aria-label"] || rest["aria-labelledby"] ? undefined : fieldLabel;
  return (
    <textarea
      aria-labelledby={labelledBy}
      className={`${FIELD_BASE} ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} resize-y ${className}`}
      {...rest}
    />
  );
}
