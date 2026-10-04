import { useEffect, useRef, useState } from "react";
import { SpriteAnimator } from "./SpriteAnimator";
import { CompanionStatBars } from "./CompanionStatBars";
import { dialogueFor } from "./dialogue";
import { clipForCompanionState } from "./moodClip";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { AssetManifest, CompanionState } from "@/types";
import { FieldMessage } from "@/components/ui/Callout";

/**
 * Application-wide persistent companion (future_enhancement.md §2).
 *
 * Rendered once from Shell.tsx, as a sibling of the nav rail and `main`
 * rather than nested inside either — importantly, NOT inside the nav
 * panel's `transition-transform` subtree. CSS transforms create a new
 * containing block for `position: fixed` descendants, which would silently
 * turn this into a scroll-with-content element pinned to the (usually
 * off-screen) nav panel instead of the viewport corner. Being a sibling of
 * that subtree keeps `fixed` anchored to the viewport as intended, in every
 * nav state (collapsed/hovering/pinned) and every route. This positioning
 * is deliberately untouched by the Phase 14 §14 modernization pass below —
 * it's already correct and already the subject of this comment.
 *
 * Bottom-right placement keeps it clear of the nav rail/hamburger
 * (top-left) and of every page's own content, per §2's "float away from
 * navigation controls" / "never obstruct important controls."
 */
export function FloatingCompanion({
  state,
  manifest,
  error,
  sizePx = 80,
}: {
  state: CompanionState | null;
  manifest: AssetManifest | null;
  error: string | null;
  /** Bubble diameter in px (Settings > Companion > Bubble size, 48-160).
   * A display preference only — the companion's actual sprite resolution
   * never changes, so a bigger bubble doesn't mean better source art,
   * just a bigger frame around the same art (see SpriteAnimator's
   * pixelArt rendering mode for how pixel-art packs stay crisp at any
   * size; painted/illustrated packs will always soften somewhat when
   * scaled well past their native resolution — that's an inherent raster
   * limit, not something this prop can work around). */
  sizePx?: number;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Achievement reaction: a one-shot ring + label, derived from real
  // before/after state (level went up, or the stage changed) rather than
  // celebrationTrigger's string value — the trigger stays "level_up" (say)
  // across two separate level-ups in a row, so comparing it to its own
  // previous value would miss the second one. Comparing the actual level/
  // stage numbers catches every real occurrence, exactly once each.
  const prevLevelRef = useRef<number | null>(null);
  const prevStageRef = useRef<string | null>(null);
  const [burst, setBurst] = useState<"level_up" | "evolution" | null>(null);

  useEffect(() => {
    if (!state) return;
    const prevLevel = prevLevelRef.current;
    const prevStage = prevStageRef.current;
    prevLevelRef.current = state.level;
    prevStageRef.current = state.currentStage;
    // First state this bubble has ever seen — nothing "just happened" yet,
    // and the app only mounts this once per session, so this only skips
    // real startup, never a route change.
    if (prevLevel === null || prevStage === null) return;

    let kind: "level_up" | "evolution" | null = null;
    if (state.currentStage !== prevStage) kind = "evolution";
    else if (state.level > prevLevel) kind = "level_up";
    if (!kind) return;

    setBurst(kind);
    const t = setTimeout(() => setBurst(null), 1000);
    return () => clearTimeout(t);
  }, [state?.level, state?.currentStage]);

  // Close on outside click / Escape — a floating always-on-top element that
  // only closes via its own tiny toggle would be an accessibility trap.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Quiet during the brief startup window before the first IPC round-trip
  // resolves — popping in once real state arrives beats a placeholder
  // flashing on every route change.
  if (!state && !error) return null;

  const clip = state ? clipForCompanionState(state) : "idle";
  const celebrating = state?.mood === "celebrating";
  // Same ratios the original fixed 80px/64px/30px bubble used, just
  // computed relative to sizePx instead of hardcoded — a bit of padding
  // around the sprite inside the bubble, and a proportional fallback icon.
  const spriteSizePx = Math.round(sizePx * 0.8);
  const fallbackFontSizePx = Math.round(sizePx * 0.375);

  return (
    <div ref={containerRef} className="fixed bottom-4 right-4 z-30">
      {open && (
        <div
          className={`absolute bottom-full right-0 mb-2 w-60 rounded-card border border-border bg-surface p-3 shadow-xl animate-fade-slide-in`}
          aria-label={state ? `${state.name} status` : "Companion status"}
        >
          {error && (
            <FieldMessage>Companion unavailable: {error}</FieldMessage>
          )}
          {state && (
            <>
              <div className="flex items-baseline justify-between">
                <p className="font-medium truncate">{state.name}</p>
                <span className="text-xs text-text-secondary">Lv {state.level}</span>
              </div>
              <p className="text-xs text-text-secondary capitalize">
                {state.currentStage.replace("_", "-")} · {state.mood}
              </p>
              <p className="text-xs text-text-secondary italic mt-1">“{dialogueFor(state.mood)}”</p>
              <div className="mt-2">
                <CompanionStatBars state={state} />
              </div>
            </>
          )}
        </div>
      )}

      {burst && (
        <p
          aria-live="polite"
          className="absolute bottom-full right-0 mb-1 whitespace-nowrap rounded-full bg-accent-fill text-white text-xs font-medium px-2.5 py-1 shadow-md pointer-events-none motion-safe:animate-fade-slide-in"
        >
          {burst === "evolution" ? "Evolved! ✨" : "Level up! 🎉"}
        </p>
      )}

      <div className="relative" style={{ width: sizePx, height: sizePx }}>
        {burst && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-accent motion-safe:animate-companion-celebrate-ring"
          />
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={
            state
              ? `${state.name}, level ${state.level}, ${state.mood} — open companion status`
              : "Companion status unavailable"
          }
          title={state ? state.name : "Companion unavailable"}
          style={{ width: sizePx, height: sizePx }}
          className={`relative flex items-center justify-center rounded-full border border-border bg-surface shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100`}
        >
          {state ? (
            <span
              key={clip}
              className={`flex items-center justify-center motion-safe:animate-companion-mood-in ${
                celebrating ? "" : "motion-safe:animate-companion-bob"
              }`}
            >
              <SpriteAnimator
                manifest={manifest}
                speciesId={state.speciesSlug}
                stage={state.currentStage}
                clip={clip}
                size={spriteSizePx}
                reducedMotion={reducedMotion}
              />
            </span>
          ) : (
            <span style={{ fontSize: fallbackFontSizePx }} aria-hidden="true">
              🥚
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
