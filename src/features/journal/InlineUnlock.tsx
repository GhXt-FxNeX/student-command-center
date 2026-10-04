import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { unlockJournal } from "@/lib/ipc/journal";
import { PasswordField } from "./PasswordField";
import { LockIcon, SpinnerIcon } from "./icons";

/**
 * Shown INSTEAD of the entry list when the journal auto-locks while an
 * unsaved recording exists. Sending the person back to the full password
 * screen would unmount the recorder and destroy the video; this keeps the
 * draft in memory and just asks for the password again. Auto-lock itself is
 * untouched — nothing here refreshes or extends the session, and the
 * password is still required.
 */
export function InlineUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlockJournal(password);
      onUnlocked();
    } catch (err) {
      setError(String(err));
      setShaking(true);
      setPassword("");
      setFocusSignal((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-card border border-border bg-surface p-4 space-y-3 animate-fade-slide-in ${
        shaking ? "animate-journal-shake" : ""
      }`}
      onAnimationEnd={() => setShaking(false)}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent-text flex items-center justify-center">
          <LockIcon className="w-5 h-5" />
        </div>
        <div>
          <p className="font-medium">Journal locked</p>
          <p className="text-xs text-text-secondary">Your entries are hidden until you unlock again.</p>
        </div>
      </div>
      <Callout tone="info">
        Your recording is still here. Unlock, then save it — or discard it from the panel next to this one.
      </Callout>
      <form onSubmit={handleSubmit} className="space-y-3">
        <PasswordField
          value={password}
          onChange={(v) => {
            setPassword(v);
            setError(null);
          }}
          placeholder="Password"
          label="Journal password"
          autoFocus
          autoComplete="current-password"
          focusSignal={focusSignal}
        />
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="md" className="w-full" disabled={busy || !password}>
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <SpinnerIcon className="w-4 h-4 animate-spin motion-reduce:animate-none" />
              Unlocking…
            </span>
          ) : (
            "Unlock"
          )}
        </Button>
      </form>
    </div>
  );
}
