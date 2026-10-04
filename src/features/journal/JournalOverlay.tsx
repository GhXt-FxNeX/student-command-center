import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { getJournalStatus } from "@/lib/ipc/journal";
import type { JournalStatus } from "@/types";
import { JournalContent } from "./JournalContent";
import { ConfirmDialog } from "./ModalShell";
import { PasswordGate } from "./PasswordGate";
import { SpinnerIcon } from "./icons";
import { useModalLayer } from "./useModalLayer";

/**
 * Full-screen frame for the Secret Private Video Journal. Mounted by
 * `app/Shell.tsx` outside <Routes> — no route or URL points at it, and the
 * three-clicks-on-Settings trigger and its 1.2s window are untouched. The
 * export name and `onClose` prop are unchanged, so Shell.tsx needed no edit.
 *
 * Everything security-relevant (password check, key derivation, backoff,
 * auto-lock enforcement, the in-memory-only key) is still the backend's
 * `journal::` module; nothing here reads or stores a key or a password
 * beyond the input the person is typing.
 *
 * This component owns only presentation-level concerns: the open/close
 * transition, the Escape/Tab layer, and "are you sure?" when closing or
 * locking would throw away an unsaved recording.
 */
export function JournalOverlay({ onClose }: { onClose: () => void }) {
  const reduced = usePrefersReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<JournalStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStatus = useCallback(() => {
    getJournalStatus()
      .then((s) => {
        setStatus(s);
        setStatusError(null);
      })
      .catch((e) => setStatusError(String(e)));
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(onClose, reduced ? 0 : 160);
  }, [closing, onClose, reduced]);

  /** Runs `action` now, or asks first if an unsaved recording would be lost. */
  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPendingAction(() => action);
      else action();
    },
    [dirty]
  );

  useModalLayer(panelRef, () => guard(requestClose));

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Private Journal"
      tabIndex={-1}
      className={`fixed inset-0 z-40 bg-bg text-text outline-none ${
        closing ? "animate-journal-overlay-out" : "animate-journal-overlay-in"
      }`}
      // A soft accent wash at the top edge; accent-soft is already derived
      // per light/dark mode by lib/theme/accent.ts.
      style={{ backgroundImage: "radial-gradient(ellipse 70% 40% at 50% -5%, var(--color-accent-soft), transparent)" }}
    >
      {statusError ? (
        <div className="h-full flex items-center justify-center p-6">
          <Callout
            tone="error"
            title="Couldn't check the journal"
            className="max-w-md w-full"
            action={
              <Button variant="secondary" onClick={refreshStatus}>
                Try again
              </Button>
            }
          >
            {statusError}
          </Callout>
        </div>
      ) : !status ? (
        <div className="h-full flex flex-col items-center justify-center gap-2 text-text-secondary">
          <SpinnerIcon className="w-6 h-6 animate-spin motion-reduce:animate-none" />
          <p className="text-sm">Opening…</p>
        </div>
      ) : !status.unlocked ? (
        <PasswordGate key="gate" status={status} onReady={refreshStatus} onClose={requestClose} />
      ) : (
        <JournalContent
          key="content"
          status={status}
          onLocked={refreshStatus}
          onClose={() => guard(requestClose)}
          guard={guard}
          onDirtyChange={setDirty}
        />
      )}

      {pendingAction && (
        <ConfirmDialog
          title="Discard this recording?"
          description="You have a recording that hasn't been saved. If you continue, it will be permanently discarded."
          confirmLabel="Discard recording"
          cancelLabel="Keep it"
          destructive
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            const action = pendingAction;
            setPendingAction(null);
            action();
          }}
        />
      )}
    </div>
  );
}
