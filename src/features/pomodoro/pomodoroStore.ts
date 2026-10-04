import { useSyncExternalStore } from "react";
import { completePomodoroSession } from "@/lib/ipc/study";
import type { UserSettings } from "@/types";

/**
 * Authoritative Pomodoro timer state, deliberately NOT owned by the
 * PomodoroPage component. React Router unmounts route components on
 * navigation, which was the root cause of the timer resetting — any state
 * that needs to survive that has to live somewhere React Router doesn't
 * control. This module-level singleton is that place: it's created once
 * when the app's JS bundle loads and lives for the lifetime of the webview
 * process, independent of which route is currently rendered.
 *
 * The countdown itself is timestamp-derived (`phaseEndAt` = epoch ms when
 * the current phase should end), not tick-counted. A `setInterval` that
 * just decrements a counter loses time whenever the JS event loop is
 * throttled or paused (backgrounded window, OS sleep) — when it resumes it
 * only "catches up" by however many ticks actually fired, which is wrong.
 * Deriving remaining time from `phaseEndAt - Date.now()` is correct
 * regardless of how many ticks were missed, so minimizing the window,
 * switching windows, or sleep/wake all self-correct the next time anything
 * reads the clock — no special-case handling needed for any of them.
 */

export type PomodoroPhase = "work" | "short_break" | "long_break";

interface PomodoroState {
  phase: PomodoroPhase;
  running: boolean;
  phaseEndAt: number | null; // epoch ms; only meaningful while running
  remainingSeconds: number; // authoritative while paused; derived while running
  cyclesCompleted: number;
  workMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  sessionsBeforeLong: number;
  autoStart: boolean;
  banner: string | null;
  // Set only when saving a COMPLETED work session to study history fails.
  // Unlike `banner` it does not auto-clear: a lost study session is worth
  // an error that stays until it's dismissed or a later save succeeds. Never
  // read by the timer/phase logic — display-only, so it can't affect it.
  saveError: string | null;
  initialized: boolean;
  // Which registered course (and, optionally, one of that course's
  // subjects) this session's completed work time gets attributed to in
  // Study Analytics — set once via the pickers in Timer settings, then
  // reused for every phase completion until changed. Deliberately
  // in-memory only (not persisted to UserSettings/DB): it resets to "no
  // course" on app restart rather than risk an unverified backend/schema
  // change for this specific field. Picking a course resets subject to
  // null — a subject from a different course wouldn't make sense.
  linkedCourseId: number | null;
  linkedSubjectId: number | null;
}

let state: PomodoroState = {
  phase: "work",
  running: false,
  phaseEndAt: null,
  remainingSeconds: 25 * 60,
  cyclesCompleted: 0,
  workMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  sessionsBeforeLong: 4,
  autoStart: false,
  banner: null,
  saveError: null,
  initialized: false,
  linkedCourseId: null,
  linkedSubjectId: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let bannerTimeout: number | null = null;

function notify() {
  state = { ...state }; // new reference so useSyncExternalStore detects the change
  listeners.forEach((l) => l());
}

function currentRemaining(): number {
  if (state.running && state.phaseEndAt != null) {
    return Math.max(0, Math.round((state.phaseEndAt - Date.now()) / 1000));
  }
  return state.remainingSeconds;
}

function setBanner(message: string) {
  state.banner = message;
  if (bannerTimeout) window.clearTimeout(bannerTimeout);
  bannerTimeout = window.setTimeout(() => {
    state.banner = null;
    notify();
  }, 6000);
}

function advancePhase() {
  if (state.phase === "work") {
    const nextCycles = state.cyclesCompleted + 1;
    const goingLong = nextCycles % state.sessionsBeforeLong === 0;
    const breakMinutes = goingLong ? state.longBreakMin : state.shortBreakMin;

    // Logged (and the companion events fired) regardless of which page is
    // currently visible — the session completing doesn't depend on the
    // Pomodoro page being mounted, only on this store's own clock.
    // course/subject come from whatever's currently picked in
    // `linkedCourseId`/`linkedSubjectId` (see their doc comment) — this is
    // the entire mechanism that lets a completed Pomodoro work interval
    // show up under "By course"/"By subject" in Study Analytics without a
    // separate manual entry.
    completePomodoroSession(
      state.workMin,
      breakMinutes,
      null,
      state.linkedCourseId,
      state.linkedSubjectId
    )
      .then(() => {
        if (state.saveError) {
          state.saveError = null;
          notify();
        }
      })
      .catch((e) => {
        console.error("Failed to save Pomodoro session:", e);
        state.saveError = String(e);
        notify();
      });

    state.cyclesCompleted = nextCycles;
    state.phase = goingLong ? "long_break" : "short_break";
    state.remainingSeconds = breakMinutes * 60;
    setBanner(goingLong ? "Work session done — long break time." : "Work session done — short break time.");
  } else {
    state.phase = "work";
    state.remainingSeconds = state.workMin * 60;
    setBanner("Break's over — back to work.");
  }

  if (state.autoStart) {
    state.phaseEndAt = Date.now() + state.remainingSeconds * 1000;
    state.running = true;
  } else {
    state.phaseEndAt = null;
    state.running = false;
  }

  notify();
}

function tick() {
  if (!state.running) return;
  const remaining = currentRemaining();
  if (remaining !== state.remainingSeconds) {
    state.remainingSeconds = remaining;
    notify();
  }
  if (remaining <= 0) {
    advancePhase();
  }
}

if (typeof window !== "undefined") {
  // One global 1Hz tick for the whole app lifetime — cheap no-op while
  // paused. Also force a recompute the moment the window/tab regains
  // visibility (covers minimize/switch-window/sleep without waiting up to
  // 1s for the next interval fire, and correctly completes a phase that
  // finished entirely while the window was hidden or the machine asleep).
  window.setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): PomodoroState {
  return state;
}

/** React hook wrapper. Safe to call from a component that mounts/unmounts freely. */
export function usePomodoroStore(): PomodoroState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Seeds the store from persisted settings exactly once — never overwrites a live/in-progress timer on remount. */
export function initFromSettings(settings: UserSettings) {
  if (state.initialized) return;
  state.workMin = settings.pomodoroWorkMinutes;
  state.shortBreakMin = settings.pomodoroShortBreakMinutes;
  state.longBreakMin = settings.pomodoroLongBreakMinutes;
  state.sessionsBeforeLong = settings.pomodoroSessionsBeforeLongBreak;
  state.autoStart = settings.pomodoroAutoStart;
  state.remainingSeconds = state.workMin * 60;
  state.initialized = true;
  notify();
}

export function start() {
  if (state.running) return;
  state.phaseEndAt = Date.now() + state.remainingSeconds * 1000;
  state.running = true;
  notify();
}

export function pause() {
  if (!state.running) return;
  state.remainingSeconds = currentRemaining();
  state.running = false;
  state.phaseEndAt = null;
  notify();
}

export function reset() {
  state.phase = "work";
  state.remainingSeconds = state.workMin * 60;
  state.phaseEndAt = null;
  state.running = false;
  state.cyclesCompleted = 0;
  notify();
}

export function setDurations(partial: {
  workMin?: number;
  shortBreakMin?: number;
  longBreakMin?: number;
  sessionsBeforeLong?: number;
}) {
  Object.assign(state, partial);
  if (!state.running && state.phase === "work" && partial.workMin != null) {
    state.remainingSeconds = state.workMin * 60;
  }
  notify();
}

export function applyPreset(preset: { work: number; short: number; long: number; sessions: number }) {
  state.workMin = preset.work;
  state.shortBreakMin = preset.short;
  state.longBreakMin = preset.long;
  state.sessionsBeforeLong = preset.sessions;
  state.phase = "work";
  state.remainingSeconds = preset.work * 60;
  state.running = false;
  state.phaseEndAt = null;
  notify();
}

export function dismissSaveError() {
  if (state.saveError === null) return;
  state.saveError = null;
  notify();
}

export function setAutoStart(v: boolean) {
  state.autoStart = v;
  notify();
}

/** Sets which course the *next* completed work interval gets attributed
 * to — takes effect the moment it's called (including mid-session), so
 * changing your mind partway through a work interval is fine. `null`
 * means "don't tag this session with a course" (the old behavior).
 * Always clears the linked subject too, since a subject picked for a
 * different course wouldn't make sense. */
export function setLinkedCourse(courseId: number | null) {
  state.linkedCourseId = courseId;
  state.linkedSubjectId = null;
  notify();
}

/** Sets which of the linked course's subjects the next completed work
 * interval gets attributed to. `null` means "just the course, no specific
 * subject" — a perfectly valid choice, not an error state. */
export function setLinkedSubject(subjectId: number | null) {
  state.linkedSubjectId = subjectId;
  notify();
}
