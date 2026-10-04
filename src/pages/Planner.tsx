import { useEffect, useMemo, useState } from "react";
import { Card, EmptyState } from "@/components/Card";
import { Callout, ErrorBanner } from "@/components/ui/Callout";
import { Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { ToggleField } from "@/components/ui/Toggle";
import { toDateKey } from "@/lib/date";
import { listCourses } from "@/lib/ipc/courses";
import {
  createScheduleBlock,
  deleteScheduleBlock,
  generatePlan,
  listScheduleBlocks,
  reoptimizePlan,
  setScheduleBlockCompleted,
  updateScheduleBlock,
} from "@/lib/ipc/planner";
import { listTasks } from "@/lib/ipc/tasks";
import type { Course, NewScheduleBlock, PlanRequest, PlanResult, ScheduleBlock, Task, UserSettings } from "@/types";
import { CalendarIcon } from "@/components/ui/icons";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";
import { FormField } from "@/components/ui/FormField";

const EMPTY_MANUAL_FORM = {
  title: "",
  taskId: null as number | null,
  courseId: null as number | null,
  startTime: "09:00",
  endTime: "10:00",
  locked: false,
};

/** Extracts "HH:MM" from a plain local "YYYY-MM-DDTHH:MM:SS" string via
 * substring, never a `Date` object — matches how Calendar.tsx already
 * reads the date portion of these timestamps (see types/index.ts's
 * ScheduleBlock doc comment for why). */
function timeOnly(ts: string): string {
  return ts.slice(11, 16);
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

export function PlannerPage({ settings }: { settings: UserSettings }) {
  const [date, setDate] = useState(toDateKey(new Date()));
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<"generate" | "reoptimize" | null>(null);
  const [lastResult, setLastResult] = useState<PlanResult | null>(null);

  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [genForm, setGenForm] = useState({
    wakeTime: settings.plannerWakeTime,
    sleepTime: settings.plannerSleepTime,
    maxContinuousMinutes: settings.plannerMaxContinuousMinutes,
    breakMinutes: settings.plannerBreakMinutes,
    commitmentsText: "",
  });

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
  const [editingBlockId, setEditingBlockId] = useState<number | null>(null);

  async function refreshBlocks(forDate: string) {
    try {
      setBlocks(await listScheduleBlocks(forDate));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    refreshBlocks(date);
  }, [date]);

  useEffect(() => {
    // These feed the generate form's pickers. A failure used to be swallowed
    // (an empty list that looked like "you have no tasks/courses"); now it is
    // reported through the page's normal error banner.
    listTasks()
      .then(setTasks)
      .catch((e) => {
        setTasks([]);
        setError(`Couldn't load your tasks for the planner: ${String(e)}`);
      });
    listCourses()
      .then(setCourses)
      .catch((e) => {
        setCourses([]);
        setError(`Couldn't load your courses for the planner: ${String(e)}`);
      });
  }, []);

  const incompleteTasks = useMemo(
    () => tasks.filter((t) => t.status === "not_started" || t.status === "in_progress"),
    [tasks],
  );

  async function runGenerate() {
    setGenerating("generate");
    setError(null);
    setLastResult(null);
    try {
      const req: PlanRequest = {
        date,
        wakeTime: genForm.wakeTime,
        sleepTime: genForm.sleepTime,
        maxContinuousMinutes: genForm.maxContinuousMinutes,
        breakMinutes: genForm.breakMinutes,
        commitmentsText: genForm.commitmentsText,
      };
      const result = await generatePlan(req);
      setBlocks(result.blocks);
      setLastResult(result);
      setShowGenerateForm(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(null);
    }
  }

  async function runReoptimize() {
    setGenerating("reoptimize");
    setError(null);
    setLastResult(null);
    try {
      const result = await reoptimizePlan(date);
      setBlocks(result.blocks);
      setLastResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(null);
    }
  }

  function startEditBlock(block: ScheduleBlock) {
    setEditingBlockId(block.id);
    setManualForm({
      title: block.title,
      taskId: block.taskId,
      courseId: block.courseId,
      startTime: timeOnly(block.startTs),
      endTime: timeOnly(block.endTs),
      locked: block.locked,
    });
    setShowManualForm(true);
  }

  async function submitManualBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!manualForm.title.trim()) return;
    if (manualForm.startTime >= manualForm.endTime) {
      setError("Start time must be before end time.");
      return;
    }
    const payload: NewScheduleBlock = {
      title: manualForm.title.trim(),
      taskId: manualForm.taskId,
      courseId: manualForm.courseId,
      startTs: `${date}T${manualForm.startTime}:00`,
      endTs: `${date}T${manualForm.endTime}:00`,
      locked: manualForm.locked,
    };
    try {
      if (editingBlockId !== null) {
        await updateScheduleBlock(editingBlockId, payload);
      } else {
        await createScheduleBlock(payload);
      }
      setManualForm(EMPTY_MANUAL_FORM);
      setEditingBlockId(null);
      setShowManualForm(false);
      await refreshBlocks(date);
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleCompleted(block: ScheduleBlock) {
    try {
      await setScheduleBlockCompleted(block.id, !block.completed);
      await refreshBlocks(date);
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleLocked(block: ScheduleBlock) {
    try {
      await updateScheduleBlock(block.id, {
        title: block.title,
        taskId: block.taskId,
        courseId: block.courseId,
        startTs: block.startTs,
        endTs: block.endTs,
        locked: !block.locked,
      });
      await refreshBlocks(date);
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeBlock(id: number) {
    try {
      await deleteScheduleBlock(id);
      await refreshBlocks(date);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <PageContainer size="default">
      <PageHeader
        title="Planner"
        actions={
          <Input
            type="date"
            aria-label="Date to plan"
            className="w-auto"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        }
      />

      {error && <ErrorBanner message={error} onReload={() => refreshBlocks(date)} onDismiss={() => setError(null)} />}

      {lastResult?.capacityWarning && (
        <Callout tone="warning" title="This plan doesn't fit in the time available">
          {lastResult.capacityWarning}
        </Callout>
      )}
      {lastResult && !lastResult.capacityWarning && (
        <p className="text-xs text-text-secondary">
          Generated via {lastResult.provider} · {lastResult.model}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="md" onClick={() => setShowGenerateForm((v) => !v)}>
          {showGenerateForm ? "Hide generate form" : "Generate my day"}
        </Button>
        <Button variant="secondary" size="md" disabled={generating !== null} onClick={runReoptimize}>
          {generating === "reoptimize" ? "Re-optimizing…" : "Re-optimize remaining"}
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            setEditingBlockId(null);
            setManualForm(EMPTY_MANUAL_FORM);
            setShowManualForm((v) => !v);
          }}
        >
          {showManualForm ? "Cancel" : "Add block manually"}
        </Button>
      </div>

      {showGenerateForm && (
        <Card>
          <h2 className="font-medium mb-3">Generate my day</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="text-sm text-text-secondary">
              Wake time
              <Input
                type="time"
                size="sm"
                className="mt-1 w-full"
                value={genForm.wakeTime}
                onChange={(e) => setGenForm({ ...genForm, wakeTime: e.target.value })}
              />
            </label>
            <label className="text-sm text-text-secondary">
              Sleep time
              <Input
                type="time"
                size="sm"
                className="mt-1 w-full"
                value={genForm.sleepTime}
                onChange={(e) => setGenForm({ ...genForm, sleepTime: e.target.value })}
              />
            </label>
            <label className="text-sm text-text-secondary">
              Max continuous study (min)
              <Input
                type="number"
                size="sm"
                min={1}
                className="mt-1 w-full"
                value={genForm.maxContinuousMinutes}
                onChange={(e) => setGenForm({ ...genForm, maxContinuousMinutes: Number(e.target.value) || 1 })}
              />
            </label>
            <label className="text-sm text-text-secondary">
              Break length (min)
              <Input
                type="number"
                size="sm"
                min={0}
                className="mt-1 w-full"
                value={genForm.breakMinutes}
                onChange={(e) => setGenForm({ ...genForm, breakMinutes: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <label className="text-sm text-text-secondary block mb-3">
            Other commitments today (optional)
            <textarea
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm transition-colors focus:border-accent"
              rows={2}
              placeholder="e.g. Class 9-11am, gym 5-6pm"
              value={genForm.commitmentsText}
              onChange={(e) => setGenForm({ ...genForm, commitmentsText: e.target.value })}
            />
          </label>
          <p className="text-xs text-text-secondary mb-3">
            Uses your {incompleteTasks.length} pending task{incompleteTasks.length === 1 ? "" : "s"} and any
            upcoming exams. Blocks you've locked below are always kept — the AI plans around them.
          </p>
          <Button variant="primary" size="md" disabled={generating !== null} onClick={runGenerate}>
            {generating === "generate" ? "Generating…" : "Generate"}
          </Button>
        </Card>
      )}

      {showManualForm && (
        <Card>
          <h2 className="font-medium mb-3">{editingBlockId !== null ? "Edit block" : "Add block"}</h2>
          <form onSubmit={submitManualBlock} className="space-y-3">
            <Input
              className="w-full"
              aria-label="Block title"
              placeholder="Title *"
              value={manualForm.title}
              onChange={(e) => setManualForm({ ...manualForm, title: e.target.value })}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Starts">
                <Input
                  type="time"
                  value={manualForm.startTime}
                  onChange={(e) => setManualForm({ ...manualForm, startTime: e.target.value })}
                  required
                />
              </FormField>
              <FormField label="Ends">
                <Input
                  type="time"
                  value={manualForm.endTime}
                  onChange={(e) => setManualForm({ ...manualForm, endTime: e.target.value })}
                  required
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Linked task">
                <Select
                value={manualForm.taskId ?? ""}
                onChange={(e) => setManualForm({ ...manualForm, taskId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">No linked task</option>
                {incompleteTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
              </FormField>
              <FormField label="Course">
                <Select
                value={manualForm.courseId ?? ""}
                onChange={(e) => setManualForm({ ...manualForm, courseId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">No course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              </FormField>
            </div>
            <ToggleField
              size="sm"
              checked={manualForm.locked}
              onChange={(v) => setManualForm({ ...manualForm, locked: v })}
              label="Lock"
              description="Never touched by Generate/Re-optimize"
            />
            <Button type="submit" variant="primary" size="md">
              {editingBlockId !== null ? "Save changes" : "Add"}
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="font-medium mb-3">
          {date === toDateKey(new Date()) ? "Today" : date}
        </h2>
        {loading ? (
          <div className="space-y-2">
            <SkeletonBar className="h-12 w-full" />
            <SkeletonBar className="h-12 w-full" />
            <SkeletonBar className="h-12 w-full" />
          </div>
        ) : blocks.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="w-5 h-5" />}
            title="Nothing scheduled for this day"
            description="Let the planner fit your tasks into your day, or add a block by hand."
            action={
              <Button variant="primary" size="md" onClick={() => setShowGenerateForm(true)}>
                Generate a plan
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {blocks.map((block) => (
              <div
                key={block.id}
                className={`rounded-md border border-border p-3 transition-all duration-150 hover:shadow-sm ${block.completed ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-text-secondary shrink-0">
                        {formatTime12h(timeOnly(block.startTs))} – {formatTime12h(timeOnly(block.endTs))}
                      </span>
                      <span className={`font-medium ${block.completed ? "line-through" : ""}`}>{block.title}</span>
                      {block.source === "ai" && (
                        <span className="text-[10px] uppercase tracking-wide text-accent-text bg-accent-soft rounded px-1.5 py-0.5">
                          AI
                        </span>
                      )}
                      {block.locked && (
                        <span className="text-[10px] uppercase tracking-wide text-text-secondary bg-bg border border-border rounded px-1.5 py-0.5">
                          Locked
                        </span>
                      )}
                    </div>
                    {block.courseName && (
                      <p className="text-xs text-text-secondary mt-0.5">{block.courseName}</p>
                    )}
                    {block.aiReason && (
                      <p className="text-xs text-text-secondary mt-1 italic">{block.aiReason}</p>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={block.completed}
                    onChange={() => toggleCompleted(block)}
                    aria-label={`Mark "${block.title}" complete`}
                    title="Mark complete"
                  />
                </div>
                <div className="flex gap-3 mt-2 text-xs">
                  <button className="text-accent-text hover:underline transition-colors" onClick={() => startEditBlock(block)}>
                    Edit
                  </button>
                  <button className="text-text-secondary hover:underline transition-colors" onClick={() => toggleLocked(block)}>
                    {block.locked ? "Unlock" : "Lock"}
                  </button>
                  <button className="text-red-700 dark:text-red-400 hover:underline transition-colors" onClick={() => removeBlock(block.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
