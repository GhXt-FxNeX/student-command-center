import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { getJournalStatus, setupJournalPassword, unlockJournal } from "@/lib/ipc/journal";
import type { JournalStatus } from "@/types";
import { CloseIcon, LockIcon, SpinnerIcon, UnlockIcon } from "./icons";
import { PasswordField, StrengthMeter } from "./PasswordField";

/**
 * First-run password creation, or unlock. All security behavior is the
 * backend's, unchanged: minimum length, Argon2 verification, and the
 * 30s/2min/15min backoff after repeated failures. This screen only presents
 * it — including re-reading the lockout from `journal_status` after a wrong
 * attempt, which the old screen never did (it only saw the lockout that
 * existed when the overlay opened, so the countdown never appeared live).
 */
export function PasswordGate({
  status,
  onReady,
  onClose,
}: {
  status: JournalStatus;
  onReady: () => void;
  onClose: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [countdown, setCountdown] = useState(status.lockedOutForSeconds);
  const [lockTotal, setLockTotal] = useState(Math.max(1, status.lockedOutForSeconds));

  const configured = status.configured;
  const lockedOut = countdown > 0;

  useEffect(() => {
    if (!lockedOut) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [lockedOut]);

  function applyLockout(seconds: number) {
    setCountdown(seconds);
    setLockTotal(Math.max(1, seconds));
  }

  async function finishSuccess() {
    // A brief "lock opens" moment before the journal appears. Skipped under
    // reduced motion, where it would just be an unexplained pause.
    setUnlocking(true);
    if (!reduced) await new Promise((r) => setTimeout(r, 380));
    onReady();
  }

  function fail(message: string) {
    setError(message);
    setShaking(true);
    setPassword("");
    setConfirm("");
    setFocusSignal((n) => n + 1);
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return fail("Password must be at least 8 characters.");
    if (password !== confirm) return fail("Passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await setupJournalPassword(password);
      await finishSuccess();
    } catch (err) {
      fail(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlockJournal(password);
      await finishSuccess();
    } catch (err) {
      fail(String(err));
      // The backoff starts server-side on the failing attempt itself, so ask
      // for the fresh lockout instead of waiting until the overlay reopens.
      getJournalStatus()
        .then((s) => applyLockout(s.lockedOutForSeconds))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const mismatch = !configured && confirm.length > 0 && password !== confirm;
  const submitDisabled = busy || unlocking || lockedOut || !password || (!configured && !confirm);

  return (
    <div className="relative h-full overflow-y-auto animate-fade-slide-in">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close journal"
        title="Close (Esc)"
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text transition-colors"
      >
        <CloseIcon className="w-[18px] h-[18px]" />
      </button>

      <div className="min-h-full flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-6">
            <div
              className={`w-16 h-16 rounded-full bg-accent-soft text-accent-text flex items-center justify-center ${
                unlocking ? "animate-journal-lock-pop" : ""
              }`}
            >
              {unlocking ? <UnlockIcon className="w-7 h-7" /> : <LockIcon className="w-7 h-7" />}
            </div>
            <h1 className="text-xl font-semibold mt-4">{configured ? "Private Journal" : "Set up your Private Journal"}</h1>
            <p className="text-sm text-text-secondary mt-1 max-w-xs">
              {configured
                ? "Enter your password to unlock."
                : "Choose a password for your video journal. Entries are encrypted on this device with a key made from it."}
            </p>
          </div>

          <div
            className={`rounded-card border border-border bg-surface p-4 shadow-sm ${shaking ? "animate-journal-shake" : ""}`}
            onAnimationEnd={() => setShaking(false)}
          >
            <form onSubmit={configured ? handleUnlock : handleSetup} className="space-y-3">
              <PasswordField
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setError(null);
                }}
                placeholder={configured ? "Password" : "New password"}
                label="Journal password"
                autoFocus
                disabled={lockedOut || unlocking}
                autoComplete={configured ? "current-password" : "new-password"}
                focusSignal={focusSignal}
              />

              {!configured && (
                <>
                  <StrengthMeter password={password} />
                  <PasswordField
                    value={confirm}
                    onChange={(v) => {
                      setConfirm(v);
                      setError(null);
                    }}
                    placeholder="Confirm password"
                    label="Confirm journal password"
                    disabled={unlocking}
                    autoComplete="new-password"
                  />
                  {mismatch && <p className="text-xs text-red-600 dark:text-red-400">Passwords don't match yet.</p>}
                  <Callout tone="warning" title="There's no way to recover this password">
                    Only a one-way check value is kept, so a forgotten password can't be reset — your entries would
                    stay encrypted for good.
                  </Callout>
                </>
              )}

              {lockedOut ? (
                <div role="status" className="space-y-1.5">
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Too many attempts — try again in {countdown}s.
                  </p>
                  <div className="h-1 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full bg-red-500 transition-[width] duration-1000 ease-linear"
                      style={{ width: `${Math.min(100, (countdown / lockTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                error && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                )
              )}

              <Button type="submit" variant="primary" size="md" className="w-full" disabled={submitDisabled}>
                {busy || unlocking ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <SpinnerIcon className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                    {configured ? "Unlocking…" : "Creating…"}
                  </span>
                ) : configured ? (
                  "Unlock"
                ) : (
                  "Create journal"
                )}
              </Button>
            </form>
          </div>

          <p className="text-xs text-text-secondary text-center mt-4">
            {configured
              ? "Locks automatically when you quit the app."
              : "You can change the password later from the journal's settings."}
          </p>
        </div>
      </div>
    </div>
  );
}
