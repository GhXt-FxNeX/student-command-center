import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { changeJournalPassword, setJournalAutoLock } from "@/lib/ipc/journal";
import { formatBytes, isLockedError } from "./journalUtils";
import { CloseIcon, SpinnerIcon } from "./icons";
import { PasswordField, StrengthMeter } from "./PasswordField";
import { useModalLayer } from "./useModalLayer";

type AutoLockValue = "5" | "15" | "30" | "0";

const AUTO_LOCK_OPTIONS: { value: AutoLockValue; label: string }[] = [
  { value: "5", label: "5 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "0", label: "Never" },
];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="font-medium text-sm mb-3">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Journal settings as a right-hand drawer instead of a card that pushed the
 * entry list down. Behavior is unchanged from the old panel except:
 *   - the auto-lock value is owned by the parent (the old panel re-read the
 *     stale value from when the overlay opened, so reopening it after a
 *     change showed the OLD setting), and a failed save now reverts + says so;
 *   - "Change password" has a confirm field and a success message — the key
 *     is derived from the password with no recovery, so a mistyped new
 *     password used to be able to lock someone out for good, silently;
 *   - the destructive action lives in its own clearly separated zone.
 */
export function JournalSettingsDrawer({
  autoLockMinutes,
  onAutoLockChange,
  storageBytes,
  entryCount,
  onDeleteAll,
  onClose,
  onLockedError,
}: {
  autoLockMinutes: number;
  onAutoLockChange: (minutes: number) => void;
  storageBytes: number | null;
  entryCount: number | null;
  onDeleteAll: () => Promise<void>;
  onClose: () => void;
  onLockedError: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useModalLayer(panelRef, onClose);

  const [autoLockError, setAutoLockError] = useState<string | null>(null);
  const [autoLockSaved, setAutoLockSaved] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleAutoLock(value: AutoLockValue) {
    const minutes = Number(value);
    const previous = autoLockMinutes;
    setAutoLockError(null);
    setAutoLockSaved(false);
    onAutoLockChange(minutes);
    try {
      await setJournalAutoLock(minutes);
      setAutoLockSaved(true);
    } catch (e) {
      onAutoLockChange(previous);
      setAutoLockError(String(e));
    }
  }

  const pwMismatch = confirmPw.length > 0 && newPw !== confirmPw;
  const pwTooShort = newPw.length > 0 && newPw.length < 8;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw.length < 8) return setPwError("New password must be at least 8 characters.");
    if (newPw !== confirmPw) return setPwError("The new passwords don't match.");
    setPwBusy(true);
    setPwError(null);
    setPwDone(false);
    try {
      await changeJournalPassword(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwDone(true);
    } catch (err) {
      if (isLockedError(err)) onLockedError();
      else setPwError(String(err));
    } finally {
      setPwBusy(false);
    }
  }

  async function handleDeleteAll() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteAll();
    } catch (e) {
      if (isLockedError(e)) onLockedError();
      else setDeleteError(String(e));
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 animate-journal-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Journal settings"
        tabIndex={-1}
        className="h-full w-full max-w-md bg-bg border-l border-border shadow-2xl overflow-y-auto outline-none animate-journal-drawer-in"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-bg border-b border-border px-5 py-4">
          <h2 className="font-semibold">Journal settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            title="Close (Esc)"
            className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <SectionCard title="Auto-lock">
            <SegmentedControl
              options={AUTO_LOCK_OPTIONS}
              value={String(autoLockMinutes) as AutoLockValue}
              onChange={handleAutoLock}
            />
            <p className="text-xs text-text-secondary mt-2">
              {autoLockMinutes === 0
                ? "The journal stays unlocked until you lock it or quit the app."
                : `Locks after ${autoLockMinutes} minutes without opening, saving or editing an entry. It always locks when you quit the app.`}
            </p>
            <p className="text-xs h-4 mt-1 text-text-secondary" aria-live="polite">
              {autoLockSaved ? "Saved" : ""}
            </p>
            {autoLockError && (
              <Callout tone="error" title="Couldn't change auto-lock">
                {autoLockError}
              </Callout>
            )}
          </SectionCard>

          <SectionCard title="Storage">
            <p className="text-2xl font-semibold tabular-nums">{storageBytes === null ? "—" : formatBytes(storageBytes)}</p>
            <p className="text-xs text-text-secondary mt-1">
              Encrypted video on this device
              {entryCount !== null ? ` · ${entryCount} ${entryCount === 1 ? "entry" : "entries"}` : ""}
            </p>
          </SectionCard>

          <SectionCard title="Change password">
            <form onSubmit={handleChangePassword} className="space-y-3">
              <PasswordField
                value={currentPw}
                onChange={(v) => {
                  setCurrentPw(v);
                  setPwDone(false);
                }}
                placeholder="Current password"
                label="Current password"
                autoComplete="current-password"
                disabled={pwBusy}
              />
              <PasswordField
                value={newPw}
                onChange={(v) => {
                  setNewPw(v);
                  setPwDone(false);
                }}
                placeholder="New password"
                label="New password"
                autoComplete="new-password"
                disabled={pwBusy}
              />
              <StrengthMeter password={newPw} />
              <PasswordField
                value={confirmPw}
                onChange={(v) => {
                  setConfirmPw(v);
                  setPwDone(false);
                }}
                placeholder="Confirm new password"
                label="Confirm new password"
                autoComplete="new-password"
                disabled={pwBusy}
              />
              {pwMismatch && <p className="text-xs text-red-600 dark:text-red-400">The new passwords don't match yet.</p>}
              {pwError && (
                <Callout tone="error" title="Couldn't change the password">
                  {pwError}
                </Callout>
              )}
              {pwDone && (
                <Callout tone="success" title="Password changed">
                  Every entry was re-encrypted with a key from the new password.
                </Callout>
              )}
              {pwBusy && (
                <p className="text-xs text-text-secondary">
                  Re-encrypting every entry — this can take a while with a lot of video. Keep the app open.
                </p>
              )}
              <Button
                type="submit"
                variant="secondary"
                disabled={pwBusy || !currentPw || !newPw || !confirmPw || pwMismatch || pwTooShort}
              >
                {pwBusy ? (
                  <span className="inline-flex items-center gap-2">
                    <SpinnerIcon className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" />
                    Changing…
                  </span>
                ) : (
                  "Change password"
                )}
              </Button>
            </form>
          </SectionCard>

          {/* A plain div, not <Card className="border-red-…">: Card's own
              border-border would compete with the red border for the same
              CSS property (see engineering-notes on same-property classes). */}
          <section className="rounded-card border border-red-500/40 bg-surface p-4">
            <h3 className="font-medium text-sm mb-1 text-red-700 dark:text-red-400">Danger zone</h3>
            <p className="text-xs text-text-secondary mb-3">
              Deleting the journal removes every entry, every encrypted video file and the journal password.
            </p>
            {!confirmingDelete ? (
              <Button variant="destructive-outline" onClick={() => setConfirmingDelete(true)}>
                Delete all journal data…
              </Button>
            ) : (
              <div className="space-y-3 animate-fade-slide-in">
                <Callout tone="error" title="This can't be undone">
                  Everything in the journal will be permanently deleted, including the password. You'll be asked to set
                  a new one next time.
                </Callout>
                {deleteError && <p className="text-xs text-red-600 dark:text-red-400">{deleteError}</p>}
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={handleDeleteAll} disabled={deleting}>
                    {deleting ? "Deleting…" : "Delete everything"}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
