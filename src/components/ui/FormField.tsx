import { createContext, useContext, useId, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Carries the id of the surrounding <FormField>'s visible label down to the
 * control inside it. `Input`, `Select`, `Textarea` and `SelectMenu` read it
 * and expose it as `aria-labelledby`, so the label really names the control.
 */
export const FieldLabelContext = createContext<string | undefined>(undefined);

/** For the primitives: the label id to use, unless the caller already named it. */
export function useFieldLabelId(): string | undefined {
  return useContext(FieldLabelContext);
}

/**
 * A field with a small visible label that is programmatically tied to the
 * control inside it. Used where a bare control is ambiguous to EVERYONE — a
 * date box that doesn't say "deadline", a menu that just shows "Medium" —
 * not only to assistive tech. Text inputs that already carry a descriptive
 * placeholder get an `aria-label` instead and keep their look.
 *
 * Deliberately NOT a `<label>` wrapper. A `<label>` forwards any click inside
 * it to its labelled control, and `SelectMenu` is built from buttons: picking
 * an option made the browser re-click the trigger, so the menu closed and
 * instantly reopened. Association is done with `aria-labelledby` instead, and
 * clicking the label text just moves focus to the control (never activates
 * it).
 *
 * The `[&_input]:w-full` etc. keep wrapped controls stretching to their grid
 * cell exactly as they did when they were the grid items themselves; `Input`
 * has no width of its own.
 */
export function FormField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <FieldLabelContext.Provider value={id}>
      <div ref={wrapRef} className={`block [&_input]:w-full [&_select]:w-full [&_textarea]:w-full ${className}`}>
        <span
          id={id}
          className="block text-xs text-text-secondary mb-1"
          onClick={() => wrapRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus()}
        >
          {label}
        </span>
        {children}
      </div>
    </FieldLabelContext.Provider>
  );
}
