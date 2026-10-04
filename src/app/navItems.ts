import type { NavItemPref } from "@/types";

/** One page in the main navigation. `id` is the stable key that is saved in
 * `UserSettings.navLayout`; it must never change once shipped (the label and
 * route can). */
export interface NavItem {
  id: string;
  to: string;
  label: string;
  /** Can never be hidden. Only Settings: it is the way back into the list
   * that hides things, and the private journal's entry gesture lives on its
   * link — hiding it would lock the user out of both. */
  locked?: boolean;
  /** Not part of the reorderable list: the Shell draws it separately, as an
   * icon at the bottom of the rail (Settings, as a gear). */
  pinned?: boolean;
}

/** The default order, and the registry of every page that can appear in the
 * nav. Adding a page here is enough: it shows up (visible, at the end) for
 * everyone who already has a saved layout. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", to: "/", label: "Dashboard" },
  { id: "planner", to: "/planner", label: "Planner" },
  { id: "tasks", to: "/tasks", label: "Tasks" },
  { id: "calendar", to: "/calendar", label: "Calendar" },
  { id: "pomodoro", to: "/pomodoro", label: "Pomodoro" },
  { id: "study-analytics", to: "/study-analytics", label: "Study Analytics" },
  { id: "courses", to: "/courses", label: "Courses" },
  { id: "exams", to: "/exams", label: "Exams" },
  { id: "finances", to: "/finances", label: "Finances" },
  { id: "spotify", to: "/spotify", label: "Spotify" },
  { id: "settings", to: "/settings", label: "Settings", locked: true, pinned: true },
];

export interface ResolvedNavItem extends NavItem {
  hidden: boolean;
}

/**
 * Merge the saved layout with the current registry into the full ordered list
 * (hidden items included — Settings needs those to show their toggles).
 *
 *  - saved order wins, for ids that still exist in the registry
 *  - ids that no longer exist are dropped, duplicates keep their first spot
 *  - registry items missing from the saved list (a page added later, or an
 *    empty/default layout) are appended in registry order, visible
 *  - a locked item is always visible, whatever was saved
 */
export function resolveNavLayout(saved: readonly NavItemPref[] | undefined | null): ResolvedNavItem[] {
  const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
  const out: ResolvedNavItem[] = [];
  const placed = new Set<string>();
  for (const pref of saved ?? []) {
    const item = byId.get(pref.id);
    if (!item || placed.has(item.id)) continue;
    placed.add(item.id);
    out.push({ ...item, hidden: item.locked ? false : pref.hidden });
  }
  for (const item of NAV_ITEMS) {
    if (!placed.has(item.id)) out.push({ ...item, hidden: false });
  }
  return out;
}

/** The inverse, for saving: the resolved list back to what gets persisted. */
export function toNavLayout(items: readonly ResolvedNavItem[]): NavItemPref[] {
  return items.map((i) => ({ id: i.id, hidden: i.locked ? false : i.hidden }));
}

/** True when the layout is exactly the default (default order, nothing
 * hidden) — used to disable the "Reset" button when there's nothing to reset. */
export function isDefaultNavLayout(items: readonly ResolvedNavItem[]): boolean {
  return items.length === NAV_ITEMS.length && items.every((it, idx) => it.id === NAV_ITEMS[idx].id && !it.hidden);
}

/** Move the item at `from` to position `to` (both clamped to the list). */
export function moveNavItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return items.slice();
  const target = Math.max(0, Math.min(items.length - 1, to));
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
