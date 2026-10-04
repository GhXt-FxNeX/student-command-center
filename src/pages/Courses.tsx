import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/Card";
import { ErrorBanner } from "@/components/ui/Callout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { Toggle } from "@/components/ui/Toggle";
import {
  createCourse,
  createSubject,
  deleteCourse,
  deleteSubject,
  listCourses,
  listSubjects,
  listWeeklySchedule,
  removeWeeklyScheduleDay,
  setWeeklyScheduleDay,
  updateCourse,
  updateSubject,
} from "@/lib/ipc/courses";
import type { Course, Subject, SubjectScheduleEntry, WeekdayName } from "@/types";
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from "@/types";
import { ChevronIcon } from "@/components/ui/icons";
import { BookIcon } from "@/components/ui/icons";
import { focusField } from "@/lib/focusField";
import { LoadingState } from "@/components/ui/Spinner";
import { PageContainer } from "@/components/ui/PageHeader";

const DEFAULT_COLOR = "#4f7cff";

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState<"active" | "all">("active");

  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseColor, setNewCourseColor] = useState(DEFAULT_COLOR);

  const [expandedCourseId, setExpandedCourseId] = useState<number | null>(null);
  const [editingCourseId, setEditingCourseId] = useState<number | null>(null);
  const [courseEditName, setCourseEditName] = useState("");
  const [courseEditColor, setCourseEditColor] = useState(DEFAULT_COLOR);
  const [confirmDeleteCourseId, setConfirmDeleteCourseId] = useState<number | null>(null);

  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectColor, setNewSubjectColor] = useState(DEFAULT_COLOR);
  const [editingSubjectId, setEditingSubjectId] = useState<number | null>(null);
  const [subjectEditName, setSubjectEditName] = useState("");
  const [subjectEditColor, setSubjectEditColor] = useState(DEFAULT_COLOR);
  const [confirmDeleteSubjectId, setConfirmDeleteSubjectId] = useState<number | null>(null);

  const [expandedSubjectId, setExpandedSubjectId] = useState<number | null>(null);
  const [scheduleBySubject, setScheduleBySubject] = useState<Record<number, SubjectScheduleEntry[]>>({});
  const [scheduleLoading, setScheduleLoading] = useState(false);

  async function refresh() {
    try {
      const [c, s] = await Promise.all([listCourses(), listSubjects(null)]);
      setCourses(c);
      setSubjects(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const subjectsByCourse = useMemo(() => {
    const map = new Map<number, Subject[]>();
    for (const s of subjects) {
      const list = map.get(s.courseId) ?? [];
      list.push(s);
      map.set(s.courseId, list);
    }
    return map;
  }, [subjects]);

  const hasArchived = courses.some((c) => c.archived);
  const visibleCourses = courseFilter === "all" ? courses : courses.filter((c) => !c.archived);

  async function handleAddCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!newCourseName.trim()) return;
    try {
      await createCourse(newCourseName.trim(), newCourseColor);
      setNewCourseName("");
      setNewCourseColor(DEFAULT_COLOR);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function startEditCourse(c: Course) {
    setEditingCourseId(c.id);
    setCourseEditName(c.name);
    setCourseEditColor(c.color);
  }

  async function saveEditCourse(c: Course) {
    try {
      await updateCourse(c.id, courseEditName.trim() || c.name, courseEditColor, c.archived);
      setEditingCourseId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleArchiveCourse(c: Course) {
    try {
      await updateCourse(c.id, c.name, c.color, !c.archived);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteCourse(id: number) {
    try {
      await deleteCourse(id);
      setConfirmDeleteCourseId(null);
      if (expandedCourseId === id) setExpandedCourseId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleAddSubject(e: React.FormEvent, courseId: number) {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    try {
      await createSubject({ courseId, name: newSubjectName.trim(), color: newSubjectColor });
      setNewSubjectName("");
      setNewSubjectColor(DEFAULT_COLOR);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function startEditSubject(s: Subject) {
    setEditingSubjectId(s.id);
    setSubjectEditName(s.name);
    setSubjectEditColor(s.color ?? DEFAULT_COLOR);
  }

  async function saveEditSubject(s: Subject) {
    try {
      await updateSubject(s.id, subjectEditName.trim() || s.name, subjectEditColor);
      setEditingSubjectId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteSubject(id: number) {
    try {
      await deleteSubject(id);
      setConfirmDeleteSubjectId(null);
      if (expandedSubjectId === id) setExpandedSubjectId(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleSchedulePanel(subjectId: number) {
    if (expandedSubjectId === subjectId) {
      setExpandedSubjectId(null);
      return;
    }
    setExpandedSubjectId(subjectId);
    if (!scheduleBySubject[subjectId]) {
      setScheduleLoading(true);
      try {
        const entries = await listWeeklySchedule(subjectId);
        setScheduleBySubject((prev) => ({ ...prev, [subjectId]: entries }));
      } catch (e) {
        setError(String(e));
      } finally {
        setScheduleLoading(false);
      }
    }
  }

  async function handleSetDay(subjectId: number, day: WeekdayName, startTime: string, endTime: string) {
    try {
      const entry = await setWeeklyScheduleDay(subjectId, day, startTime, endTime || null);
      setScheduleBySubject((prev) => {
        const existing = (prev[subjectId] ?? []).filter((e) => e.dayOfWeek !== day);
        return { ...prev, [subjectId]: [...existing, entry] };
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleClearDay(subjectId: number, day: WeekdayName) {
    try {
      await removeWeeklyScheduleDay(subjectId, day);
      setScheduleBySubject((prev) => ({
        ...prev,
        [subjectId]: (prev[subjectId] ?? []).filter((e) => e.dayOfWeek !== day),
      }));
    } catch (e) {
      setError(String(e));
    }
  }

  if (loading) {
    return (
      <PageContainer size="default">
        <SkeletonBar className="h-7 w-28" />
        <Card>
          <SkeletonBar className="h-9 w-full" />
        </Card>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <SkeletonBar className="h-5 w-40" />
            </Card>
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="default">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
        {hasArchived && (
          <SegmentedControl ariaLabel="Course filter"
            options={[
              { value: "active", label: "Active" },
              { value: "all", label: "All" },
            ]}
            value={courseFilter}
            onChange={setCourseFilter}
          />
        )}
      </div>

      {error && <ErrorBanner message={error} onReload={refresh} onDismiss={() => setError(null)} />}

      <Card>
        <form onSubmit={handleAddCourse} className="flex items-center gap-2">
          <Input
            className="flex-1"
            id="new-course-input"
            aria-label="New course name"
            placeholder='Add a course (e.g. "205CNS")'
            value={newCourseName}
            onChange={(e) => setNewCourseName(e.target.value)}
          />
          <input
            aria-label="New course color"
type="color"
            className="w-10 h-9 shrink-0 rounded-md border border-border bg-surface cursor-pointer transition-colors focus:border-accent"
            value={newCourseColor}
            onChange={(e) => setNewCourseColor(e.target.value)}
            title="Color"
          />
          <Button type="submit" variant="primary" size="md" disabled={!newCourseName.trim()}>
            Add
          </Button>
        </form>
      </Card>

      {visibleCourses.length === 0 ? (
        error && courses.length === 0 ? null : (
        <EmptyState
          icon={<BookIcon className="w-5 h-5" />}
          title={courses.length === 0 ? "No courses yet" : "No active courses"}
          description={
            courses.length === 0
              ? "Courses organize your subjects, exams, class times and study analytics. Add your first, e.g. \"205CNS\"."
              : "Every course is archived — switch to All to see them."
          }
          action={
            courses.length === 0 ? (
              <Button variant="primary" size="md" onClick={() => focusField("new-course-input")}>
                Add a course
              </Button>
            ) : undefined
          }
        />
        )
      ) : (
        <div className="space-y-3">
          {visibleCourses.map((c) => {
            const courseSubjects = subjectsByCourse.get(c.id) ?? [];
            const isExpanded = expandedCourseId === c.id;
            return (
              <Card key={c.id} className={c.archived ? "opacity-60" : ""}>
                {editingCourseId === c.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      aria-label="Course name"
                      value={courseEditName}
                      onChange={(e) => setCourseEditName(e.target.value)}
                    />
                    <input
                      aria-label="Course color"
type="color"
                      className="w-9 h-8 shrink-0 rounded-md border border-border bg-surface cursor-pointer transition-colors focus:border-accent"
                      value={courseEditColor}
                      onChange={(e) => setCourseEditColor(e.target.value)}
                    />
                    <Button variant="primary" size="sm" onClick={() => saveEditCourse(c)}>
                      Save
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditingCourseId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => setExpandedCourseId(isExpanded ? null : c.id)}
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: c.color }}
                      />
                      <span className="font-medium text-sm truncate">{c.name}</span>
                      <span className="text-xs text-text-secondary shrink-0">
                        {courseSubjects.length} subject{courseSubjects.length === 1 ? "" : "s"}
                      </span>
                      {c.archived && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-bg border border-border text-text-secondary shrink-0">
                          Archived
                        </span>
                      )}
                      <ChevronIcon
                        className={`w-3.5 h-3.5 text-text-secondary shrink-0 transition-transform duration-150 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    <div className="flex gap-3 shrink-0 text-xs">
                      <button onClick={() => startEditCourse(c)} className="text-accent-text hover:underline transition-colors">
                        Edit
                      </button>
                      <button onClick={() => toggleArchiveCourse(c)} className="text-text-secondary hover:underline transition-colors">
                        {c.archived ? "Unarchive" : "Archive"}
                      </button>
                      {confirmDeleteCourseId === c.id ? (
                        <>
                          <button onClick={() => handleDeleteCourse(c.id)} className="text-red-700 dark:text-red-400 hover:underline transition-colors">
                            Confirm delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteCourseId(null)}
                            className="text-text-secondary hover:underline transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteCourseId(c.id)}
                          className="text-red-700 dark:text-red-400 hover:underline transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    <form onSubmit={(e) => handleAddSubject(e, c.id)} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        aria-label="New subject name"
            placeholder="Add a subject (e.g. Anatomy)"
                        value={newSubjectName}
                        onChange={(e) => setNewSubjectName(e.target.value)}
                      />
                      <input
                        aria-label="New subject color"
type="color"
                        className="w-10 h-9 shrink-0 rounded-md border border-border bg-surface cursor-pointer transition-colors focus:border-accent"
                        value={newSubjectColor}
                        onChange={(e) => setNewSubjectColor(e.target.value)}
                        title="Color"
                      />
                      <Button type="submit" variant="secondary" size="md" disabled={!newSubjectName.trim()}>
                        Add
                      </Button>
                    </form>

                    {courseSubjects.length === 0 ? (
                      <p className="text-xs text-text-secondary">No subjects yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {courseSubjects.map((s) => (
                          <div key={s.id} className="rounded-md border border-border">
                            {editingSubjectId === s.id ? (
                              <div className="flex items-center gap-2 p-2">
                                <Input
                                  className="flex-1"
                                  aria-label="Subject name"
                      value={subjectEditName}
                                  onChange={(e) => setSubjectEditName(e.target.value)}
                                />
                                <input
                                  aria-label="Subject color"
type="color"
                                  className="w-9 h-8 shrink-0 rounded-md border border-border bg-surface cursor-pointer transition-colors focus:border-accent"
                                  value={subjectEditColor}
                                  onChange={(e) => setSubjectEditColor(e.target.value)}
                                />
                                <Button variant="primary" size="sm" onClick={() => saveEditSubject(s)}>
                                  Save
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setEditingSubjectId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2 p-2">
                                <button
                                  onClick={() => toggleSchedulePanel(s.id)}
                                  className="flex items-center gap-2 text-left flex-1 min-w-0"
                                >
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: s.color ?? "#94a3b8" }}
                                  />
                                  <span className="text-sm truncate">{s.name}</span>
                                  <span className="text-xs text-accent-text shrink-0">
                                    {expandedSubjectId === s.id ? "Hide schedule" : "Weekly schedule"}
                                  </span>
                                  <ChevronIcon
                                    className={`w-3 h-3 text-text-secondary shrink-0 transition-transform duration-150 ${
                                      expandedSubjectId === s.id ? "rotate-180" : ""
                                    }`}
                                  />
                                </button>
                                <div className="flex gap-3 shrink-0 text-xs">
                                  <button
                                    onClick={() => startEditSubject(s)}
                                    className="text-accent-text hover:underline transition-colors"
                                  >
                                    Edit
                                  </button>
                                  {confirmDeleteSubjectId === s.id ? (
                                    <>
                                      <button
                                        onClick={() => handleDeleteSubject(s.id)}
                                        className="text-red-700 dark:text-red-400 hover:underline transition-colors"
                                      >
                                        Confirm
                                      </button>
                                      <button
                                        onClick={() => setConfirmDeleteSubjectId(null)}
                                        className="text-text-secondary hover:underline transition-colors"
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmDeleteSubjectId(s.id)}
                                      className="text-red-700 dark:text-red-400 hover:underline transition-colors"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {expandedSubjectId === s.id && (
                              <WeeklySchedulePanel
                                loading={scheduleLoading}
                                entries={scheduleBySubject[s.id] ?? []}
                                onSetDay={(day, start, end) => handleSetDay(s.id, day, start, end)}
                                onClearDay={(day) => handleClearDay(s.id, day)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}

function WeeklySchedulePanel({
  loading,
  entries,
  onSetDay,
  onClearDay,
}: {
  loading: boolean;
  entries: SubjectScheduleEntry[];
  onSetDay: (day: WeekdayName, start: string, end: string) => Promise<void>;
  onClearDay: (day: WeekdayName) => Promise<void>;
}) {
  const byDay = useMemo(() => {
    const map = new Map<WeekdayName, SubjectScheduleEntry>();
    for (const e of entries) map.set(e.dayOfWeek, e);
    return map;
  }, [entries]);

  return (
    <div className="border-t border-border p-2 bg-bg space-y-0.5">
      {loading ? (
        <LoadingState message="Loading schedule…" className="py-3" />
      ) : (
        WEEKDAY_ORDER.map((day) => (
          <DayRow key={day} day={day} entry={byDay.get(day)} onSetDay={onSetDay} onClearDay={onClearDay} />
        ))
      )}
    </div>
  );
}

/** One weekday's row, with its own fully local state — deliberately not
 * a shared "drafts" object keyed by day (the previous implementation):
 * that pattern read stale state through a helper function instead of the
 * updater's `prev`, which could silently lose an in-progress edit and is
 * almost certainly why Save appeared to do nothing. Each row being its
 * own component makes that whole class of bug impossible — there's
 * nothing to get out of sync with, since there's only ever one day's
 * state here. */
/** 24-hour "HH:MM" ⇄ 12-hour {hour, minute, period} conversions — the
 * backend and database only ever see 24-hour "HH:MM" (migration 0019);
 * this is purely a display concern. */
function parseTime24(value: string): { hour12: number; minute: number; period: "AM" | "PM" } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h24 = Number(match[1]);
  const minute = Number(match[2]);
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour12, minute, period };
}

function formatTime24(hour12: number, minute: number, period: "AM" | "PM"): string {
  let h24 = hour12 % 12;
  if (period === "PM") h24 += 12;
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const PICKER_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/** Three plain `<select>`s (hour / minute / AM-PM) instead of a native
 * `<input type="time">`. Deliberate: WebKit's native time input can
 * visually show a complete-looking value ("10:00 PM") while its actual
 * `.value` stays an empty string until every internal sub-field has been
 * explicitly committed by the user, not just typed — which is almost
 * certainly why the Save button stayed disabled even with what looked
 * like a filled-in time. Plain selects always resolve to a real value,
 * so there's no equivalent failure mode here. */
function TimePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const parsed = parseTime24(value) ?? { hour12: 8, minute: 0, period: "AM" as const };

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={`${label} hour`}
        className="border border-border rounded px-1 py-1 bg-surface"
        value={parsed.hour12}
        onChange={(e) => onChange(formatTime24(Number(e.target.value), parsed.minute, parsed.period))}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-text-secondary">:</span>
      <select
        aria-label={`${label} minute`}
        className="border border-border rounded px-1 py-1 bg-surface"
        value={parsed.minute}
        onChange={(e) => onChange(formatTime24(parsed.hour12, Number(e.target.value), parsed.period))}
      >
        {PICKER_MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select
        aria-label={`${label} AM or PM`}
        className="border border-border rounded px-1 py-1 bg-surface"
        value={parsed.period}
        onChange={(e) => onChange(formatTime24(parsed.hour12, parsed.minute, e.target.value as "AM" | "PM"))}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

function DayRow({
  day,
  entry,
  onSetDay,
  onClearDay,
}: {
  day: WeekdayName;
  entry: SubjectScheduleEntry | undefined;
  onSetDay: (day: WeekdayName, start: string, end: string) => Promise<void>;
  onClearDay: (day: WeekdayName) => Promise<void>;
}) {
  const [hasClass, setHasClass] = useState(!!entry);
  const [start, setStart] = useState(entry?.startTime ?? "08:00");
  const [hasEnd, setHasEnd] = useState(!!entry?.endTime);
  const [end, setEnd] = useState(entry?.endTime ?? "09:00");
  const [saving, setSaving] = useState(false);

  // Re-sync local state whenever the confirmed server-side entry for
  // this specific day changes (after this row's own save/clear
  // round-trips, or if the whole list reloads) — never fires for a
  // different day's save, since `entry` only changes identity when this
  // day's own data actually changed.
  useEffect(() => {
    setHasClass(!!entry);
    setStart(entry?.startTime ?? "08:00");
    setHasEnd(!!entry?.endTime);
    setEnd(entry?.endTime ?? "09:00");
  }, [entry]);

  async function handleToggle(checked: boolean) {
    setHasClass(checked);
    if (!checked) {
      setSaving(true);
      try {
        await onClearDay(day);
      } finally {
        setSaving(false);
      }
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSetDay(day, start, hasEnd ? end : "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs py-1 flex-wrap">
      <div className="flex items-center gap-1.5 w-28 shrink-0">
        <Toggle size="sm" checked={hasClass} onChange={handleToggle} disabled={saving} ariaLabel={WEEKDAY_LABELS[day]} />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => !saving && handleToggle(!hasClass)}
          disabled={saving}
          className="text-text-secondary text-left disabled:opacity-40"
        >
          {WEEKDAY_LABELS[day]}
        </button>
      </div>
      {hasClass ? (
        <>
          <TimePicker label={`${WEEKDAY_LABELS[day]} start`} value={start} onChange={setStart} />
          <div className="flex items-center gap-1 text-text-secondary">
            <Toggle size="sm" checked={hasEnd} onChange={setHasEnd} ariaLabel="Has an end time" />
            <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setHasEnd(!hasEnd)}>
              until
            </button>
          </div>
          {hasEnd && <TimePicker label={`${WEEKDAY_LABELS[day]} end`} value={end} onChange={setEnd} />}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-accent-text hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      ) : (
        <span className="text-text-secondary">Day off</span>
      )}
    </div>
  );
}
