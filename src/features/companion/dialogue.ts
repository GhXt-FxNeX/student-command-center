import type { CompanionMood } from "@/types";

/**
 * Small, fixed set of lines per mood. Deliberately templated/deterministic —
 * no AI call, consistent with "AI must not compute core companion state"
 * (architecture.md §A1/§40 precedent). Picking a line can use simple
 * rotation later; v1 just uses the first line per mood.
 */
const LINES: Record<CompanionMood, string[]> = {
  celebrating: ["Yes! Look what we did!", "Level up! I can feel it!"],
  excited: ["That was amazing!", "I'm so proud of that one!"],
  proud: ["We're building something real here.", "Consistency looks good on you."],
  happy: ["Good to see you.", "Ready when you are."],
  neutral: ["Hey.", "Let's get something done today."],
  sleepy: ["...it's been a while, huh?", "*yawn* I'll be here when you're back."],
  worried: ["Everything okay? We can catch up.", "No rush — pick back up whenever."],
  sad: ["I miss our study sessions.", "Come back soon?"],
};

export function dialogueFor(mood: CompanionMood): string {
  return LINES[mood][0];
}
