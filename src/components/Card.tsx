import type { ReactNode, MouseEventHandler, KeyboardEvent } from "react";

export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  // A clickable card is a button in all but name. A bare <div onClick> can't be
  // reached or activated from the keyboard, so when a handler is supplied the
  // card gets button semantics and Enter/Space support.
  const interactive = onClick
    ? {
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.currentTarget.click();
          }
        },
      }
    : {};
  return (
    <div
      className={`rounded-card border border-border bg-surface p-4 ${className}`}
      onClick={onClick}
      {...interactive}
    >
      {children}
    </div>
  );
}

/**
 * The app's standard empty state. Per the design brief it should say what is
 * empty, why it matters, and what to do next, so beyond `title` it takes an
 * optional `icon`, a `description` (the "why"), and an `action` (the "next":
 * a button or link). With only a title it renders exactly as it always did.
 * `compact` trims the padding for an empty state inside a small card.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center text-text-secondary ${compact ? "py-6" : "py-10"}`}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="mb-3 w-11 h-11 rounded-full bg-accent-soft text-accent-text flex items-center justify-center"
        >
          {icon}
        </span>
      )}
      <p className="font-medium text-text">{title}</p>
      {description && <p className="text-sm mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
