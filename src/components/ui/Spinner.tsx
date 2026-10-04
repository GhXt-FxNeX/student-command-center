/** Indeterminate spinner. Decorative (aria-hidden): pair it with visible
 * text, or use <LoadingState>, so the loading is announced exactly once. */
export function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`animate-spin motion-reduce:animate-none ${className}`}
    >
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" opacity="0.25" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The app's standard "something is loading" block for areas where a
 * skeleton of the final layout would be misleading or overkill (brief §20:
 * "do not overuse skeletons where a simple progress indicator is better").
 * `role="status"` makes assistive tech announce the message politely.
 */
export function LoadingState({ message = "Loading…", className = "py-10" }: { message?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 text-sm text-text-secondary ${className}`}>
      <Spinner className="w-4 h-4" />
      <span>{message}</span>
    </div>
  );
}
