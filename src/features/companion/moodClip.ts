import type { CompanionMood, CompanionState } from "@/types";

// Maps each of the 8 moods to one of the animation clip names in the asset
// manifest (architecture.md A5/A4). "proud" and "worried" get their own
// clips rather than reusing "happy"/"sad" — draw them whenever there's art;
// SpriteAnimator already falls back to "idle" gracefully for any clip a
// pack hasn't supplied, so leaving them unpainted for now costs nothing.
const MOOD_TO_CLIP: Record<CompanionMood, string> = {
  celebrating: "celebration",
  excited: "excited",
  proud: "proud",
  happy: "happy",
  neutral: "idle",
  sleepy: "sleep",
  worried: "worried",
  sad: "sad",
};

export function clipForMood(mood: CompanionMood): string {
  return MOOD_TO_CLIP[mood];
}

/**
 * The clip to actually play for a given companion state — prefers the
 * one-shot "evolution"/"level_up" clip over the generic "celebration"
 * fallback when the backend says one of those specifically just happened
 * (CompanionState.celebrationTrigger, migration 0020). Every caller that
 * used to do `clipForMood(state.mood)` should use this instead so the
 * one-shot clips actually get used; clipForMood() alone has no way to see
 * celebrationTrigger.
 */
export function clipForCompanionState(state: CompanionState): string {
  if (state.mood === "celebrating" && state.celebrationTrigger) {
    return state.celebrationTrigger === "evolution" ? "evolution" : "level_up";
  }
  return clipForMood(state.mood);
}
