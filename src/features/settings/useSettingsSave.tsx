import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ui/Callout";
import { updateSettings } from "@/lib/ipc/settings";
import type { UserSettings } from "@/types";

/**
 * The draft/save/"Saved" plumbing every settings page needs, with one rule the
 * pages used to get wrong: a save that FAILS must not leave the screen showing
 * the new value as if it had been stored.
 *
 * `save(next)` shows `next` immediately (optimistic), persists it, and on
 * success hands the stored row to `onSettingsChange`. On failure it rolls the
 * draft back to the last value that really was stored, calls `onRollback` (for
 * side effects the page applied optimistically, e.g. the theme), and exposes
 * `error` so the page can say what happened — see <SettingsSaveError>.
 *
 * Rollback goes to the last *stored* settings, so any other field the person
 * had typed but not yet committed (blurred) is discarded along with the failed
 * change; the error says the previous settings are still in place.
 */
export function useSettingsSave(
  settings: UserSettings,
  onSettingsChange: (s: UserSettings) => void,
  hooks: { onOptimistic?: (next: UserSettings) => void; onRollback?: (stored: UserSettings) => void } = {}
) {
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stored = useRef<UserSettings>(settings);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  async function save(next: UserSettings) {
    setDraft(next);
    hooks.onOptimistic?.(next);
    setSaving(true);
    setError(null);
    try {
      const persisted = await updateSettings(next);
      stored.current = persisted;
      onSettingsChange(persisted);
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setDraft(stored.current);
      hooks.onRollback?.(stored.current);
      setSaved(false);
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return { draft, setDraft, save, saving, saved, error, clearError: () => setError(null) };
}

/** The banner for a failed settings save. Renders nothing when there is no error. */
export function SettingsSaveError({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  if (!error) return null;
  return (
    <ErrorBanner
      title="Couldn't save your settings"
      message={`${error}\n\nYour previous settings are still in place.`}
      onDismiss={onDismiss}
    />
  );
}
