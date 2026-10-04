import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Input } from "@/components/ui/Input";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import {
  deleteAllJournalData,
  deleteJournalEntry,
  getJournalStorageUsage,
  listJournalEntries,
  lockJournal,
} from "@/lib/ipc/journal";
import type { JournalEntrySummary, JournalStatus } from "@/types";
import { EntryList } from "./EntryList";
import { EntryViewer } from "./EntryViewer";
import { InlineUnlock } from "./InlineUnlock";
import { JournalSettingsDrawer } from "./JournalSettingsDrawer";
import { Recorder } from "./Recorder";
import { formatBytes, formatTotalDuration, groupEntriesByDay, isLockedError } from "./journalUtils";
import { CloseIcon, LockIcon, SearchIcon, ShieldIcon, SlidersIcon, VideoIcon } from "./icons";

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-0.5 min-h-[1.75rem] flex items-center">
        {value === null ? <SkeletonBar className="h-5 w-14" /> : value}
      </p>
    </div>
  );
}

/**
 * The unlocked journal: stats, a search box and the day-grouped entry list
 * on one side, the recorder on the other.
 *
 * Search is a case-insensitive title match over the list that's already
 * loaded — one decrypt-and-fetch instead of one per keystroke, and the stats
 * above stay whole-journal while filtering. (There is deliberately no
 * backend search command: it would have to decrypt every title per keystroke.)
 *
 * Auto-lock handling: any content command that fails with a lock error
 * sets `locked`. With no unsaved recording that just returns to the password
 * screen (`onLocked`), as before. WITH an unsaved recording, the entry list
 * is hidden (locked means locked) and replaced by an in-place unlock prompt,
 * while the Recorder stays mounted so the draft survives. The Recorder is
 * deliberately always rendered in the same spot in the tree for that reason.
 */
export function JournalContent({
  status,
  onLocked,
  onClose,
  guard,
  onDirtyChange,
}: {
  status: JournalStatus;
  onLocked: () => void;
  onClose: () => void;
  guard: (action: () => void) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [entries, setEntries] = useState<JournalEntrySummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ id: number; edit: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(status.autoLockMinutes);
  const [leavingIds, setLeavingIds] = useState<Set<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [locked, setLocked] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);

  const handleDirtyChange = useCallback(
    (d: boolean) => {
      setDirty(d);
      onDirtyChange(d);
    },
    [onDirtyChange]
  );

  const handleLockedError = useCallback(() => setLocked(true), []);

  useEffect(() => {
    if (locked && !dirty) onLocked();
  }, [locked, dirty, onLocked]);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listJournalEntries());
      setError(null);
    } catch (e) {
      if (isLockedError(e)) handleLockedError();
      else setError(String(e));
    }
    getJournalStorageUsage()
      .then(setStorageBytes)
      .catch(() => {});
  }, [handleLockedError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const trimmed = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!entries) return null;
    if (!trimmed) return entries;
    return entries.filter((e) => (e.title ?? "").toLowerCase().includes(trimmed));
  }, [entries, trimmed]);
  const groups = useMemo(() => (visible ? groupEntriesByDay(visible) : []), [visible]);
  const totalSeconds = entries ? entries.reduce((sum, e) => sum + e.durationSeconds, 0) : 0;
  const createdAtById = useMemo(() => new Map((entries ?? []).map((e) => [e.id, e.createdAt])), [entries]);

  async function handleLock() {
    try {
      await lockJournal();
    } finally {
      onLocked();
    }
  }

  async function handleDeleteEntry(id: number) {
    try {
      await deleteJournalEntry(id);
    } catch (e) {
      if (isLockedError(e)) handleLockedError();
      else setError(String(e));
      return;
    }
    // Play the collapse, then drop the row locally so it can't flash back
    // while the follow-up refresh (storage size, consistency) is in flight.
    setLeavingIds((prev) => new Set(prev).add(id));
    window.setTimeout(
      () => {
        setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
        setLeavingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        refresh();
      },
      reduced ? 0 : 190
    );
  }

  async function handleDeleteAll() {
    await deleteAllJournalData();
    setSettingsOpen(false);
    onLocked();
  }

  function scrollToComposer() {
    composerRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }

  const hasEntries = !!entries && entries.length > 0;

  return (
    <div className="h-full overflow-y-auto animate-fade-slide-in">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-center gap-3">
          <div className="w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent-text flex items-center justify-center">
            <ShieldIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight">Private Journal</h1>
            <p className="text-xs text-text-secondary">
              {locked ? "Locked" : "Unlocked"} · encrypted on this device
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!locked && (
              <>
                <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                  <span className="inline-flex items-center gap-1.5">
                    <SlidersIcon className="w-4 h-4" />
                    Settings
                  </span>
                </Button>
                <Button variant="secondary" onClick={() => guard(handleLock)}>
                  <span className="inline-flex items-center gap-1.5">
                    <LockIcon className="w-4 h-4" />
                    Lock
                  </span>
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close journal"
              title="Close (Esc) — the journal stays unlocked until auto-lock; use Lock to lock it now"
              className="w-9 h-9 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface hover:text-text transition-colors"
            >
              <CloseIcon className="w-[18px] h-[18px]" />
            </button>
          </div>
        </header>

        {!locked && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Entries" value={entries ? String(entries.length) : null} />
            <Stat label="Recorded" value={entries ? formatTotalDuration(totalSeconds) : null} />
            <Stat label="Storage" value={storageBytes === null ? null : formatBytes(storageBytes)} />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] items-start">
          <div className="min-w-0 space-y-4">
            {locked ? (
              <InlineUnlock
                onUnlocked={() => {
                  setLocked(false);
                  refresh();
                }}
              />
            ) : (
              <>
                {hasEntries && (
                  <div className="relative">
                    <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search titles…"
                      aria-label="Search entry titles"
                      className="w-full !pl-9 !pr-9"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        title="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text hover:bg-surface transition-colors"
                      >
                        <CloseIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {error && (
                  <Callout
                    tone="error"
                    title="Couldn't load your entries"
                    action={
                      <Button variant="secondary" onClick={refresh}>
                        Try again
                      </Button>
                    }
                  >
                    {error}
                  </Callout>
                )}

                {!entries && !error ? (
                  <div className="space-y-2" aria-busy="true" aria-label="Loading entries">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 rounded-card border border-border bg-surface p-2">
                        <SkeletonBar className="h-14 w-24" />
                        <div className="space-y-2">
                          <SkeletonBar className="h-3.5 w-40" />
                          <SkeletonBar className="h-3 w-28" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : entries && entries.length === 0 ? (
                  <div className="rounded-card border border-dashed border-border bg-surface px-6 py-12 text-center animate-fade-slide-in">
                    <div className="w-14 h-14 mx-auto rounded-full bg-accent-soft text-accent-text flex items-center justify-center">
                      <VideoIcon className="w-7 h-7" />
                    </div>
                    <h2 className="font-semibold mt-4">Your journal is empty</h2>
                    <p className="text-sm text-text-secondary mt-1 max-w-sm mx-auto">
                      Record a short video to capture how today went. Entries are encrypted on this device and can only
                      be watched after you unlock the journal.
                    </p>
                    <Button variant="primary" size="md" className="mt-5" onClick={scrollToComposer}>
                      Record your first entry
                    </Button>
                  </div>
                ) : visible && visible.length === 0 ? (
                  <div className="rounded-card border border-border bg-surface px-6 py-10 text-center animate-fade-slide-in">
                    <p className="font-medium">No entries match “{query.trim()}”</p>
                    <p className="text-sm text-text-secondary mt-1">Search looks at entry titles only.</p>
                    <Button variant="ghost" className="mt-3" onClick={() => setQuery("")}>
                      Clear search
                    </Button>
                  </div>
                ) : (
                  <EntryList
                    groups={groups}
                    leavingIds={leavingIds}
                    onOpen={(id) => setViewer({ id, edit: false })}
                    onEdit={(id) => setViewer({ id, edit: true })}
                    onDelete={handleDeleteEntry}
                  />
                )}
              </>
            )}
          </div>

          <div ref={composerRef} className="order-first lg:order-none lg:sticky lg:top-6">
            <Recorder onSaved={refresh} onDirtyChange={handleDirtyChange} onLockedError={handleLockedError} />
          </div>
        </div>
      </div>

      {!locked && viewer && visible && (
        <EntryViewer
          ids={visible.map((e) => e.id)}
          id={viewer.id}
          startEditing={viewer.edit}
          createdAtById={createdAtById}
          onNavigate={(id) => setViewer({ id, edit: false })}
          onClose={() => setViewer(null)}
          onChanged={refresh}
          onLockedError={handleLockedError}
        />
      )}

      {!locked && settingsOpen && (
        <JournalSettingsDrawer
          autoLockMinutes={autoLockMinutes}
          onAutoLockChange={setAutoLockMinutes}
          storageBytes={storageBytes}
          entryCount={entries ? entries.length : null}
          onDeleteAll={handleDeleteAll}
          onClose={() => setSettingsOpen(false)}
          onLockedError={handleLockedError}
        />
      )}
    </div>
  );
}
