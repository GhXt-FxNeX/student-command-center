import { useEffect, useState } from "react";
import { Card, EmptyState } from "@/components/Card";
import { ShowMore, useIncrementalList } from "@/components/ui/ShowMore";
import { ErrorBanner } from "@/components/ui/Callout";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { ToggleField } from "@/components/ui/Toggle";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { formatDateOnly, relativeDayLabel } from "@/lib/date";
import {
  createTask,
  deleteTask,
  duplicateTask,
  listTasks,
  setTaskStatus,
  updateTask,
} from "@/lib/ipc/tasks";
import type { NewTask, Task, TaskPriority, TaskStatus } from "@/types";
import { ListCheckIcon } from "@/components/ui/icons";
import { focusField } from "@/lib/focusField";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";
import { FormField } from "@/components/ui/FormField";

const EMPTY_FORM: NewTask = {
  title: "",
  description: "",
  priority: "medium",
  difficulty: "medium",
  estimatedMinutes: null,
  deadline: null,
  scheduledStart: null,
  scheduledEnd: null,
  tags: [],
  notes: "",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
};

// Dot color only — a quick-scan status indicator alongside the existing
// text label and the status dropdown, not a replacement for either.
const STATUS_DOT: Record<TaskStatus, string> = {
  not_started: "bg-text-secondary",
  in_progress: "bg-accent",
  completed: "bg-emerald-500",
  skipped: "bg-text-secondary",
};

// Priority badge coloring — purely visual (the doc's "Priority indicators"
// ask); `task.priority` itself is untouched.
const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: "bg-bg text-text-secondary border border-border",
  medium: "bg-accent-soft text-accent-text",
  high: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low priority" },
  { value: "medium", label: "Medium priority" },
  { value: "high", label: "High priority" },
];

// Reuses STATUS_LABEL/STATUS_DOT above so the dropdown's dots always match
// the status dots already shown on each task card.
const STATUS_OPTIONS: { value: TaskStatus; label: string; dotClassName: string }[] = (
  Object.entries(STATUS_LABEL) as [TaskStatus, string][]
).map(([value, label]) => ({ value, label, dotClassName: STATUS_DOT[value] }));

const FILTER_OPTIONS: { value: TaskStatus | "all"; label: string; dotClassName?: string }[] = [
  { value: "all", label: "All statuses" },
  ...STATUS_OPTIONS,
];

/** Same small helper already used locally in Planner.tsx/Dashboard.tsx —
 * kept local here too rather than shared, it's a two-line pure function. */
function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewTask>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [query, setQuery] = useState("");

  // Fixed-time is entered as three separate inputs (date/start/end) and
  // combined into NewTask.scheduledStart/scheduledEnd only at submit time
  // — those are single "YYYY-MM-DDTHH:MM:SS" strings (matching schedule_
  // blocks' convention), which isn't a natural shape to edit directly in
  // three <input> elements.
  const [fixedTimeEnabled, setFixedTimeEnabled] = useState(false);
  const [fixedDate, setFixedDate] = useState("");
  const [fixedStart, setFixedStart] = useState("09:00");
  const [fixedEnd, setFixedEnd] = useState("10:00");

  async function refresh() {
    try {
      setTasks(await listTasks());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setFixedTimeEnabled(false);
    setFixedDate("");
    setFixedStart("09:00");
    setFixedEnd("10:00");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (fixedTimeEnabled) {
      if (!fixedDate) {
        setError("Pick a date for the fixed time.");
        return;
      }
      if (fixedStart >= fixedEnd) {
        setError("Fixed start time must be before the end time.");
        return;
      }
    }
    const payload: NewTask = {
      ...form,
      scheduledStart: fixedTimeEnabled ? `${fixedDate}T${fixedStart}:00` : null,
      scheduledEnd: fixedTimeEnabled ? `${fixedDate}T${fixedEnd}:00` : null,
    };
    try {
      if (editingId !== null) {
        await updateTask(editingId, payload);
      } else {
        await createTask(payload);
      }
      resetForm();
      setEditingId(null);
      setError(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description ?? "",
      courseId: task.courseId,
      priority: task.priority,
      difficulty: task.difficulty,
      estimatedMinutes: task.estimatedMinutes,
      deadline: task.deadline,
      tags: task.tags,
      notes: task.notes ?? "",
    });
    if (task.scheduledStart && task.scheduledEnd) {
      setFixedTimeEnabled(true);
      setFixedDate(task.scheduledStart.slice(0, 10));
      setFixedStart(task.scheduledStart.slice(11, 16));
      setFixedEnd(task.scheduledEnd.slice(11, 16));
    } else {
      setFixedTimeEnabled(false);
      setFixedDate("");
      setFixedStart("09:00");
      setFixedEnd("10:00");
    }
  }

  const visible = tasks
    .filter((t) => filter === "all" || t.status === filter)
    .filter((t) => t.title.toLowerCase().includes(query.toLowerCase()));
  // Only the first page is rendered; filter/search above still cover every task.
  const page = useIncrementalList(visible, `${filter}|${query}`);

  return (
    <PageContainer size="default">
      <PageHeader title="Tasks" />

      {error && <ErrorBanner message={error} onReload={refresh} onDismiss={() => setError(null)} />}

      <Card>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Title">
              <Input
                id="task-title-input"
                placeholder="Task title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Deadline (optional)">
              <Input
                type="date"
                value={form.deadline ? form.deadline.substring(0, 10) : ""}
                onChange={(e) =>
                  // A task deadline is a calendar date, not a timestamp — store the
                  // native date input's "YYYY-MM-DD" value as-is. No synthetic time
                  // component, no Date object, nothing that can shift by timezone.
                  setForm({ ...form, deadline: e.target.value || null })
                }
              />
            </FormField>
            <FormField label="Priority">
              <SelectMenu
                className="w-full"
                options={PRIORITY_OPTIONS}
                value={form.priority}
                onChange={(v) => setForm({ ...form, priority: v })}
              />
            </FormField>
            <FormField label="Estimated minutes (optional)">
              <Input
                type="number"
                min={0}
                placeholder="e.g. 45"
                value={form.estimatedMinutes ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    estimatedMinutes: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </FormField>
          </div>

          <div className="rounded-md border border-border bg-bg p-3 space-y-2">
            <ToggleField
              size="sm"
              checked={fixedTimeEnabled}
              onChange={setFixedTimeEnabled}
              label="Fixed time"
            />
            {fixedTimeEnabled && (
              <div className="grid grid-cols-3 gap-2">
                <FormField label="Date">
                  <Input
                    type="date"
                    tone="surface"
                    value={fixedDate}
                    onChange={(e) => setFixedDate(e.target.value)}
                    required={fixedTimeEnabled}
                  />
                </FormField>
                <FormField label="Starts">
                  <Input
                    type="time"
                    tone="surface"
                    value={fixedStart}
                    onChange={(e) => setFixedStart(e.target.value)}
                    required={fixedTimeEnabled}
                  />
                </FormField>
                <FormField label="Ends">
                  <Input
                    type="time"
                    tone="surface"
                    value={fixedEnd}
                    onChange={(e) => setFixedEnd(e.target.value)}
                    required={fixedTimeEnabled}
                  />
                </FormField>
              </div>
            )}
            <p className="text-xs text-text-secondary">
              The AI Planner will never move, resize, or reschedule a fixed-time task — it plans
              everything else around it.
            </p>
          </div>

          <textarea
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm transition-colors focus:border-accent"
            placeholder="Description (optional)"
            aria-label="Description (optional)"
            rows={2}
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="md">
              {editingId !== null ? "Save changes" : "Add task"}
            </Button>
            {editingId !== null && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setEditingId(null);
                  resetForm();
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          tone="surface"
          size="sm"
          className="flex-1 min-w-[160px]"
          placeholder="Search tasks…"
            aria-label="Search tasks"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SelectMenu
          size="sm"
          tone="surface"
          className="w-40"
          ariaLabel="Filter tasks by status"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          <SkeletonBar className="h-16 w-full" />
          <SkeletonBar className="h-16 w-full" />
          <SkeletonBar className="h-16 w-full" />
        </div>
      ) : visible.length === 0 ? (
        // A failed load also leaves `tasks` empty; the error banner above says
        // so, and "No tasks yet" under it would contradict it.
        error && tasks.length === 0 ? null : (
          <Card>
            {tasks.length === 0 ? (
              <EmptyState
                icon={<ListCheckIcon className="w-5 h-5" />}
                title="No tasks yet"
                description="Tasks are what the planner schedules and what your Dashboard counts. Add one to get started."
                action={
                  <Button variant="primary" size="md" onClick={() => focusField("task-title-input")}>
                    Add a task
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ListCheckIcon className="w-5 h-5" />}
                title="No tasks match"
                description="Nothing fits the current filter or search. Try a different one."
              />
            )}
          </Card>
        )
      ) : (
        <div className="space-y-2">
          {page.shown.map((task) => (
            <Card
              key={task.id}
              className="flex items-start justify-between gap-3 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`font-medium ${task.status === "completed" ? "line-through text-text-secondary" : ""}`}>
                    {task.title}
                  </p>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${PRIORITY_BADGE[task.priority]}`}>
                    {task.priority}
                  </span>
                </div>
                {task.description && (
                  <p className="text-text-secondary text-sm mt-0.5">{task.description}</p>
                )}
                <div className="text-xs text-text-secondary mt-1 flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[task.status]}`} />
                    {STATUS_LABEL[task.status]}
                  </span>
                  {task.scheduledStart && task.scheduledEnd && (
                    <span className="text-accent-text font-medium">
                      🔒 Fixed: {relativeDayLabel(task.scheduledStart)}{" "}
                      {formatTime12h(task.scheduledStart.slice(11, 16))}–
                      {formatTime12h(task.scheduledEnd.slice(11, 16))}
                    </span>
                  )}
                  {task.deadline && <span>Due {relativeDayLabel(task.deadline)} ({formatDateOnly(task.deadline)})</span>}
                  {task.estimatedMinutes && <span>{task.estimatedMinutes} min</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end shrink-0">
                <SelectMenu
                  size="sm"
                  className="w-36"
                  ariaLabel={`Status of ${task.title}`}
                  options={STATUS_OPTIONS}
                  value={task.status}
                  onChange={async (v) => {
                    await setTaskStatus(task.id, v);
                    refresh();
                  }}
                />
                <div className="flex gap-2 text-xs">
                  <button className="text-accent-text hover:underline transition-colors" onClick={() => startEdit(task)}>
                    Edit
                  </button>
                  <button
                    className="text-accent-text hover:underline transition-colors"
                    onClick={async () => {
                      await duplicateTask(task.id);
                      refresh();
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    className="text-red-700 dark:text-red-400 hover:underline transition-colors"
                    onClick={async () => {
                      await deleteTask(task.id);
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          ))}
          <ShowMore shown={page.shown.length} total={page.total} remaining={page.remaining} pageSize={page.pageSize} onShowMore={page.showMore} noun="tasks" />
        </div>
      )}
    </PageContainer>
  );
}
