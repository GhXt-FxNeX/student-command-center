import { useState } from "react";
import { AppLogo } from "@/components/AppLogo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { ErrorBanner } from "@/components/ui/Callout";
import { updateSettings } from "@/lib/ipc/settings";
import type { UserSettings } from "@/types";
import { ProfileAvatar } from "./ProfileAvatar";
import { ProfileIconPicker } from "./ProfileIconPicker";

const MAX_NAME_LENGTH = 40;

/**
 * Shown instead of the app on the very first launch and after "Reset saved
 * data" — i.e. whenever `settings.onboardingCompleted` is false. The user picks
 * a name and a profile icon; nothing else is asked. Finishing saves both and
 * flips `onboardingCompleted`, which lets App render the normal shell.
 *
 * Existing installs see this once after the update that introduced it, with
 * their current name pre-filled, so they can pick an icon.
 */
export function OnboardingScreen({
  settings,
  onDone,
}: {
  settings: UserSettings;
  onDone: (s: UserSettings) => void;
}) {
  const [name, setName] = useState(settings.name);
  const [icon, setIcon] = useState(settings.profileIcon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const ready = trimmed.length > 0 && icon !== "";

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const persisted = await updateSettings({
        ...settings,
        name: trimmed,
        profileIcon: icon,
        onboardingCompleted: true,
      });
      onDone(persisted);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-bg text-text">
      <div className="min-h-full flex items-center justify-center p-6">
        <form
          onSubmit={finish}
          aria-labelledby="onboarding-title"
          className="w-full max-w-md rounded-card border border-border bg-surface p-8 shadow-sm animate-fade-slide-in"
        >
          <div className="flex flex-col items-center text-center">
            <AppLogo size={64} />
            <h1 id="onboarding-title" className="mt-4 text-xl font-semibold tracking-tight">
              Welcome to Student Command Center
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              Pick a name and an icon to get started. You can change both any time in Settings → General.
            </p>
          </div>

          <div className="mt-6 flex items-end gap-3">
            <ProfileAvatar iconId={icon} name={name} size={44} className="mb-px" />
            <FormField label="Your name" className="flex-1">
              <Input
                autoFocus
                maxLength={MAX_NAME_LENGTH}
                placeholder="What should we call you?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </FormField>
          </div>

          <div className="mt-5">
            <p className="text-xs text-text-secondary mb-2">Your profile icon</p>
            <ProfileIconPicker value={icon} name={name} onChange={setIcon} disabled={busy} />
          </div>

          {error && (
            <ErrorBanner
              className="mt-5"
              title="Couldn't save your profile"
              message={`${error}\n\nNothing was lost — try again.`}
              onDismiss={() => setError(null)}
            />
          )}

          <Button type="submit" variant="primary" size="md" className="mt-6 w-full" disabled={!ready || busy}>
            {busy ? "Saving…" : "Get started"}
          </Button>
          {!ready && (
            <p className="mt-2 text-center text-xs text-text-secondary" aria-live="polite">
              {trimmed.length === 0 ? "Enter your name" : "Choose an icon"} to continue.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
