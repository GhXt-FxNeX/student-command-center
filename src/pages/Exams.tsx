import { useEffect, useMemo, useState } from "react";
import type { SVGProps } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState } from "@/components/Card";
import { ErrorBanner, FieldMessage } from "@/components/ui/Callout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { ToggleField } from "@/components/ui/Toggle";
import { formatDateOnly, toDateKey } from "@/lib/date";
import { listCourses, listSubjects } from "@/lib/ipc/courses";
import { createExam, deleteExam, getExamStats, listExams, updateExam } from "@/lib/ipc/exams";
import type { Course, Exam, ExamStats, NewExam, Subject } from "@/types";
import { ChartIcon, ClipboardIcon } from "@/components/ui/icons";
import { focusField } from "@/lib/focusField";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";
import { FormField } from "@/components/ui/FormField";

const EMPTY_EXAM_FORM: NewExam = {
  name: "",
  courseId: null,
  subjectId: null,
  date: toDateKey(new Date()),
  status: "upcoming",
  score: null,
  maxScore: null,
  notes: "",
};

// SelectMenu is string-keyed — courseId/subjectId are numbers (or null) —
// same NO_COURSE/NO_SUBJECT sentinel pattern Pomodoro.tsx and Finances.tsx
// already use for their own course/category pickers.
const NO_COURSE = "none";
const NO_SUBJECT = "none";

// ---- Icons (local, stroke-based — matches the style already established
// in Pomodoro.tsx's PlayIcon/ResetIcon; kept local to this page rather than
// shared, same as those). Deliberately a distinct set from Finances.tsx's
// icons — Overall average/Highest/Lowest/Graded exams are exam-flavored
// concepts, not the trend-arrows Finance uses for income/expense. ----

/** A small bar chart with a dashed average line through it — for the one
 * stat that's explicitly an average across every graded exam. */
function BarsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" {...props}>
      <path d="M4.5 15.5v-4" />
      <path d="M10 15.5v-8" />
      <path d="M15.5 15.5v-6" />
      <path d="M2.7 10.3h14.6" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  );
}

/** A star for the best result — reads as "top score" without borrowing
 * Finance's up-trend-arrow shape. */
function StarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" {...props}>
      <path d="M10 2.6 11.8 7.7 17.3 7.8 12.9 11 14.5 16.3 10 13.1 5.5 16.3 7.1 11 2.7 7.8 8.2 7.7Z" />
    </svg>
  );
}

/** An arrow dropping to a baseline — a "minimum" glyph, distinct from
 * Finance's diagonal trend-down arrow. */
function MinArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 3.5v9" />
      <path d="M6.5 9 10 12.5 13.5 9" />
      <path d="M4.5 15.5h11" />
    </svg>
  );
}

function ChecklistIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3.5 5.5h9M3.5 10h9M3.5 14.5h6" />
      <path d="M15 4.3l1 1 1.8-1.8" />
    </svg>
  );
}

/** Green at strong scores, red at weak ones, neutral in between — same
 * visual language as Finance's over-budget red highlighting. Only ever
 * called with a real percentage (completed exams), never a placeholder. */
function percentageColor(pct: number): string {
  if (pct >= 90) return "text-emerald-700 dark:text-emerald-400";
  if (pct < 60) return "text-red-700 dark:text-red-400";
  return "text-text";
}

/** Client-side mirror of the server's validate_result rule (commands/
 * exams.rs) so the form can show an inline error before submitting, without
 * the server rule and this one ever being able to silently drift apart in
 * what they each consider valid — every branch here matches a branch there. */
function validateResult(score: number | null, maxScore: number | null): string | null {
  if (score === null && maxScore === null) return null;
  if (score !== null && maxScore === null) return "Total score is required when a score is entered.";
  if (score === null && maxScore !== null) return "Score is required when a total score is entered.";
  if (maxScore !== null && maxScore <= 0) return "Total score must be greater than 0.";
  if (score !== null && score < 0) return "Score cannot be negative.";
  if (score !== null && maxScore !== null && score > maxScore) return "Score cannot exceed the total score.";
  return null;
}

export function ExamsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]); // all subjects, across courses
  const [exams, setExams] = useState<Exam[]>([]);
  const [stats, setStats] = useState<ExamStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [examForm, setExamForm] = useState<NewExam>(EMPTY_EXAM_FORM);
  const [editingExamId, setEditingExamId] = useState<number | null>(null);

  async function refreshCourses() {
    try {
      setCourses(await listCourses());
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshSubjects() {
    try {
      setSubjects(await listSubjects(null));
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshExams() {
    try {
      setExams(await listExams());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshStats() {
    try {
      setStats(await getExamStats());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refreshCourses();
    refreshSubjects();
    refreshExams();
    refreshStats();
  }, []);

  // ---- Exams ----

  // `?? null`: NewExam.score/maxScore are optional (number | null | undefined) but
  // validateResult takes number | null — undefined and null mean the same here.
  const resultError = validateResult(examForm.score ?? null, examForm.maxScore ?? null);

  async function submitExam(e: React.FormEvent) {
    e.preventDefault();
    if (!examForm.name.trim() || !examForm.date || resultError) return;
    try {
      if (editingExamId !== null) {
        await updateExam(editingExamId, examForm);
      } else {
        await createExam(examForm);
      }
      setExamForm({ ...EMPTY_EXAM_FORM, date: examForm.date });
      setEditingExamId(null);
      await refreshExams();
      await refreshStats();
    } catch (err) {
      setError(String(err));
    }
  }

  function startEditExam(exam: Exam) {
    setEditingExamId(exam.id);
    setExamForm({
      name: exam.name,
      courseId: exam.courseId,
      subjectId: exam.subjectId,
      date: exam.date,
      // A completed exam's declared pre-result status is moot (a result
      // already exists), but keeping it as "awaiting_result" here means
      // clearing the score in the edit form falls back to that state
      // rather than silently reverting to "upcoming" for an exam that's
      // clearly already been taken.
      status: exam.status === "upcoming" ? "upcoming" : "awaiting_result",
      score: exam.score,
      maxScore: exam.maxScore,
      notes: exam.notes ?? "",
    });
  }

  async function removeExam(id: number) {
    try {
      await deleteExam(id);
      await refreshExams();
      await refreshStats();
    } catch (err) {
      setError(String(err));
    }
  }

  // Courses/subjects themselves are now managed on the dedicated Courses
  // page (src/pages/Courses.tsx) — this page only reads the lists to tag
  // an exam, via refreshCourses()/refreshSubjects() above.

  const subjectsForExamCourse = useMemo(
    () => subjects.filter((s) => s.courseId === examForm.courseId),
    [subjects, examForm.courseId],
  );

  // Only completed exams (a real, recorded result) ever feed a percentage
  // chart — upcoming/awaiting-result exams have nothing to plot yet.
  const chartData = useMemo(
    () =>
      exams
        .filter((ex) => ex.status === "completed" && ex.percentage !== null)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((ex) => ({
          date: formatDateOnly(ex.date, { month: "short", day: "numeric" }),
          percentage: ex.percentage as number,
        })),
    [exams],
  );

  // Text alternative for the chart (Recharts' SVG is invisible to assistive tech).
  const chartSummary =
    chartData.length === 0
      ? ""
      : `Line chart of your graded exam scores over time: ${chartData.length} ${chartData.length === 1 ? "exam" : "exams"}, from ${Math.round(chartData[0].percentage)}% on ${chartData[0].date} to ${Math.round(chartData[chartData.length - 1].percentage)}% on ${chartData[chartData.length - 1].date}.`;

  const upcoming = useMemo(
    () => exams.filter((ex) => ex.status === "upcoming").sort((a, b) => a.date.localeCompare(b.date)),
    [exams],
  );
  const awaitingResult = useMemo(
    () => exams.filter((ex) => ex.status === "awaiting_result").sort((a, b) => b.date.localeCompare(a.date)),
    [exams],
  );
  const completedExams = useMemo(
    () => exams.filter((ex) => ex.status === "completed").sort((a, b) => b.date.localeCompare(a.date)),
    [exams],
  );

  return (
    <PageContainer size="default">
      <PageHeader title="Exams" />

      {error && (
        <ErrorBanner
          message={error}
          onReload={() => {
            setError(null);
            refreshCourses();
            refreshSubjects();
            refreshExams();
            refreshStats();
          }}
          onDismiss={() => setError(null)}
        />
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <SkeletonBar className="h-3 w-16" />
              <SkeletonBar className="h-7 w-20 mt-2" />
            </Card>
          ))}
        </div>
      ) : (
        stats &&
        stats.completedCount > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Overall average"
              value={stats.overallAverage !== null ? `${stats.overallAverage.toFixed(1)}%` : "—"}
              valueClassName={percentageColor(stats.overallAverage ?? 0)}
              icon={<BarsIcon className="w-4 h-4" />}
              iconClassName="bg-accent-soft text-accent-text"
            />
            <StatCard
              label="Highest"
              value={
                stats.highest?.percentage !== null && stats.highest?.percentage !== undefined
                  ? `${stats.highest.percentage.toFixed(1)}%`
                  : "—"
              }
              valueClassName="text-emerald-700 dark:text-emerald-400"
              icon={<StarIcon className="w-4 h-4" />}
              iconClassName="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              sub={
                stats.highest ? (
                  <p className="text-text-secondary text-xs mt-1 truncate">{stats.highest.name}</p>
                ) : undefined
              }
            />
            <StatCard
              label="Lowest"
              value={
                stats.lowest?.percentage !== null && stats.lowest?.percentage !== undefined
                  ? `${stats.lowest.percentage.toFixed(1)}%`
                  : "—"
              }
              valueClassName="text-red-700 dark:text-red-400"
              icon={<MinArrowIcon className="w-4 h-4" />}
              iconClassName="bg-red-500/10 text-red-700 dark:text-red-300"
              sub={
                stats.lowest ? (
                  <p className="text-text-secondary text-xs mt-1 truncate">{stats.lowest.name}</p>
                ) : undefined
              }
            />
            <StatCard
              label="Graded exams"
              value={String(stats.completedCount)}
              icon={<ChecklistIcon className="w-4 h-4" />}
              iconClassName="bg-accent-soft text-accent-text"
            />
          </div>
        )
      )}

      <Card>
        <form onSubmit={submitExam} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              className="sm:col-span-2"
              id="exam-name-input"
              aria-label="Exam name"
              placeholder="Exam name (e.g. Anatomy Midterm) *"
              value={examForm.name}
              onChange={(e) => setExamForm({ ...examForm, name: e.target.value })}
              required
            />
            <FormField label="Exam date">
              <Input
                type="date"
                value={examForm.date}
                onChange={(e) => setExamForm({ ...examForm, date: e.target.value })}
                required
              />
            </FormField>
            <ToggleField
              size="sm"
              checked={examForm.status === "awaiting_result" || examForm.score !== null}
              disabled={examForm.score !== null}
              onChange={(v) => setExamForm({ ...examForm, status: v ? "awaiting_result" : "upcoming" })}
              label="Exam has been taken"
              description="Result pending"
            />
            <SelectMenu
              ariaLabel="Course"
              value={examForm.courseId === null ? NO_COURSE : String(examForm.courseId)}
              onChange={(v) => {
                const courseId = v === NO_COURSE ? null : Number(v);
                // Changing course invalidates any previously selected subject
                // from a different course — reset it rather than leave a
                // subjectId pointing at a subject that no longer applies.
                setExamForm({ ...examForm, courseId, subjectId: null });
              }}
              options={[
                { value: NO_COURSE, label: "No course" },
                ...courses.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
            />
            <SelectMenu
              ariaLabel="Subject"
              value={examForm.subjectId === null ? NO_SUBJECT : String(examForm.subjectId)}
              onChange={(v) => setExamForm({ ...examForm, subjectId: v === NO_SUBJECT ? null : Number(v) })}
              disabled={examForm.courseId === null}
              options={
                examForm.courseId === null
                  ? [{ value: NO_SUBJECT, label: "Select a course first" }]
                  : [
                      { value: NO_SUBJECT, label: "No subject" },
                      ...subjectsForExamCourse.map((s) => ({ value: String(s.id), label: s.name })),
                    ]
              }
            />
            <p className="text-text-secondary text-xs sm:col-span-2 -mt-1">
              Don't see the course you need?{" "}
              <Link to="/courses" className="text-accent-text hover:underline">
                Manage courses &amp; subjects
              </Link>
            </p>
          </div>

          <div className="rounded-md border border-border bg-bg p-3 space-y-2">
            <p className="text-xs font-medium text-text-secondary">Result (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min={0}
                step="0.01"
                tone="surface"
                aria-label="Your score"
                placeholder="Your score"
                value={examForm.score ?? ""}
                onChange={(e) =>
                  setExamForm({ ...examForm, score: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
              <Input
                type="number"
                min={0.01}
                step="0.01"
                tone="surface"
                aria-label="Total score"
                placeholder="Total score"
                value={examForm.maxScore ?? ""}
                onChange={(e) =>
                  setExamForm({ ...examForm, maxScore: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            {resultError ? (
              <FieldMessage>{resultError}</FieldMessage>
            ) : examForm.score != null && examForm.maxScore != null ? (
              <FieldMessage tone="success">
                {((examForm.score / examForm.maxScore) * 100).toFixed(1)}% — will be marked Completed
              </FieldMessage>
            ) : (
              <p className="text-xs text-text-secondary">No result yet — leave both blank until it's graded.</p>
            )}
          </div>

          <textarea
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm transition-colors focus:border-accent"
            placeholder="Notes (optional)"
            aria-label="Notes (optional)"
            rows={2}
            value={examForm.notes ?? ""}
            onChange={(e) => setExamForm({ ...examForm, notes: e.target.value })}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="md" disabled={!!resultError}>
              {editingExamId !== null ? "Save changes" : "Add exam"}
            </Button>
            {editingExamId !== null && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setEditingExamId(null);
                  setExamForm(EMPTY_EXAM_FORM);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      {loading ? (
        <div className="space-y-4">
          <Card>
            <SkeletonBar className="h-4 w-24 mb-3" />
            <div className="space-y-2.5">
              <SkeletonBar className="h-4 w-full" />
              <SkeletonBar className="h-4 w-full" />
              <SkeletonBar className="h-4 w-3/4" />
            </div>
          </Card>
        </div>
      ) : exams.length === 0 ? (
        error ? null : (
          <Card>
            <EmptyState
              icon={<ClipboardIcon className="w-5 h-5" />}
              title="No exams yet"
              description="Add an upcoming exam so the Dashboard can count down to it. A result isn't needed until it's graded."
              action={
                <Button variant="primary" size="md" onClick={() => focusField("exam-name-input")}>
                  Add an exam
                </Button>
              }
            />
          </Card>
        )
      ) : (
        <div className="space-y-4">
          <ExamGroup title="📅 Upcoming" exams={upcoming} onEdit={startEditExam} onDelete={removeExam} />
          <ExamGroup title="⏳ Awaiting Results" exams={awaitingResult} onEdit={startEditExam} onDelete={removeExam} />
          <ExamGroup title="🏆 Results" exams={completedExams} onEdit={startEditExam} onDelete={removeExam} />
        </div>
      )}

      <Card>
        <h2 className="font-medium mb-3">Performance over time</h2>
        {chartData.length === 0 ? (
          <EmptyState
            compact
            icon={<ChartIcon className="w-5 h-5" />}
            title="No graded exams yet"
            description="Once an exam has a recorded result, your performance trend shows up here."
          />
        ) : (
          <div role="img" aria-label={chartSummary} style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "var(--color-text-secondary)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "Score"]}
                />
                <Line type="monotone" dataKey="percentage" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {stats && stats.bySubject.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <p className="text-text-secondary text-xs mb-2">Average by subject</p>
            {stats.bySubject.map((s) => (
              <div key={s.subjectId} className="flex items-center justify-between text-sm">
                <span>{s.subjectName}</span>
                <span className={percentageColor(s.averagePercentage)}>
                  {s.averagePercentage.toFixed(1)}% <span className="text-text-secondary">({s.examCount})</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

/** One lifecycle section of the exam list (Upcoming / Awaiting Results /
 * Results). Rendered only when it has exams — an empty section adds noise
 * without adding information, so the group simply doesn't appear rather
 * than showing an empty-state card for every unused bucket. */
function ExamGroup({
  title,
  exams,
  onEdit,
  onDelete,
}: {
  title: string;
  exams: Exam[];
  onEdit: (exam: Exam) => void;
  onDelete: (id: number) => void;
}) {
  if (exams.length === 0) return null;
  return (
    <Card>
      <h2 className="font-medium mb-3">{title}</h2>
      <div className="space-y-1.5">
        {exams.map((exam) => (
          <div key={exam.id} className="flex items-center justify-between gap-3 text-sm py-1">
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-text-secondary text-xs shrink-0">{formatDateOnly(exam.date)}</span>
              <span className="truncate font-medium">{exam.name}</span>
              {exam.courseName && <span className="text-text-secondary text-xs shrink-0">{exam.courseName}</span>}
              {exam.subjectName && <span className="text-text-secondary text-xs shrink-0">· {exam.subjectName}</span>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <ResultBadge exam={exam} />
              <button className="text-accent-text hover:underline text-xs" onClick={() => onEdit(exam)}>
                Edit
              </button>
              <button className="text-red-700 dark:text-red-400 hover:underline text-xs" onClick={() => onDelete(exam.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** The three lifecycle states are visually and textually distinct on
 * purpose — "No result yet" (upcoming), "Result pending" (awaiting), and
 * an actual percentage (completed) must never be confusable with each
 * other or with a real 0%. */
function ResultBadge({ exam }: { exam: Exam }) {
  if (exam.status === "upcoming") {
    return <span className="text-text-secondary text-xs">No result yet</span>;
  }
  if (exam.status === "awaiting_result") {
    return <span className="text-amber-700 dark:text-amber-400 text-xs font-medium">Result pending</span>;
  }
  // status === "completed" — score/maxScore/percentage are guaranteed
  // present by the server's invariant (see models.rs::Exam doc comment).
  return (
    <span className={`font-medium ${percentageColor(exam.percentage ?? 0)}`}>
      {exam.score}/{exam.maxScore} ({(exam.percentage ?? 0).toFixed(1)}%)
    </span>
  );
}
