import { useEffect, useRef, useState } from "react";
import type { SVGProps } from "react";
import { Card } from "@/components/Card";
import { ErrorBanner, FieldMessage } from "@/components/ui/Callout";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ToggleField } from "@/components/ui/Toggle";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { updateSettings } from "@/lib/ipc/settings";
import { listCourses, listSubjects } from "@/lib/ipc/courses";
import {
  usePomodoroStore,
  initFromSettings,
  start,
  pause,
  reset,
  setDurations,
  applyPreset,
  setAutoStart,
  setLinkedCourse,
  setLinkedSubject,
  dismissSaveError,
} from "@/features/pomodoro/pomodoroStore";
import type { PomodoroPhase } from "@/features/pomodoro/pomodoroStore";
import type { Course, Subject, UserSettings } from "@/types";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";

const PRESETS = {
  classic: { work: 25, short: 5, long: 15, sessions: 4 },
  deepWork: { work: 50, short: 10, long: 20, sessions: 3 },
} as const;

// SelectMenu is string-keyed — courseId/subjectId are numbers (or null for
// "none"), so they're mapped to/from a string id here rather than
// teaching the shared component about a numeric-or-null value.
const NO_COURSE = "none";
const NO_SUBJECT = "none";

// A distinct ring/label color per phase is itself part of "active-session
// visual hierarchy" — you can tell work from break at a glance, not just
// by reading the small label.
const PHASE_RING: Record<PomodoroPhase, string> = {
  work: "stroke-accent",
  short_break: "stroke-emerald-500",
  long_break: "stroke-sky-500",
};
const PHASE_TEXT: Record<PomodoroPhase, string> = {
  work: "text-accent-text",
  short_break: "text-emerald-700 dark:text-emerald-400",
  long_break: "text-sky-700 dark:text-sky-400",
};

const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <path d="M6 4.2v11.6l9.5-5.8L6 4.2Z" />
    </svg>
  );
}

function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <rect x="5" y="4" width="3.2" height="12" rx="1" />
      <rect x="11.8" y="4" width="3.2" height="12" rx="1" />
    </svg>
  );
}

function ResetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15.8 8.2A5.8 5.8 0 1 0 16 11" />
      <path d="M15.8 4.2v4h-4" />
    </svg>
  );
}

export function PomodoroPage({
  settings,
  onSettingsChange,
}: {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
}) {
  // Seeds the store from persisted settings on first-ever mount only — a
  // no-op on every subsequent mount/remount (navigating away and back),
  // which is exactly what keeps an in-progress timer from resetting.
  useEffect(() => {
    initFromSettings(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timer = usePomodoroStore();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  // Which picker's list failed to load. Previously both silently became an
  // empty list, so the picker just offered "No course" with no hint why.
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    listCourses()
      .then(setCourses)
      .catch(() => {
        setCourses([]);
        setPickerError("Couldn't load your courses, so this session can't be tagged to one right now.");
      });
  }, []);

  // Refetches whenever the linked course changes, scoped to that course —
  // listSubjects(courseId) already supports server-side filtering. No
  // course picked means no subjects to offer.
  useEffect(() => {
    if (timer.linkedCourseId === null) {
      setSubjects([]);
      return;
    }
    setSubjects(null);
    listSubjects(timer.linkedCourseId)
      .then(setSubjects)
      .catch(() => {
        setSubjects([]);
        setPickerError("Couldn't load that course's subjects.");
      });
  }, [timer.linkedCourseId]);

  // Purely presentational: fires a one-shot pulse on the ring whenever the
  // *store's* phase changes (work -> break, break -> work). This never
  // reads or writes any timer value itself — it only watches timer.phase
  // and toggles a local boolean — so it can't reintroduce the old tab-
  // switch/reset bug. Worst case if this component happens to remount at
  // the exact instant of a transition, the pulse is silently skipped once;
  // the actual timer (in the store) is completely unaffected either way.
  const [justTransitioned, setJustTransitioned] = useState(false);
  const prevPhaseRef = useRef(timer.phase);
  useEffect(() => {
    if (prevPhaseRef.current === timer.phase) return;
    prevPhaseRef.current = timer.phase;
    setJustTransitioned(true);
    const timeout = window.setTimeout(() => setJustTransitioned(false), 650);
    return () => window.clearTimeout(timeout);
  }, [timer.phase]);

  // Failures of the two settings saves on this page (the timer itself never
  // depends on them) used to vanish as unhandled rejections.
  const [settingsError, setSettingsError] = useState<string | null>(null);

  async function saveAsDefault() {
    setSettingsError(null);
    try {
      const updated = await updateSettings({
        ...settings,
        pomodoroWorkMinutes: timer.workMin,
        pomodoroShortBreakMinutes: timer.shortBreakMin,
        pomodoroLongBreakMinutes: timer.longBreakMin,
        pomodoroSessionsBeforeLongBreak: timer.sessionsBeforeLong,
      });
      onSettingsChange(updated);
    } catch (e) {
      setSettingsError(`Couldn't save these durations as your default: ${String(e)}`);
    }
  }

  const phaseLabel =
    timer.phase === "work" ? "Focus" : timer.phase === "short_break" ? "Short break" : "Long break";

  const courseOptions = [
    { value: NO_COURSE, label: "No course" },
    ...(courses ?? []).map((c) => ({ value: String(c.id), label: c.name })),
  ];
  const subjectOptions = [
    { value: NO_SUBJECT, label: "No specific subject" },
    ...(subjects ?? []).map((s) => ({ value: String(s.id), label: s.name })),
  ];

  // Progress is derived straight from the store's own remainingSeconds and
  // duration settings every render — nothing new is tracked, so this stays
  // correct across tab switches exactly the same way the digits did.
  const totalPhaseSeconds =
    timer.phase === "work"
      ? timer.workMin * 60
      : timer.phase === "short_break"
        ? timer.shortBreakMin * 60
        : timer.longBreakMin * 60;
  const rawProgress = totalPhaseSeconds > 0 ? 1 - Math.max(0, timer.remainingSeconds) / totalPhaseSeconds : 0;
  const progress = Math.min(1, Math.max(0, rawProgress));
  const ringDashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <PageContainer size="narrow">
      <PageHeader title="Pomodoro" />

      {timer.saveError && (
        <ErrorBanner
          title="Your last focus session wasn't saved to study history"
          message={timer.saveError}
          onDismiss={dismissSaveError}
        />
      )}

      {settingsError && (
        <ErrorBanner title="Settings weren't saved" message={settingsError} onDismiss={() => setSettingsError(null)} />
      )}

      {timer.banner && (
        <div className="rounded-md border border-accent bg-accent-soft text-accent-text text-sm px-3 py-2">
          {timer.banner}
          <span className="text-xs text-text-secondary ml-2">
            (in-app only — OS notifications aren't wired up yet)
          </span>
        </div>
      )}

      <Card
        className={`text-center py-10 transition-shadow duration-300 ${
          timer.running ? "shadow-[0_0_0_1px_var(--color-accent)]" : ""
        }`}
      >
        <div
          className={`relative w-56 h-56 mx-auto ${justTransitioned ? "animate-pomodoro-pulse" : ""}`}
        >
          <svg viewBox="0 0 200 200" className="w-56 h-56 -rotate-90">
            <circle cx="100" cy="100" r={RING_RADIUS} fill="none" strokeWidth="10" className="stroke-border" />
            <circle
              cx="100"
              cy="100"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringDashOffset}
              className={`transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none ${PHASE_RING[timer.phase]}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className={`text-xs uppercase tracking-wide font-medium ${PHASE_TEXT[timer.phase]}`}>
              {phaseLabel}
            </p>
            {/* role="timer" is implicitly aria-live="off", so a screen reader
                reads the time on demand but is NOT interrupted every second. */}
            <p
              role="timer"
              aria-label={`${phaseLabel}: ${formatTime(Math.max(0, timer.remainingSeconds))} remaining`}
              className="text-5xl font-semibold tabular-nums mt-1"
            >
              {formatTime(Math.max(0, timer.remainingSeconds))}
            </p>
            <p className="text-text-secondary text-xs mt-1">
              Cycle {Math.min(timer.cyclesCompleted + 1, timer.sessionsBeforeLong)} of{" "}
              {timer.sessionsBeforeLong}
            </p>
          </div>
        </div>

        <div className="flex justify-center items-center gap-4 mt-8">
          <button
            onClick={() => (timer.running ? pause() : start())}
            aria-label={timer.running ? "Pause" : "Start"}
            className="w-16 h-16 rounded-full bg-accent-fill text-white flex items-center justify-center shadow-md transition-all duration-150 hover:bg-accent-fill-hover active:scale-95"
          >
            {timer.running ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6 ml-0.5" />}
          </button>
          <button
            onClick={reset}
            aria-label="Reset"
            className="w-11 h-11 rounded-full border border-border text-text-secondary flex items-center justify-center transition-all duration-150 hover:bg-bg active:scale-95"
          >
            <ResetIcon className="w-4 h-4" />
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="font-medium mb-3">Timer settings</h2>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="text-sm text-text-secondary">
            Studying for
            <SelectMenu
              className="mt-1 w-full"
              size="sm"
              ariaLabel="Studying for"
              disabled={courses === null}
              options={courseOptions}
              value={timer.linkedCourseId === null ? NO_COURSE : String(timer.linkedCourseId)}
              onChange={(v) => setLinkedCourse(v === NO_COURSE ? null : Number(v))}
            />
          </div>
          <div className="text-sm text-text-secondary">
            Subject
            <SelectMenu
              className="mt-1 w-full"
              size="sm"
              ariaLabel="Subject"
              disabled={timer.linkedCourseId === null || subjects === null}
              options={subjectOptions}
              value={timer.linkedSubjectId === null ? NO_SUBJECT : String(timer.linkedSubjectId)}
              onChange={(v) => setLinkedSubject(v === NO_SUBJECT ? null : Number(v))}
            />
          </div>
        </div>

        {pickerError && <FieldMessage className="-mt-2 mb-4">{pickerError}</FieldMessage>}

        <div className="flex gap-2 mb-4">
          <Button variant="secondary" onClick={() => applyPreset(PRESETS.classic)} disabled={timer.running}>
            Classic (25/5)
          </Button>
          <Button variant="secondary" onClick={() => applyPreset(PRESETS.deepWork)} disabled={timer.running}>
            Deep Work (50/10)
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-text-secondary">
            Work (min)
            <Input
              type="number"
              size="sm"
              min={1}
              disabled={timer.running}
              className="mt-1 w-full"
              value={timer.workMin}
              onChange={(e) => setDurations({ workMin: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Short break (min)
            <Input
              type="number"
              size="sm"
              min={1}
              disabled={timer.running}
              className="mt-1 w-full"
              value={timer.shortBreakMin}
              onChange={(e) => setDurations({ shortBreakMin: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Long break (min)
            <Input
              type="number"
              size="sm"
              min={1}
              disabled={timer.running}
              className="mt-1 w-full"
              value={timer.longBreakMin}
              onChange={(e) => setDurations({ longBreakMin: Number(e.target.value) || 1 })}
            />
          </label>
          <label className="text-sm text-text-secondary">
            Sessions before long break
            <Input
              type="number"
              size="sm"
              min={1}
              disabled={timer.running}
              className="mt-1 w-full"
              value={timer.sessionsBeforeLong}
              onChange={(e) => setDurations({ sessionsBeforeLong: Number(e.target.value) || 1 })}
            />
          </label>
        </div>

        <div className="mt-4">
          <ToggleField
            size="sm"
            checked={timer.autoStart}
            onChange={async (v) => {
              setAutoStart(v);
              setSettingsError(null);
              try {
                const updated = await updateSettings({ ...settings, pomodoroAutoStart: v });
                onSettingsChange(updated);
              } catch (e) {
                // The timer keeps the new value for this session; only the saved default failed.
                setSettingsError(`Auto-start is on for this session but couldn't be saved: ${String(e)}`);
              }
            }}
            label="Auto-start the next interval"
          />
        </div>

        <Button variant="secondary" className="mt-4" onClick={saveAsDefault}>
          Save as my default
        </Button>
      </Card>
    </PageContainer>
  );
}
