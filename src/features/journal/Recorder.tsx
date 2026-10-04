import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Input, Textarea } from "@/components/ui/Input";
import { toDateKey } from "@/lib/date";
import { saveJournalEntry } from "@/lib/ipc/journal";
import { blobToBase64, describeMediaError, formatBytes, formatDuration, isLockedError, pickSupportedMimeType } from "./journalUtils";
import { RecordIcon, SpinnerIcon, StopIcon, VideoIcon } from "./icons";

type Phase = "idle" | "starting" | "recording" | "review";

/**
 * The "New entry" composer. Recording mechanics are carried over from the
 * previous journal unchanged — MIME type detection via
 * `isTypeSupported()`, and persisting the recorder's OWN negotiated
 * `.mimeType` (see engineering-notes: WebKit records MP4, and tagging the
 * wrong type produces a silently unplayable video). What's new:
 *   - A live elapsed timer and a distinct recording state.
 *   - The camera is released on every failure path (previously a throw
 *     after getUserMedia succeeded — e.g. the MediaRecorder constructor —
 *     left the camera light on).
 *   - Reports whether a draft exists (`onDirtyChange`), so closing/locking
 *     the journal can ask before throwing away a recording.
 *   - If Save fails because the journal auto-locked mid-recording, the
 *     draft is kept and the parent asks for the password again in place
 *     (`onLockedError`) rather than losing the video.
 *   - The entry date is the LOCAL date (`toDateKey`), not `toISOString()`'s
 *     UTC date, which would file a post-midnight recording under yesterday.
 */
export function Recorder({
  onSaved,
  onDirtyChange,
  onLockedError,
}: {
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onLockedError: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const mimeTypeRef = useRef("video/webm");
  const previewUrlRef = useRef<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = phase === "recording" || phase === "review";
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Release everything on unmount, including a recording still in flight.
  useEffect(() => {
    return () => {
      onDirtyChange(false);
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            /* already stopped */
          }
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
    // Mount/unmount only; everything it touches is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase]);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startRecording() {
    setError(null);
    setJustSaved(false);
    setPhase("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This system doesn't expose a camera to the app.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }
      chunksRef.current = [];
      const mimeType = pickSupportedMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      // recorder.mimeType is what the browser actually negotiated, which
      // is the authoritative value to use later — not what we requested.
      mimeTypeRef.current = recorder.mimeType || mimeType || "video/webm";
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setRecordedBlob(blob);
        setPreviewUrl(url);
        setDurationSeconds(Math.round((Date.now() - startedAtRef.current) / 1000));
        releaseStream();
        setPhase("review");
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start();
      setPhase("recording");
    } catch (err) {
      releaseStream();
      setError(describeMediaError(err));
      setPhase("idle");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function discard() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setRecordedBlob(null);
    setTitle("");
    setNote("");
    setError(null);
    setPhase("idle");
  }

  async function handleSave() {
    if (!recordedBlob) return;
    setSaving(true);
    setError(null);
    try {
      const base64 = await blobToBase64(recordedBlob);
      await saveJournalEntry({
        entryDate: toDateKey(new Date()),
        title: title.trim() || null,
        note: note.trim() || null,
        videoBase64: base64,
        videoMimeType: mimeTypeRef.current,
        durationSeconds,
      });
      discard();
      setJustSaved(true);
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 4000);
      onSaved();
    } catch (err) {
      if (isLockedError(err)) {
        // Keep the draft; the parent swaps the entry list for an unlock prompt.
        onLockedError();
      } else {
        setError(`Couldn't save this entry: ${String(err)}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const statusPill =
    phase === "recording" ? (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-journal-rec-pulse" />
        Recording
      </span>
    ) : phase === "review" ? (
      <span className="text-xs text-text-secondary">Ready to save</span>
    ) : null;

  return (
    <div className="rounded-card border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="font-medium text-sm">New entry</p>
        {statusPill}
      </div>

      <div className="p-4 space-y-3">
        {error && (
          <Callout
            tone="error"
            title={phase === "review" ? "Couldn't save" : "Couldn't start recording"}
            action={
              <Button variant="ghost" onClick={() => setError(null)}>
                Dismiss
              </Button>
            }
          >
            {error}
          </Callout>
        )}
        {justSaved && (
          <Callout tone="success" title="Entry saved">
            It's encrypted and filed under today.
          </Callout>
        )}

        {phase !== "review" ? (
          <>
            {/* The live <video> is always mounted (so srcObject can be set
                before the state flips to "recording"); the placeholder just
                covers it until then. */}
            <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
              <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
              {phase !== "recording" && (
                <div className="absolute inset-0 bg-bg flex flex-col items-center justify-center gap-2 text-text-secondary text-center px-4">
                  {phase === "starting" ? (
                    <>
                      <SpinnerIcon className="w-6 h-6 animate-spin motion-reduce:animate-none" />
                      <p className="text-sm">Waiting for your camera…</p>
                    </>
                  ) : (
                    <>
                      <VideoIcon className="w-7 h-7" />
                      <p className="text-sm">Camera is off</p>
                      <p className="text-xs max-w-[15rem]">It turns on only while you're recording.</p>
                    </>
                  )}
                </div>
              )}
              {phase === "recording" && (
                <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-full bg-black/60 text-white text-xs px-2.5 py-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-journal-rec-pulse" />
                  <span className="tabular-nums font-medium">{formatDuration(elapsed)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-center pt-1">
              {phase === "recording" ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex items-center gap-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium pl-3 pr-4 py-2 transition-all duration-150 active:scale-[0.97]"
                >
                  <StopIcon className="w-5 h-5" />
                  Stop recording
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={phase === "starting"}
                  className="inline-flex items-center gap-2 rounded-full bg-accent-fill hover:bg-accent-fill-hover active:bg-accent-fill-active text-white text-sm font-medium pl-3 pr-4 py-2 transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none"
                >
                  <RecordIcon className="w-5 h-5 text-red-300" />
                  Start recording
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3 animate-fade-slide-in">
            <video src={previewUrl ?? undefined} controls playsInline className="w-full aspect-video rounded-lg bg-black" />
            <p className="text-xs text-text-secondary tabular-nums">
              {formatDuration(durationSeconds)}
              {recordedBlob ? ` · ${formatBytes(recordedBlob.size)}` : ""}
            </p>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              aria-label="Entry title"
              size="sm"
              className="w-full"
              disabled={saving}
            />
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Entry note"
              rows={3}
              size="sm"
              className="w-full"
              disabled={saving}
            />
            <div className="flex gap-2">
              <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <SpinnerIcon className="w-4 h-4 animate-spin motion-reduce:animate-none" />
                    Encrypting &amp; saving…
                  </span>
                ) : (
                  "Save entry"
                )}
              </Button>
              <Button variant="secondary" size="md" onClick={discard} disabled={saving}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
