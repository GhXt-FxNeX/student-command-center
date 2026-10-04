/** A single animated placeholder bar for a value that's still loading —
 * used in place of a bare "…" so stat cards feel intentional while
 * waiting on a query rather than showing plain text. */
export function SkeletonBar({ className = "h-6 w-12" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block rounded bg-border animate-pulse motion-reduce:animate-none ${className}`} />;
}
