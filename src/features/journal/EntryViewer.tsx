import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Input, Textarea } from "@/components/ui/Input";
import { getJournalEntry, updateJournalEntryMeta } from "@/lib/ipc/journal";
import { base64ToBlob, entryTimeLabel, formatDuration, fullDateLabel, isLockedError } from "./journalUtils";
import { ModalShell } from "./ModalShell";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PencilIcon, SpinnerIcon } from "./icons";

interface Meta {
  entryDate: string;
  title: string | null;
  note: string | null;
  durationSeconds: number;
}

/**
 * Playback + details for one entry, with previous/next navigation through
 * the current list (also on ←/→, except while typing or when the video
 * itself has focus, where the arrow keys seek).
 *
 * Editing always sends BOTH title and note. The old list-row "Rename" sent
 * `note: null` alongside the new title, and `journal_update_entry_meta`
 * overwrites both columns unconditionally — so every rename silently erased
 * that entry's note. (It also used `window.prompt`, which Tauri's macOS
 * webview doesn't reliably provide.) Here the current note is loaded with
 * the entry and written back untouched unless the person edits it.
 */
export function EntryViewer({
  ids,
  id,
  startEditing,
  createdAtById,
  onNavigate,
  onClose,
  onChanged,
  onLockedError,
}: {
  ids: number[];
  id: number;
  startEditing: boolean;
  /** For the "recorded at" time — the detail command doesn't return it. */
  createdAtById: Map<number, string>;
  onNavigate: (id: number) => void;
  onClose: () => void;
  onChanged: () => void;
  onLockedError: () => void;
}) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Only the entry the viewer was opened on honors `startEditing`;
  // navigating to a neighbour always starts in read mode.
  const wantEditRef = useRef(startEditing);
  const lockedRef = useRef(onLockedError);
  lockedRef.current = onLockedError;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setMeta(null);
    setUrl(null);
    setError(null);
    setPlaybackFailed(false);
    setEditing(false);
    setSaveError(null);

    getJournalEntry(id)
      .then((entry) => {
        if (cancelled) return;
        // The base64 string goes out of scope after this; only the Blob URL
        // (revoked in the cleanup below) and the small metadata are kept.
        objectUrl = URL.createObjectURL(base64ToBlob(entry.videoBase64, entry.videoMimeType || "video/webm"));
        setUrl(objectUrl);
        setMeta({
          entryDate: entry.entryDate,
          title: entry.title,
          note: entry.note,
          durationSeconds: entry.durationSeconds,
        });
        setDraftTitle(entry.title ?? "");
        setDraftNote(entry.note ?? "");
        if (wantEditRef.current) {
          setEditing(true);
          wantEditRef.current = false;
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (isLockedError(e)) lockedRef.current();
        else setError(String(e));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, reloadKey]);

  const position = ids.indexOf(id);
  const prevId = position > 0 ? ids[position - 1] : null;
  const nextId = position >= 0 && position < ids.length - 1 ? ids[position + 1] : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLVideoElement) return;
      const target = e.key === "ArrowLeft" ? prevId : nextId;
      if (target !== null) {
        e.preventDefault();
        onNavigate(target);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, prevId, nextId, onNavigate]);

  async function handleSaveMeta() {
    if (!meta) return;
    setSaving(true);
    setSaveError(null);
    const title = draftTitle.trim() || null;
    const note = draftNote.trim() || null;
    try {
      await updateJournalEntryMeta(id, title, note);
      setMeta({ ...meta, title, note });
      setEditing(false);
      onChanged();
    } catch (e) {
      if (isLockedError(e)) onLockedError();
      else setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setDraftTitle(meta?.title ?? "");
    setDraftNote(meta?.note ?? "");
    setSaveError(null);
    setEditing(false);
  }

  const time = entryTimeLabel(createdAtById.get(id) ?? "");

  return (
    <ModalShell label="Journal entry" onClose={onClose} widthClass="max-w-3xl">
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{meta ? fullDateLabel(meta.entryDate) : "Journal entry"}</p>
            <p className="text-xs text-text-secondary tabular-nums">
              {time ? `${time} · ` : ""}
              {meta ? formatDuration(meta.durationSeconds) : "—"}
            </p>
          </div>
          {ids.length > 1 && position >= 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={prevId === null}
                onClick={() => prevId !== null && onNavigate(prevId)}
                aria-label="Previous entry"
                title="Previous entry (←)"
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg hover:text-text transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-xs text-text-secondary tabular-nums min-w-[3rem] text-center">
                {position + 1} / {ids.length}
              </span>
              <button
                type="button"
                disabled={nextId === null}
                onClick={() => nextId !== null && onNavigate(nextId)}
                aria-label="Next entry"
                title="Next entry (→)"
                className="w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg hover:text-text transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg hover:text-text transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
          {url && !playbackFailed && (
            <video
              key={url}
              src={url}
              controls
              autoPlay
              playsInline
              onError={() => setPlaybackFailed(true)}
              className="absolute inset-0 w-full h-full"
            />
          )}
          {!url && !error && (
            <div className="absolute inset-0 bg-bg flex flex-col items-center justify-center gap-2 text-text-secondary">
              <SpinnerIcon className="w-6 h-6 animate-spin motion-reduce:animate-none" />
              <p className="text-sm">Decrypting your entry…</p>
            </div>
          )}
          {(error || playbackFailed) && (
            <div className="absolute inset-0 bg-bg flex items-center justify-center p-4">
              <Callout
                tone="error"
                title={error ? "Couldn't open this entry" : "This recording can't be played"}
                className="max-w-md w-full"
                action={
                  <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                    Try again
                  </Button>
                }
              >
                {error ?? "Your system's video decoder couldn't read it. Trying again re-decrypts it from disk."}
              </Callout>
            </div>
          )}
        </div>

        {meta && !editing && (
          <div className="flex items-start gap-3 animate-fade-slide-in">
            <div className="min-w-0 flex-1">
              <h2 className={`text-lg font-semibold ${meta.title ? "" : "text-text-secondary"}`}>
                {meta.title || "Untitled entry"}
              </h2>
              {meta.note ? (
                <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap break-words">{meta.note}</p>
              ) : (
                <p className="text-sm text-text-secondary mt-1">No note.</p>
              )}
            </div>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <span className="inline-flex items-center gap-1.5">
                <PencilIcon className="w-3.5 h-3.5" />
                Edit details
              </span>
            </Button>
          </div>
        )}

        {meta && editing && (
          <div className="space-y-3 animate-fade-slide-in">
            <Input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title (optional)"
              aria-label="Entry title"
              size="sm"
              className="w-full"
              disabled={saving}
              autoFocus
            />
            <Textarea
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Entry note"
              rows={4}
              size="sm"
              className="w-full"
              disabled={saving}
            />
            {saveError && (
              <Callout tone="error" title="Couldn't save changes">
                {saveError}
              </Callout>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleSaveMeta} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
