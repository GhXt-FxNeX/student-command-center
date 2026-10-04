import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A round, bordered, icon-only button (the prev/next chevrons on Calendar and
 * Finances were four hand-rolled copies of this). `label` is REQUIRED, so an
 * icon-only button can't be written without an accessible name: it becomes
 * both the `aria-label` (what a screen reader says) and the `title` (the
 * tooltip sighted mouse users get). The icon child should be decorative.
 */
export function IconButton({
  label,
  children,
  className = "",
  type = "button",
  ...rest
}: { label: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title" | "children">) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`w-8 h-8 rounded-full border border-border text-text-secondary flex items-center justify-center transition-all duration-150 hover:bg-bg hover:text-text active:scale-90 disabled:opacity-40 disabled:pointer-events-none ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
