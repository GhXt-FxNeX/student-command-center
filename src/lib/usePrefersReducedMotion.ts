import { useEffect, useState } from "react";

/**
 * Tailwind's `motion-reduce:`/`motion-safe:` variants (already used in
 * Shell.tsx for the nav panel's slide transition) cover CSS transitions and
 * animations for free, but they can't reach JS-driven loops like
 * SpriteAnimator's `setInterval` frame stepper — that has to check the
 * media query itself and freeze on a single frame. This hook is the one
 * place that reads `prefers-reduced-motion`, kept generic (not
 * companion-specific) so anything else that animates via JS later can
 * reuse it instead of re-querying the media query itself.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
