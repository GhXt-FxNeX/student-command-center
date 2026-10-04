/**
 * Date-only ("YYYY-MM-DD") helpers that never round-trip through UTC.
 *
 * Two JS footguns cause silent one-day shifts for pure calendar dates:
 *   1. `Date.prototype.toISOString()` always converts to UTC.
 *   2. `new Date("YYYY-MM-DD")` (no time component) is parsed as UTC midnight,
 *      while `new Date("YYYY-MM-DDTHH:mm:ss")` (no zone) is parsed as LOCAL time.
 * Mixing these is exactly what caused the calendar off-by-one bug. Every place
 * in this app that converts between a JS Date and a "YYYY-MM-DD" string must
 * go through these functions instead of touching toISOString/`new Date(str)`
 * directly, so the conversion is local-safe everywhere, consistently.
 */

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parses a "YYYY-MM-DD" string into a local-midnight Date — never UTC. */
export function parseDateOnly(dateOnly: string): Date {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Formats a "YYYY-MM-DD" string (or the date prefix of a longer ISO string) for display. */
export function formatDateOnly(dateLike: string, opts?: Intl.DateTimeFormatOptions): string {
  return parseDateOnly(dateLike.substring(0, 10)).toLocaleDateString(undefined, opts);
}

/**
 * "Today" / "Yesterday" / "Tomorrow" / an absolute date further out — a
 * pure, read-only UI label computed from a stored calendar date plus the
 * current date. This NEVER writes back to or otherwise changes the
 * stored value; it's the display-only half of the rule that a task's
 * persisted date is authoritative and must never be altered just because
 * the current date changed. `today` defaults to `new Date()` but accepts
 * an override for testing so this stays testable without mocking the
 * system clock.
 */
export function relativeDayLabel(dateLike: string, today: Date = new Date()): string {
  const target = parseDateOnly(dateLike.substring(0, 10));
  const todayKey = toDateKey(today);
  const targetKey = toDateKey(target);
  if (targetKey === todayKey) return "Today";

  const msPerDay = 24 * 60 * 60 * 1000;
  // Both sides are local-midnight Dates (via parseDateOnly/toDateKey's own
  // local construction), so this difference is a whole number of days
  // with no DST/timezone fraction to round away.
  const diffDays = Math.round((target.getTime() - parseDateOnly(todayKey).getTime()) / msPerDay);
  if (diffDays === -1) return "Yesterday";
  if (diffDays === 1) return "Tomorrow";
  return formatDateOnly(dateLike, { month: "short", day: "numeric", year: target.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}
