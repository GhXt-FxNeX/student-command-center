import { findAvatar, initialOf } from "./avatars";

/**
 * The user's avatar: their chosen preset on a tinted circle, or — when none is
 * chosen (or the saved id no longer exists) — the first letter of their name
 * on the accent colour, so it is never blank.
 */
export function ProfileAvatar({
  iconId,
  name,
  size = 32,
  className = "",
}: {
  iconId: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const preset = findAvatar(iconId);
  const common = {
    width: size,
    height: size,
    fontSize: Math.round(size * (preset ? 0.52 : 0.46)),
  };
  if (!preset) {
    return (
      <span
        aria-hidden="true"
        style={common}
        className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-text ${className}`}
      >
        {initialOf(name)}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...common, background: `${preset.color}26`, boxShadow: `inset 0 0 0 1.5px ${preset.color}73` }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full leading-none ${className}`}
    >
      {preset.glyph}
    </span>
  );
}
