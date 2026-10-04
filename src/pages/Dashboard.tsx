import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ui/Callout";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { buttonClass } from "@/components/ui/Button";
import { listTasks } from "@/lib/ipc/tasks";
import { getStudyStats, checkStudyGoals } from "@/lib/ipc/analytics";
import { getFinanceSummary } from "@/lib/ipc/finance";
import { listExams } from "@/lib/ipc/exams";
import { listScheduleBlocks } from "@/lib/ipc/planner";
import { formatCurrency, currentMonthKey } from "@/lib/currency";
import { formatDateOnly, parseDateOnly, toDateKey } from "@/lib/date";
import { CompanionWidget } from "@/features/companion/CompanionWidget";
import { initFromSettings, pause, start, usePomodoroStore } from "@/features/pomodoro/pomodoroStore";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";
import type {
  AssetManifest,
  CompanionState,
  Exam,
  FinanceSummary,
  ScheduleBlock,
  StudyStats,
  Task,
  UserSettings,
} from "@/types";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** A compact secondary-tier stat cell — smaller and quieter than the old
 * uniform stat cards, deliberately, so the eye lands on "Today" first. */
function StatCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "danger";
}) {
  return (
    <Card>
      <p className="text-text-secondary text-xs">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${tone === "danger" ? "text-red-700 dark:text-red-400" : ""}`}>{value}</p>
      {sub && <p className="text-text-secondary text-xs mt-0.5 truncate">{sub}</p>}
    </Card>
  );
}

export function Dashboard({
  settings,
  companion,
}: {
  settings: UserSettings;
  companion: { state: CompanionState | null; manifest: AssetManifest | null; error: string | null };
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [exams, setExams] = useState<Exam[] | null>(null);
  const [todayBlocks, setTodayBlocks] = useState<ScheduleBlock[] | null>(null);
  const timer = usePomodoroStore();

  // Which widgets' loads failed. A failed load deliberately leaves that
  // widget's data as `null` (shown as "—"), NOT as an empty list/zero: the
  // old `.catch(() => setTasks([]))` made a database error look exactly like
  // "you have no tasks", which reads as lost data. `bannerDismissed` only
  // hides the banner — the "—" markers keep reflecting the real state.
  const [failed, setFailed] = useState<string[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const pending = (key: string) => (failed.includes(key) ? "—" : <SkeletonBar />);

  function loadAll() {
    setFailed([]);
    setBannerDismissed(false);
    const track = <T,>(key: string, load: Promise<T>, set: (v: T) => void) =>
      load.then(set).catch(() => setFailed((f) => (f.includes(key) ? f : [...f, key])));
    track("tasks", listTasks(), setTasks);
    track("study stats", getStudyStats("week"), setStats);
    track("finances", getFinanceSummary(currentMonthKey()), setFinance);
    track("exams", listExams(), setExams);
    track("today's schedule", listScheduleBlocks(toDateKey(new Date())), setTodayBlocks);
  }

  useEffect(() => {
    loadAll();
    // Seeds the Pomodoro store from settings the first time anything reads
    // it this session — harmless no-op if the Pomodoro page already did
    // this (initFromSettings is idempotent), but means the mini-widget
    // below shows real durations even if Pomodoro was never opened yet.
    initFromSettings(settings);
    // Evaluates missed-goal/broken-streak conditions once per app load — the
    // parts of Phase 3's companion wiring that depend on absence of activity
    // rather than a fresh session, so they need a check even on days the
    // user hasn't studied yet.
    checkStudyGoals().catch((e) => console.error("Failed to check study goals:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completed = tasks?.filter((t) => t.status === "completed").length ?? 0;
  const total = tasks?.length ?? 0;

  // Filtered by status, not just date — an exam whose date has passed but
  // is still "awaiting_result" has already happened and shouldn't show up
  // as a countdown; only genuinely upcoming exams belong in this widget.
  const upcomingExam = exams
    ?.filter((e) => e.status === "upcoming")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const daysUntil = upcomingExam
    ? Math.round(
        (parseDateOnly(upcomingExam.date).getTime() - parseDateOnly(toDateKey(new Date())).getTime()) /
          86_400_000
      )
    : null;

  const phaseLabel =
    timer.phase === "work" ? "Focus" : timer.phase === "short_break" ? "Short break" : "Long break";

  return (
    <PageContainer size="wide">
      <PageHeader
        title={`${greeting()}${settings.name ? `, ${settings.name}` : ""}`}
        description={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />

      {failed.length > 0 && !bannerDismissed && (
        <ErrorBanner
          title="Some of this page couldn't load"
          message={`Couldn't read: ${failed.join(", ")}. Nothing has been deleted — those widgets just couldn't be read this time.`}
          onReload={loadAll}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/*
        Study, finance, and exams are all real as of Phase 5. Every widget
        here reflects an actual query result or an explicit "not built yet"
        state — never a placeholder number, per the "no fake data" rule.

        Layout: primary column (Today's schedule + Pomodoro) gets 2/3 of
        the width and top billing; secondary stats + Companion sit in a
        narrower column — deliberate hierarchy instead of a uniform grid
        of equally-weighted cards.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-medium">Today's schedule</h2>
              {todayBlocks && todayBlocks.length > 0 && (
                <span className="text-xs text-text-secondary">
                  {todayBlocks.filter((b) => b.completed).length}/{todayBlocks.length} done
                </span>
              )}
            </div>
            {todayBlocks === null && failed.includes("today's schedule") ? (
              <p className="text-sm text-text-secondary">Couldn't load today's schedule.</p>
            ) : todayBlocks === null ? (
              <div className="space-y-2">
                <SkeletonBar className="h-4 w-full" />
                <SkeletonBar className="h-4 w-5/6" />
                <SkeletonBar className="h-4 w-2/3" />
              </div>
            ) : todayBlocks.length > 0 ? (
              <div className="space-y-1.5">
                {todayBlocks.slice(0, 6).map((block) => (
                  <div key={block.id} className="flex items-center justify-between text-sm">
                    <span className={block.completed ? "text-text-secondary line-through" : ""}>
                      {block.title}
                    </span>
                    <span className="text-text-secondary text-xs">
                      {formatTime12h(block.startTs.slice(11, 16))}
                    </span>
                  </div>
                ))}
                {todayBlocks.length > 6 && (
                  <p className="text-text-secondary text-xs pt-1">
                    +{todayBlocks.length - 6} more —{" "}
                    <Link to="/planner" className="text-accent-text hover:underline">
                      see Planner
                    </Link>
                  </p>
                )}
              </div>
            ) : (
              <div className="py-3">
                <p className="text-sm text-text-secondary">Nothing planned for today yet.</p>
                <Link to="/planner" className={buttonClass("secondary", "sm", "inline-block mt-3")}>
                  Plan today
                </Link>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-text-secondary text-xs uppercase tracking-wide">{phaseLabel}</p>
                <p className="text-3xl font-semibold tabular-nums mt-0.5">
                  {formatClock(timer.remainingSeconds)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => (timer.running ? pause() : start())}
                  className={buttonClass("primary", "md")}
                >
                  {timer.running ? "Pause" : "Start"}
                </button>
                <Link to="/pomodoro" className={buttonClass("ghost", "sm")}>
                  Open timer
                </Link>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCell label="Tasks" value={tasks === null ? pending("tasks") : `${completed}/${total}`} sub="completed" />
            <StatCell
              label="Study today"
              value={stats === null ? pending("study stats") : `${stats.todayMinutes}m`}
              sub={
                stats && stats.dailyGoalMinutes > 0
                  ? `of ${stats.dailyGoalMinutes}m · ${stats.currentStreak}d streak`
                  : stats
                    ? `${stats.currentStreak}d streak`
                    : failed.includes("study stats")
                      ? "unavailable"
                      : ""
              }
            />
            <StatCell
              label="This month"
              value={
                finance === null ? (
                  pending("finances")
                ) : (
                  formatCurrency(finance.remainingBalance, settings.currency)
                )
              }
              sub="remaining"
              tone={finance && finance.remainingBalance < 0 ? "danger" : undefined}
            />
            <StatCell
              label="Exam"
              value={
                exams === null ? (
                  pending("exams")
                ) : upcomingExam ? (
                  daysUntil === 0 ? (
                    "Today"
                  ) : (
                    `${daysUntil}d`
                  )
                ) : (
                  "—"
                )
              }
              sub={
                upcomingExam
                  ? `${upcomingExam.name} — ${formatDateOnly(upcomingExam.date)}`
                  : "none scheduled"
              }
            />
          </div>

          {/* Companion widget — first-class subsystem added in Phase 1B. Reacts
              to real events (tasks, study/Pomodoro, exams); every other domain
              wires in its own events as those phases land (architecture.md A11). */}
          {settings.companionEnabled && (
            <CompanionWidget state={companion.state} manifest={companion.manifest} error={companion.error} />
          )}
        </div>
      </div>
    </PageContainer>
  );
}
