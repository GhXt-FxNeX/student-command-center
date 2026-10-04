import { AVATAR_PRESETS } from "./avatars";
import { ProfileAvatar } from "./ProfileAvatar";

/**
 * A grid of the preset avatars, built as a proper radio group: one tab stop,
 * arrow keys move the selection, and each option is named ("Owl") for screen
 * readers. Used by onboarding and Settings → General.
 */
export function ProfileIconPicker({
  value,
  name,
  onChange,
  disabled = false,
}: {
  value: string;
  name: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selectedIndex = AVATAR_PRESETS.findIndex((a) => a.id === value);
  // Roving tabindex: the selected option is the tab stop, or the first one
  // when nothing is selected yet.
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const cols = 8;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    const delta = moves[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(AVATAR_PRESETS.length - 1, index + delta));
    onChange(AVATAR_PRESETS[next].id);
    const el = e.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
    el?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Profile icon" className="grid grid-cols-8 gap-2">
      {AVATAR_PRESETS.map((a, index) => {
        const selected = a.id === value;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={a.label}
            title={a.label}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(a.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`rounded-full p-0.5 transition-all duration-150 hover:scale-110 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 disabled:opacity-40 disabled:pointer-events-none ${
              selected ? "ring-2 ring-accent-text ring-offset-2 ring-offset-surface" : ""
            }`}
          >
            <ProfileAvatar iconId={a.id} name={name} size={36} />
          </button>
        );
      })}
    </div>
  );
}
