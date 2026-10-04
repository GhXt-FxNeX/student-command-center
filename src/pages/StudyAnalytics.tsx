import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState } from "@/components/Card";
import { ErrorBanner } from "@/components/ui/Callout";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { getStudyStats } from "@/lib/ipc/analytics";
import { formatDateOnly } from "@/lib/date";
import type { StudyStats, StudyStatsRange } from "@/types";
import { Link } from "react-router-dom";
import { buttonClass } from "@/components/ui/Button";
import { ChartIcon } from "@/components/ui/icons";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";

const RANGES: { value: StudyStatsRange; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

function bucketLabel(label: string, range: StudyStatsRange): string {
  if (range === "day") {
    // "HH" (24h) -> "9am" / "2pm", matching how the other ranges format
    // their own axis labels into something a chart tooltip reads well.
    const hour = Number(label);
    const period = hour >= 12 ? "pm" : "am";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12}${period}`;
  }
  if (range === "year") {
    // "YYYY-MM" — format without going through Date/UTC parsing.
    const [, m] = label.split("-");
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[Number(m) - 1] ?? label;
  }
  return formatDateOnly(label, { weekday: "short", day: "numeric" });
}

function BreakdownCard({
  title,
  emptyTitle,
  rows,
}: {
  title: string;
  emptyTitle: string;
  rows: { name: string; minutes: number }[];
}) {
  return (
    <Card>
      <h2 className="font-medium mb-3">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center justify-between text-sm">
              <span className="truncate">{r.name}</span>
              <span className="text-text-secondary shrink-0 ml-2">{r.minutes}m</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function StudyAnalyticsPage() {
  const [range, setRange] = useState<StudyStatsRange>("week");
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setStats(null);
    setError(null);
    getStudyStats(range)
      .then(setStats)
      .catch((e) => setError(String(e)));
  }, [range, reloadTick]);

  const chartData = stats?.buckets.map((b) => ({ label: bucketLabel(b.label, range), minutes: b.minutes })) ?? [];
  const peak = chartData.reduce((best, d) => (d.minutes > best.minutes ? d : best), { label: "", minutes: 0 });
  const chartSummary = stats
    ? `Bar chart of study minutes over ${chartData.length} periods: ${stats.totalMinutes} minutes in total${
        peak.minutes > 0 ? `, the most on ${peak.label} (${peak.minutes} minutes)` : ""
      }.`
    : "";
  const weeklyGoalPct =
    stats && stats.weeklyGoalMinutes > 0
      ? Math.min(100, Math.round((stats.thisWeekMinutes / stats.weeklyGoalMinutes) * 100))
      : null;
  const dailyGoalPct =
    stats && stats.dailyGoalMinutes > 0
      ? Math.min(100, Math.round((stats.todayMinutes / stats.dailyGoalMinutes) * 100))
      : null;

  return (
    <PageContainer size="default">
      <PageHeader
        title="Study Analytics"
        actions={<SegmentedControl ariaLabel="Time range" options={RANGES} value={range} onChange={setRange} />}
      />

      {error && (
        <ErrorBanner
          message={error}
          title="Couldn't load study analytics"
          onReload={() => setReloadTick((t) => t + 1)}
          onDismiss={() => setError(null)}
        />
      )}

      {!stats ? error ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <SkeletonBar className="h-3 w-16" />
                <SkeletonBar className="h-7 w-12 mt-2" />
              </Card>
            ))}
          </div>
          <Card>
            <SkeletonBar className="h-[220px] w-full" />
          </Card>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <p className="text-text-secondary text-sm">Current streak</p>
              <p className="text-2xl font-semibold mt-1">{stats.currentStreak}d</p>
            </Card>
            <Card>
              <p className="text-text-secondary text-sm">Longest streak</p>
              <p className="text-2xl font-semibold mt-1">{stats.longestStreak}d</p>
            </Card>
            <Card>
              <p className="text-text-secondary text-sm">Today</p>
              <p className="text-2xl font-semibold mt-1">{stats.todayMinutes}m</p>
              {dailyGoalPct !== null && (
                <>
                  <ProgressBar pct={dailyGoalPct} className="mt-2" />
                  <p className="text-text-secondary text-xs mt-1">{dailyGoalPct}% of daily goal</p>
                </>
              )}
            </Card>
            <Card>
              <p className="text-text-secondary text-sm">This week</p>
              <p className="text-2xl font-semibold mt-1">{stats.thisWeekMinutes}m</p>
              {weeklyGoalPct !== null && (
                <>
                  <ProgressBar pct={weeklyGoalPct} className="mt-2" />
                  <p className="text-text-secondary text-xs mt-1">{weeklyGoalPct}% of weekly goal</p>
                </>
              )}
            </Card>
          </div>

          <Card>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-medium">Study time</h2>
              <p className="text-text-secondary text-xs">
                {stats.totalMinutes}m total · avg {Math.round(stats.averageMinutesPerActiveDay)}m/active day
              </p>
            </div>
            {chartData.every((d) => d.minutes === 0) ? (
              <EmptyState
                icon={<ChartIcon className="w-5 h-5" />}
                title="No study time logged in this range"
                description="Study time is recorded when a Pomodoro focus session finishes. Run one to start your trend."
                action={
                  <Link to="/pomodoro" className={buttonClass("primary", "md")}>
                    Start a Pomodoro
                  </Link>
                }
              />
            ) : (
              <div role="img" aria-label={chartSummary} style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                      axisLine={{ stroke: "var(--color-border)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [`${value}m`, "Study time"]}
                    />
                    <Bar dataKey="minutes" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <BreakdownCard
              title="By course"
              emptyTitle="No course-tagged study time yet"
              rows={stats.byCourse.map((c) => ({ name: c.courseName, minutes: c.minutes }))}
            />
            <BreakdownCard
              title="By subject"
              emptyTitle="No subject-tagged study time yet"
              rows={stats.bySubject.map((s) => ({ name: s.subjectName, minutes: s.minutes }))}
            />
          </div>
        </>
      )}
    </PageContainer>
  );
}
