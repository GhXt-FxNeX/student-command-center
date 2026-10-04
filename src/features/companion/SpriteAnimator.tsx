import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AssetManifest, ClipDef } from "@/types";

/**
 * Plays a single named clip for a given species/stage, driven entirely by
 * the asset manifest. Adding a new creature, stage, or animation is a data
 * change (manifest.json + sprite files) — this component never hardcodes a
 * creature or clip name.
 *
 * Missing-asset handling (architecture.md A5): if the requested clip isn't
 * in the manifest, or its file wasn't found on disk (reported via
 * manifest.missingFiles), this falls back to the stage's "idle" clip. If
 * even idle is unavailable, it renders a visible placeholder tile instead
 * of nothing — a companion must never appear to just vanish.
 */
export function SpriteAnimator({
  manifest,
  speciesId,
  stage,
  clip,
  size = 96,
  devMode = import.meta.env.DEV,
  reducedMotion = false,
}: {
  manifest: AssetManifest | null;
  speciesId: string;
  stage: string;
  clip: string;
  size?: number;
  devMode?: boolean;
  /** Freezes on the clip's first frame instead of cycling — passed down
   * from usePrefersReducedMotion() by callers, per
   * future_enhancement.md §2's "Respect reduced-motion settings." */
  reducedMotion?: boolean;
}) {
  const [frame, setFrame] = useState(0);

  const species = manifest?.species.find((s) => s.id === speciesId);
  const stageClips = species?.stages[stage];

  let resolvedClipName = clip;
  let clipDef: ClipDef | undefined = stageClips?.[clip];
  const requestedMissing = !clipDef;

  // "evolution"/"level_up" are more specific overrides of "celebration"
  // (moodClip.ts's clipForCompanionState) — a pack that only bothered with
  // a generic celebration.png should still get *that* on an actual level-up
  // or evolution, not fall all the way through to idle just because it
  // doesn't have the more specific file too.
  if (!clipDef && (clip === "evolution" || clip === "level_up") && stageClips?.celebration) {
    clipDef = stageClips.celebration;
    resolvedClipName = "celebration";
  }

  if (!clipDef && stageClips?.idle) {
    clipDef = stageClips.idle;
    resolvedClipName = "idle";
  }

  const sheetPath = clipDef
    ? species?.source === "custom"
      ? convertFileSrc(clipDef.sheet) // absolute native path -> asset:// URL
      : `/companions/${clipDef.sheet}`
    : null;
  const fileKnownMissing = clipDef ? manifest?.missingFiles.includes(clipDef.sheet) : false;

  useEffect(() => {
    setFrame(0);
    if (!clipDef || clipDef.frames <= 1 || reducedMotion) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % clipDef!.frames);
    }, 1000 / Math.max(1, clipDef.fps));
    return () => clearInterval(interval);
  }, [clipDef, reducedMotion]);

  if (!clipDef || fileKnownMissing) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-md border border-dashed border-border bg-bg text-center"
        title={`Missing companion asset: ${speciesId}/${stage}/${clip}`}
      >
        {devMode ? (
          <span className="text-[10px] text-text-secondary px-1 leading-tight">
            🖼 missing
            <br />
            {stage}/{clip}
          </span>
        ) : (
          <span className="text-2xl">🥚</span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${sheetPath}")`,
        backgroundPosition: `-${frame * size}px 0`,
        backgroundSize: `${(clipDef.frames || 1) * size}px ${size}px`,
        backgroundRepeat: "no-repeat",
        // Pixel-art packs need nearest-neighbor scaling to stay crisp —
        // smooth/bilinear (the browser default, left unset here) blurs
        // intentionally sharp pixel edges. Painted/illustrated packs want
        // the opposite, so this is per-species (manifest.json's
        // "pixelArt"), not a global choice.
        imageRendering: species?.pixelArt ? "pixelated" : undefined,
      }}
      className="rounded-md"
      title={
        requestedMissing
          ? `"${clip}" clip not available for ${stage} yet — showing ${resolvedClipName} instead`
          : resolvedClipName
      }
    />
  );
}
