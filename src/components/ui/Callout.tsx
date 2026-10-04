import type { ReactNode } from "react";
import { Button } from "./Button";

export type CalloutTone = "info" | "warning" | "error" | "success";

// Unlike the older `border-red-300 bg-red-50 text-red-700` cards used on a
// few pages (light-mode-only — bg-red-50 is a bright pink slab in dark
// mode), these use translucent tints plus an explicit dark: text color, so
// each tone reads correctly under both themes. The info tone uses only the
// theme's own tokens (no `/alpha` modifier, which Tailwind can't apply to a
// CSS-variable color like accent).
const TONE_CLASSES: Record<CalloutTone, string> = {
  info: "border-border bg-accent-soft text-text",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  error: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
};

function ToneIcon({ tone }: { tone: CalloutTone }) {
  const common = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (tone === "success") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="7.2" {...stroke} />
        <path d="M6.8 10.3l2.2 2.2 4.3-4.6" {...stroke} />
      </svg>
    );
  }
  if (tone === "info") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="7.2" {...stroke} />
        <path d="M10 9.2v4.2" {...stroke} />
        <circle cx="10" cy="6.6" r="0.5" fill="currentColor" {...stroke} />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M10 3.4 17.2 16H2.8L10 3.4Z" {...stroke} />
      <path d="M10 8.4v3.6" {...stroke} />
      <circle cx="10" cy="14" r="0.5" fill="currentColor" {...stroke} />
    </svg>
  );
}

/**
 * The shared status message: what happened (`title`), the detail or next
 * step (`children`), and an optional action (e.g. "Try again"). Errors are
 * announced to screen readers (role="alert"); the other tones are polite.
 */
export function Callout({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: CalloutTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      <span className="mt-0.5 shrink-0">
        <ToneIcon tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={`${title ? "mt-0.5 " : ""}text-xs opacity-90 break-words`}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const FIELD_TONE: Record<"error" | "success" | "hint", string> = {
  error: "text-red-700 dark:text-red-400",
  success: "text-emerald-700 dark:text-emerald-400",
  hint: "text-text-secondary",
};

/**
 * A one-line message under a field or button: a validation error, a
 * "saved" confirmation, or a hint. It replaces ~20 ad-hoc
 * `<p className="text-xs text-red-600">` lines, which were low contrast on
 * the dark theme and were never announced to screen readers. Errors are
 * `role="alert"` (assertive), everything else `role="status"` (polite).
 */
export function FieldMessage({
  tone = "error",
  children,
  className = "",
}: {
  tone?: "error" | "success" | "hint";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`text-xs ${FIELD_TONE[tone]} ${className}`}>
      {children}
    </p>
  );
}

/**
 * The standard page-level error: what happened (the message, shown verbatim
 * so nothing useful is hidden), and what to do — Reload re-fetches the
 * page's data, Dismiss clears it. Replaces nine hand-rolled
 * `<Card className="border-red-300 bg-red-50 ...">` blocks, which were
 * light-mode-only (a pale pink slab in dark mode), had no retry, and were
 * not announced to screen readers. (They also fought `Card`'s own `bg-surface`
 * for the same CSS property, so which background won depended on stylesheet
 * order.)
 */
export function ErrorBanner({
  message,
  title = "Something went wrong",
  onReload,
  onDismiss,
  className = "",
}: {
  message: string;
  title?: string;
  onReload?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <Callout
      tone="error"
      title={title}
      className={className}
      action={
        onReload || onDismiss ? (
          <div className="flex items-center gap-2">
            {onReload && (
              <Button variant="secondary" onClick={onReload}>
                Reload
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <span className="whitespace-pre-wrap">{message}</span>
    </Callout>
  );
}
