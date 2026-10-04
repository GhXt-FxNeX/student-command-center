/**
 * Full-window loading screen: the app logo over a spinner.
 *
 * The markup and class names are IDENTICAL to the static splash inside
 * `index.html`'s #root (and the styles live there, inline, because they must
 * exist before any JavaScript or CSS file loads). That is what makes startup
 * seamless: the static one is on screen from the very first frame, then React
 * swaps in this one looking exactly the same. If you change one, change both.
 */
export function SplashScreen({ label = "Loading Student Command Center…" }: { label?: string }) {
  return (
    <div className="scc-splash" role="status">
      <span className="scc-logo" style={{ "--s": "96px" } as React.CSSProperties} role="img" aria-label="Student Command Center" />
      <span className="scc-spinner" aria-hidden="true" />
      <span className="scc-sr">{label}</span>
    </div>
  );
}
