import type { CompanionState } from "@/types";
import { ProgressBar } from "@/components/ui/ProgressBar";

export function CompanionStatBars({ state }: { state: CompanionState }) {
  const progress =
    state.xpForNextLevel && state.xpForNextLevel > 0
      ? Math.min(100, Math.round((state.xp / state.xpForNextLevel) * 100))
      : 100;

  return (
    <div className="space-y-1.5">
      <div>
        <div className="flex items-center justify-between text-xs text-text-secondary mb-0.5">
          <span>XP</span>
          <span>{state.xpForNextLevel ? `${state.xp} / ${state.xpForNextLevel}` : "Max level"}</span>
        </div>
        <ProgressBar pct={progress} />
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-text-secondary mb-0.5">
          <span>Happiness</span>
          <span>{state.happiness}/100</span>
        </div>
        <ProgressBar pct={state.happiness} fillClassName="bg-pink-400" />
      </div>
    </div>
  );
}
