import { formatDateOnly, relativeDayLabel } from "@/lib/date";
import type { JournalEntrySummary } from "@/types";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Clock-style duration: 3:07, or 1:04:09 once it passes an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Compact total for summaries: "1h 12m", "4m 10s", "35s". */
export function formatTotalDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Both backend lock errors ("Journal is locked." and "Journal auto-locked
 * after inactivity.", see journal/session.rs) contain "locked". The
 * lockout-backoff message ("Too many attempts…") deliberately does not, so
 * it isn't mistaken for a session that needs re-unlocking.
 */
export function isLockedError(err: unknown): boolean {
  return /locked/i.test(String(err));
}

export function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * Takes the payload after the LAST comma of the data URL, not `split(",")[1]`.
 * The URL's header is built from the Blob's MIME type, and recorder types
 * routinely contain a comma themselves ("video/webm;codecs=vp9,opus",
 * "video/mp4;codecs=avc1,mp4a") — `split(",")[1]` then returns "opus;base64"
 * rather than the video, which the backend rejects as invalid data. Base64
 * itself never contains a comma, so the last one is always the separator.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.lastIndexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/// Picks the best MediaRecorder MIME type this browser/webview actually
/// supports, trying WebM variants first (Chromium-based platforms) then
/// falling back to MP4 (WebKit/Safari before 18.4, which doesn't support
/// WebM in MediaRecorder at all). Returns "" if nothing on the list
/// checks out, in which case the caller lets the browser pick its own
/// default rather than forcing an unsupported type.
/// (Moved unchanged from the old JournalOverlay.tsx — see
/// engineering-notes: never hardcode a recording MIME type.)
export function pickSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    // Older WebKit exposes MediaRecorder without isTypeSupported and only
    // ever records MP4 — the same fallback WebKit's own docs recommend.
    return "video/mp4";
  }
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/** Turns a getUserMedia/MediaRecorder failure into what happened + what to do. */
export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera or microphone access was denied. Allow it for this app in your system's privacy settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera or microphone was found. Connect one and try again.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera or microphone couldn't be started — another app may be using it.";
  }
  if (typeof MediaRecorder === "undefined" || err instanceof ReferenceError) {
    // Possible on Linux, where the web engine (WebKitGTK) only records video when it was
    // built with media support and the GStreamer plugins are installed.
    return "This system's web engine can't record video. On Linux that needs GStreamer's media plugins (for example gstreamer1.0-plugins-good). Watching and managing existing entries still works.";
  }
  return `Couldn't start recording: ${String(err)}`;
}

/**
 * `created_at` is SQLite's `datetime('now')`: UTC, "YYYY-MM-DD HH:MM:SS".
 * This is a real timestamp (unlike the date-only `entryDate`), so
 * converting it through Date to the local clock is correct here.
 */
export function entryTimeLabel(createdAt: string): string | null {
  const iso = createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Tuesday, September 29" (year added when it isn't the current one). */
export function fullDateLabel(entryDate: string): string {
  const thisYear = new Date().getFullYear();
  const year = Number(entryDate.substring(0, 4));
  return formatDateOnly(entryDate, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: year !== thisYear ? "numeric" : undefined,
  });
}

export interface DayGroup {
  date: string;
  heading: string;
  subheading: string | null;
  entries: JournalEntrySummary[];
  totalSeconds: number;
}

/** Groups an already-ordered list by `entryDate`, preserving its order
 * (the backend sorts newest-first, so groups come out newest-first too). */
export function groupEntriesByDay(entries: JournalEntrySummary[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== entry.entryDate) {
      const rel = relativeDayLabel(entry.entryDate);
      const isRelative = rel === "Today" || rel === "Yesterday" || rel === "Tomorrow";
      const full = fullDateLabel(entry.entryDate);
      group = {
        date: entry.entryDate,
        heading: isRelative ? rel : full,
        subheading: isRelative ? full : null,
        entries: [],
        totalSeconds: 0,
      };
      groups.push(group);
    }
    group.entries.push(entry);
    group.totalSeconds += entry.durationSeconds;
  }
  return groups;
}

export interface PasswordStrength {
  level: 0 | 1 | 2 | 3;
  label: string;
}

/**
 * A rough, purely advisory length/variety hint — not a security control
 * (the only enforced rule is the backend's 8-character minimum). It exists
 * so someone choosing a password they can never recover gets a nudge toward
 * something longer.
 */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { level: 0, label: "" };
  if (pw.length < 8) return { level: 1, label: "Too short" };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 14 || (pw.length >= 10 && classes >= 3)) return { level: 3, label: "Strong" };
  if (pw.length >= 10 || classes >= 3) return { level: 2, label: "Okay" };
  return { level: 1, label: "Weak — longer is better" };
}
