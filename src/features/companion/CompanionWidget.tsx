import { Card } from "@/components/Card";
import { SpriteAnimator } from "./SpriteAnimator";
import { CompanionStatBars } from "./CompanionStatBars";
import { dialogueFor } from "./dialogue";
import { clipForCompanionState } from "./moodClip";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { AssetManifest, CompanionState } from "@/types";
import { Callout } from "@/components/ui/Callout";
import { LoadingState } from "@/components/ui/Spinner";

/**
 * Dashboard-only detailed companion card. As of Phase 14 Item 3 this no
 * longer owns its own `useCompanion()` subscription — the live state is
 * lifted to App.tsx and shared with the global FloatingCompanion (rendered
 * from Shell) so there's exactly one IPC listener for companion updates,
 * not one per place the companion is drawn on screen.
 */
export function CompanionWidget({
  state,
  manifest,
  error,
}: {
  state: CompanionState | null;
  manifest: AssetManifest | null;
  error: string | null;
}) {
  const reducedMotion = usePrefersReducedMotion();

  if (error) {
    return (
      <Callout tone="error" title="Companion unavailable">
        {error}
      </Callout>
    );
  }

  if (!state) {
    return (
      <Card>
        <LoadingState message="Loading companion…" className="py-3" />
      </Card>
    );
  }

  const clip = clipForCompanionState(state);

  return (
    <Card className="animate-fade-slide-in transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0">
      <div className="flex items-center gap-3">
        {/* A framed circle rather than the bare sprite sitting flat against
         * the card — gives it its own visual identity as a character,
         * matching the floating bubble's own plain circular frame. */}
        <span className="shrink-0 flex items-center justify-center w-[88px] h-[88px] rounded-full border border-border bg-bg">
          <span key={clip} className="flex items-center justify-center motion-safe:animate-companion-mood-in">
            <SpriteAnimator
              manifest={manifest}
              speciesId={state.speciesSlug}
              stage={state.currentStage}
              clip={clip}
              size={72}
              reducedMotion={reducedMotion}
            />
          </span>
        </span>
        <div className="min-w-0 flex-1">
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
        </div>
      </div>
    </Card>
  );
}
