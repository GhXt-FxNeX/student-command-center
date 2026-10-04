import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ui/Callout";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { formatMonthKey } from "@/lib/currency";
import { getCalendarRange } from "@/lib/ipc/calendar";
import { toDateKey } from "@/lib/date";
import type { CalendarItem, UserSettings, WeekStart } from "@/types";
import { ChevronIcon } from "@/components/ui/icons";
import { PageContainer, PageHeader } from "@/components/ui/PageHeader";
import { IconButton } from "@/components/ui/IconButton";

type ViewMode = "day" | "week" | "month" | "year";

// index = Date.getDay() (0 = Sunday) throughout this file.
const WEEKDAY_ORDER: WeekStart[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Vertical scale for the day/week time grid — 1.2px/minute gives a 2-line
// block (title + time) room to breathe on anything 30min+, while a full day
// (24 * 72 = 1728px) stays a reasonable scroll length.
const HOUR_PX = 72;
const PX_PER_MIN = HOUR_PX / 60;
const MIN_BLOCK_PX = 20;

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

// ---- Icons (local, stroke-based — same style/rotation idiom established
// in Finances.tsx and Exams.tsx's ChevronIcon) ----

// ---- Date helpers ----

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function startOfWeek(d: Date, weekStart: WeekStart): Date {
  const startIndex = WEEKDAY_ORDER.indexOf(weekStart);
  const dayIndex = d.getDay();
  const diff = (dayIndex - startIndex + 7) % 7;
  return addDays(d, -diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Always 42 days (6 full rows) regardless of the month — every month view
 * (standalone or one of the 12 mini-months in year view) is the same
 * height, so navigating months/scanning a year doesn't jump around. */
function monthGridDays(monthAnchor: Date, weekStart: WeekStart): Date[] {
  const gridStart = startOfWeek(startOfMonth(monthAnchor), weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// ---- Time helpers ----
// CalendarItem.start/end are plain "YYYY-MM-DDTHH:MM:SS" local strings for
// timed items (study_session/schedule_block/class) — per types/index.ts's
// own ScheduleBlock note, read them via substring, never `new Date(...)`.
// task/exam are date-only ("YYYY-MM-DD", no time) at the source
// (commands/calendar.rs pulls them straight from `deadline`/`date` columns)
// — they're always all-day, never placed on the timed grid.

function isAllDay(item: CalendarItem): boolean {
  return item.itemType === "task" || item.itemType === "exam";
}

function minutesOfDay(ts: string): number {
  return Number(ts.slice(11, 13)) * 60 + Number(ts.slice(14, 16));
}

function formatHourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

function formatClockShort(hh: number, mm: number): string {
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const period = hh < 12 ? "am" : "pm";
  return mm === 0 ? `${h12}${period}` : `${h12}:${String(mm).padStart(2, "0")}${period}`;
}

function itemStartLabel(item: CalendarItem): string {
  return formatClockShort(Number(item.start.slice(11, 13)), Number(item.start.slice(14, 16)));
}

function itemTimeRangeLabel(item: CalendarItem): string {
  const start = itemStartLabel(item);
  if (!item.end) return start;
  return `${start} – ${formatClockShort(Number(item.end.slice(11, 13)), Number(item.end.slice(14, 16)))}`;
}

function splitDayItems(items: CalendarItem[]): { allDay: CalendarItem[]; timed: CalendarItem[] } {
  const allDay: CalendarItem[] = [];
  const timed: CalendarItem[] = [];
  for (const item of items) (isAllDay(item) ? allDay : timed).push(item);
  return { allDay, timed };
}

// ---- Timed-item side-by-side layout ----
// Groups a day's timed items into overlap clusters (transitive — A/B/C all
// touch even if A and C don't directly), then greedily packs each cluster
// into the fewest columns so concurrent events sit side by side instead of
// stacking on top of each other.

interface LaidOutItem extends CalendarItem {
  startMin: number;
  endMin: number;
  col: number;
  totalCols: number;
}

function layoutTimedItems(items: CalendarItem[]): LaidOutItem[] {
  type Timed = CalendarItem & { startMin: number; endMin: number };
  const withTimes: Timed[] = items
    .map((item) => {
      const startMin = minutesOfDay(item.start);
      // No stored end (shouldn't happen for these item types, but stay
      // safe): give it a nominal 30min so it's still visible/clickable.
      const endMin = item.end ? Math.max(minutesOfDay(item.end), startMin + 10) : startMin + 30;
      return { ...item, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const result: LaidOutItem[] = [];
  let cluster: Timed[] = [];
  let clusterEnd = -Infinity;

  function flushCluster() {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const colOf = new Map<Timed, number>();
    for (const it of cluster) {
      let placed = false;
      for (let c = 0; c < columnEnds.length; c++) {
        if (columnEnds[c] <= it.startMin) {
          columnEnds[c] = it.endMin;
          colOf.set(it, c);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columnEnds.push(it.endMin);
        colOf.set(it, columnEnds.length - 1);
      }
    }
    const totalCols = columnEnds.length;
    for (const it of cluster) result.push({ ...it, col: colOf.get(it) ?? 0, totalCols });
    cluster = [];
  }

  for (const it of withTimes) {
    if (cluster.length === 0 || it.startMin < clusterEnd) {
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.endMin);
    } else {
      flushCluster();
      cluster = [it];
      clusterEnd = it.endMin;
    }
  }
  flushCluster();

  return result;
}

// ---- Item-type styling ----
// A pre-vetted, theme-consistent soft-background/text pairing per source —
// the same "bg-X-50 text-X-600" family Finance/Exams' badges already use —
// rather than the item's arbitrary course color, which risks illegible
// text on a large filled block for some colors.

const ALL_DAY_STYLE: Record<"task" | "exam", string> = {
  task: "bg-accent-soft text-accent-text",
  exam: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const TIMED_STYLE: Record<"study_session" | "schedule_block" | "class", { block: string; dot: string }> = {
  study_session: { block: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20", dot: "bg-sky-500" },
  schedule_block: { block: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20", dot: "bg-emerald-500" },
  class: { block: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20", dot: "bg-indigo-500" },
};

const MUTED_BLOCK = "bg-bg text-text-secondary line-through border border-border";
const MUTED_DOT = "bg-border";

function timedStyleFor(item: CalendarItem) {
  if (item.itemType === "schedule_block" && item.completed) return { block: MUTED_BLOCK, dot: MUTED_DOT };
  if (item.itemType === "study_session" || item.itemType === "schedule_block" || item.itemType === "class") {
    return TIMED_STYLE[item.itemType];
  }
  return { block: MUTED_BLOCK, dot: MUTED_DOT };
}

// ---- Year view's 12 mini-months ----

function MiniMonth({
  year,
  month,
  weekStart,
  orderedDow,
  todayKey,
  onSelectDay,
}: {
  year: number;
  month: number;
  weekStart: WeekStart;
  orderedDow: number[];
  todayKey: string;
  onSelectDay: (d: Date) => void;
}) {
  const monthAnchor = new Date(year, month, 1);
  const days = monthGridDays(monthAnchor, weekStart);
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">{monthAnchor.toLocaleDateString(undefined, { month: "long" })}</h3>
      <div className="grid grid-cols-7 gap-y-1">
        {orderedDow.map((dow, i) => (
          <span key={i} className="text-[10px] text-text-secondary font-medium text-center">
            {WEEKDAY_LETTER[dow]}
          </span>
        ))}
        {days.map((d) => {
          const key = toDateKey(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDay(d)}
              aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              aria-current={isToday ? "date" : undefined}
              className={`text-[11px] h-6 w-6 mx-auto rounded-full flex items-center justify-center transition-colors ${
                isToday
                  ? "bg-accent-fill text-white font-medium"
                  : inMonth
                    ? "text-text hover:bg-bg"
                    : "text-text-secondary opacity-40 hover:bg-bg"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarPage({ settings }: { settings: UserSettings }) {
  const [view, setView] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(new Date());
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [now, setNow] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keeps the "now" line live without re-fetching calendar data.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const orderedDow = useMemo(() => {
    const startIdx = WEEKDAY_ORDER.indexOf(settings.weekStart);
    return Array.from({ length: 7 }, (_, i) => (startIdx + i) % 7);
  }, [settings.weekStart]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === "day") return { rangeStart: anchor, rangeEnd: anchor };
    if (view === "week") {
      const start = startOfWeek(anchor, settings.weekStart);
      return { rangeStart: start, rangeEnd: addDays(start, 6) };
    }
    if (view === "month") {
      const gridStart = startOfWeek(startOfMonth(anchor), settings.weekStart);
      return { rangeStart: gridStart, rangeEnd: addDays(gridStart, 41) };
    }
    return { rangeStart: new Date(anchor.getFullYear(), 0, 1), rangeEnd: new Date(anchor.getFullYear(), 11, 31) };
  }, [view, anchor, settings.weekStart]);

  useEffect(() => {
    // Year view never shows events (matches a plain date-picker overview) —
    // skip the fetch entirely rather than pulling a year of data unused.
    if (view === "year") return;
    setItems(null);
    setError(null);
    getCalendarRange(toDateKey(rangeStart), toDateKey(rangeEnd))
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, [view, rangeStart, rangeEnd, reloadTick]);

  // Scrolls the time grid to ~6am whenever day/week view is (re)entered,
  // rather than opening on midnight.
  useEffect(() => {
    if ((view === "day" || view === "week") && scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, 6 * HOUR_PX - 40);
    }
  }, [view]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items ?? []) {
      const key = item.start.substring(0, 10);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  function step(delta: number) {
    if (view === "day") setAnchor((a) => addDays(a, delta));
    else if (view === "week") setAnchor((a) => addDays(a, delta * 7));
    else if (view === "month") setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
    else setAnchor((a) => new Date(a.getFullYear() + delta, a.getMonth(), 1));
  }

  const todayKey = toDateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const days = useMemo(() => {
    if (view === "month" || view === "year") return [];
    const list: Date[] = [];
    let cursor = new Date(rangeStart);
    while (cursor <= rangeEnd) {
      list.push(new Date(cursor));
      cursor = addDays(cursor, 1);
    }
    return list;
  }, [view, rangeStart, rangeEnd]);

  const monthDays = useMemo(
    () => (view === "month" ? monthGridDays(anchor, settings.weekStart) : []),
    [view, anchor, settings.weekStart],
  );

  const title = useMemo(() => {
    if (view === "day") {
      return anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    if (view === "week") {
      const start = startOfWeek(anchor, settings.weekStart);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const endLabel = end.toLocaleDateString(
        undefined,
        sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
      );
      return `${startLabel} – ${endLabel}`;
    }
    if (view === "month") {
      return formatMonthKey(`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`);
    }
    return String(anchor.getFullYear());
  }, [view, anchor, settings.weekStart]);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Calendar"
        actions={
          <>
          <SegmentedControl ariaLabel="Calendar view" options={VIEW_OPTIONS} value={view} onChange={setView} />
          <div className="flex items-center gap-1.5">
            <IconButton label={`Previous ${view}`} onClick={() => step(-1)}>
              <ChevronIcon className="w-3.5 h-3.5 rotate-90" />
            </IconButton>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
            <IconButton label={`Next ${view}`} onClick={() => step(1)}>
              <ChevronIcon className="w-3.5 h-3.5 -rotate-90" />
            </IconButton>
          </div>
          </>
        }
      />

      <h2 className="text-lg font-medium">{title}</h2>

      {error && (
        <ErrorBanner
          message={error}
          title="Couldn't load the calendar"
          onReload={() => setReloadTick((t) => t + 1)}
          onDismiss={() => setError(null)}
        />
      )}

      {view === "year" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
          {Array.from({ length: 12 }, (_, month) => (
            <MiniMonth
              key={month}
              year={anchor.getFullYear()}
              month={month}
              weekStart={settings.weekStart}
              orderedDow={orderedDow}
              todayKey={todayKey}
              onSelectDay={(d) => {
                setAnchor(d);
                setView("day");
              }}
            />
          ))}
        </div>
      ) : view === "month" ? (
        items === null ? error ? null : (
          <Card>
            <SkeletonBar className="h-[520px] w-full" />
          </Card>
        ) : (
          <div className="border border-border rounded-card overflow-hidden">
            <div className="grid grid-cols-7 bg-surface">
              {orderedDow.map((dow, i) => (
                <div
                  key={i}
                  className="text-center text-[11px] font-medium text-text-secondary uppercase tracking-wide py-2 border-b border-border"
                >
                  {WEEKDAY_ABBR[dow]}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const key = toDateKey(day);
                const dayItems = itemsByDay.get(key) ?? [];
                const { allDay, timed } = splitDayItems(dayItems);
                const inMonth = day.getMonth() === anchor.getMonth();
                const isToday = key === todayKey;
                const visibleTimed = timed.slice(0, Math.max(0, 4 - allDay.length));
                const hiddenCount = dayItems.length - allDay.length - visibleTimed.length;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setAnchor(day);
                      setView("day");
                    }}
                    className={`block w-full text-left min-h-[104px] p-1.5 border-b border-r border-border transition-colors hover:bg-bg ${
                      inMonth ? "" : "opacity-40"
                    }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                        isToday ? "bg-accent-fill text-white font-medium" : "text-text-secondary"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {allDay.map((item) => (
                        <p
                          key={item.id}
                          className={`text-[10px] truncate rounded px-1 py-0.5 ${ALL_DAY_STYLE[item.itemType as "task" | "exam"]} ${
                            item.itemType === "task" && item.completed ? "line-through opacity-60" : ""
                          }`}
                        >
                          {item.title}
                        </p>
                      ))}
                      {visibleTimed.map((item) => (
                        <p key={item.id} className="text-[10px] truncate flex items-center gap-1 text-text-secondary">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${timedStyleFor(item).dot}`} />
                          <span className="truncate">
                            {itemStartLabel(item)} {item.title}
                          </span>
                        </p>
                      ))}
                      {hiddenCount > 0 && <p className="text-[10px] text-text-secondary">+{hiddenCount} more</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )
      ) : items === null ? error ? null : (
        <Card>
          <SkeletonBar className="h-[500px] w-full" />
        </Card>
      ) : (
        <div className="border border-border rounded-card overflow-hidden">
          {/* Fixed header: day name + date, then the all-day strip — neither scrolls with the hour grid. */}
          <div className="flex border-b border-border">
            <div className="w-14 shrink-0" />
            {days.map((d) => {
              const key = toDateKey(d);
              const isToday = key === todayKey;
              return (
                <div key={key} className="flex-1 text-center py-2 border-l border-border first:border-l-0">
                  <p className="text-[11px] tracking-wide text-text-secondary uppercase">{WEEKDAY_ABBR[d.getDay()]}</p>
                  <p
                    className={`text-sm mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full ${
                      isToday ? "bg-accent-fill text-white font-medium" : "text-text font-medium"
                    }`}
                  >
                    {d.getDate()}
                  </p>
                </div>
              );
            })}
          </div>
          {days.some((d) => splitDayItems(itemsByDay.get(toDateKey(d)) ?? []).allDay.length > 0) && (
            <div className="flex border-b border-border">
              <div className="w-14 shrink-0" />
              {days.map((d) => {
                const key = toDateKey(d);
                const { allDay } = splitDayItems(itemsByDay.get(key) ?? []);
                return (
                  <div key={key} className="flex-1 px-1 py-1 border-l border-border first:border-l-0 space-y-0.5">
                    {allDay.map((item) => (
                      <p
                        key={item.id}
                        className={`text-[10px] truncate rounded px-1.5 py-0.5 ${ALL_DAY_STYLE[item.itemType as "task" | "exam"]} ${
                          item.itemType === "task" && item.completed ? "line-through opacity-60" : ""
                        }`}
                      >
                        {item.title}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Scrollable time grid — gutter and day columns scroll together as one flex row. */}
          <div ref={scrollRef} className="flex overflow-y-auto" style={{ maxHeight: 620 }}>
            <div className="w-14 shrink-0 relative" style={{ height: 24 * HOUR_PX }}>
              {HOURS.slice(1).map((h) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[11px] text-text-secondary"
                  style={{ top: h * HOUR_PX }}
                >
                  {formatHourLabel(h)}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const key = toDateKey(d);
              const { timed } = splitDayItems(itemsByDay.get(key) ?? []);
              const laidOut = layoutTimedItems(timed);
              const isToday = key === todayKey;
              return (
                <div key={key} className="flex-1 relative border-l border-border first:border-l-0" style={{ height: 24 * HOUR_PX }}>
                  {HOURS.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-border" style={{ top: h * HOUR_PX }} />
                  ))}
                  {laidOut.map((item) => {
                    const style = timedStyleFor(item);
                    return (
                      <div
                        key={item.id}
                        className="absolute"
                        style={{
                          top: item.startMin * PX_PER_MIN,
                          height: Math.max((item.endMin - item.startMin) * PX_PER_MIN, MIN_BLOCK_PX),
                          left: `${(item.col / item.totalCols) * 100}%`,
                          width: `${(1 / item.totalCols) * 100}%`,
                        }}
                      >
                        <div className={`h-full mx-0.5 rounded-md px-1.5 py-0.5 overflow-hidden text-[11px] leading-tight ${style.block}`}>
                          <p className="font-medium truncate">{item.title}</p>
                          <p className="truncate opacity-80">{itemTimeRangeLabel(item)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {isToday && (
                    <div className="absolute inset-x-0 flex items-center z-10 pointer-events-none" style={{ top: nowMinutes * PX_PER_MIN }}>
                      <span className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                      <span className="flex-1 h-px bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
