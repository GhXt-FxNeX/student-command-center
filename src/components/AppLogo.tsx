/**
 * The app logo, drawn as a theme-aware CSS mask (see index.html — `.scc-logo`
 * is defined there). Takes its colour from the surrounding text colour, so it
 * is dark on light themes and light on dark ones with no extra assets.
 * Decorative by default; pass `label` when it stands alone.
 */
export function AppLogo({ size = 32, label, className = "" }: { size?: number; label?: string; className?: string }) {
  return (
    <span
      className={`scc-logo ${className}`}
      style={{ "--s": `${size}px` } as React.CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
