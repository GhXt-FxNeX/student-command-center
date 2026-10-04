/**
 * Preset profile icons. The chosen `id` is what gets saved
 * (`UserSettings.profileIcon`); the glyph and colour live here, so they can be
 * restyled or extended without a migration. Ids are lowercase slugs — the Rust
 * side validates that shape (commands/settings.rs) and nothing more, so an id
 * removed from this list later just falls back to the name's initial.
 */
export interface AvatarPreset {
  id: string;
  /** Accessible name — also the tooltip. */
  label: string;
  glyph: string;
  /** Tint used for the circle's fill (low alpha) and ring. */
  color: string;
}

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: "stethoscope", label: "Stethoscope", glyph: "🩺", color: "#14b8a6" },
  { id: "brain", label: "Brain", glyph: "🧠", color: "#ec4899" },
  { id: "heart", label: "Heart", glyph: "🫀", color: "#ef4444" },
  { id: "bone", label: "Bone", glyph: "🦴", color: "#a8a29e" },
  { id: "microscope", label: "Microscope", glyph: "🔬", color: "#6366f1" },
  { id: "dna", label: "DNA", glyph: "🧬", color: "#8b5cf6" },
  { id: "pill", label: "Pill", glyph: "💊", color: "#f97316" },
  { id: "books", label: "Books", glyph: "📚", color: "#3b82f6" },
  { id: "graduation-cap", label: "Graduation cap", glyph: "🎓", color: "#0ea5e9" },
  { id: "rocket", label: "Rocket", glyph: "🚀", color: "#f43f5e" },
  { id: "owl", label: "Owl", glyph: "🦉", color: "#d97706" },
  { id: "dragon", label: "Dragon", glyph: "🐉", color: "#16a34a" },
  { id: "fox", label: "Fox", glyph: "🦊", color: "#ea580c" },
  { id: "moon", label: "Moon", glyph: "🌙", color: "#6366f1" },
  { id: "lightning", label: "Lightning", glyph: "⚡", color: "#eab308" },
  { id: "coffee", label: "Coffee", glyph: "☕", color: "#92400e" },
];

export function findAvatar(id: string | null | undefined): AvatarPreset | null {
  return AVATAR_PRESETS.find((a) => a.id === id) ?? null;
}

/** First letter of the first word, uppercased; "?" when there is no name. */
export function initialOf(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}
