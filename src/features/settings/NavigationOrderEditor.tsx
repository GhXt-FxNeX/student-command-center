import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { ChevronIcon, GripIcon } from "@/components/ui/icons";
import { isDefaultNavLayout, moveNavItem, NAV_ITEMS, type ResolvedNavItem } from "@/app/navItems";

type FocusTarget = { id: string; action: "handle" | "up" | "down" };

/**
 * Reorder + show/hide list for the main navigation.
 *
 * Three ways to reorder, so it never depends on one input method working:
 *  - drag the grip with a pointer (pointer events + pointer capture rather
 *    than HTML5 drag-and-drop, which is unreliable inside Tauri webviews);
 *  - focus the grip and press ArrowUp / ArrowDown;
 *  - the up / down buttons.
 *
 * It is controlled: `items` is the full resolved list and `onChange` receives
 * the new one. During a drag the order is kept locally and `onChange` fires
 * once, on release — so one drag is one save, not one per row crossed.
 */
export function NavigationOrderEditor({
  items: allItems,
  onChange: onChangeAll,
}: {
  items: ResolvedNavItem[];
  onChange: (items: ResolvedNavItem[]) => void;
}) {
  // Pinned items (Settings — drawn as the gear at the bottom of the rail) are
  // not part of the list: they can't be reordered or hidden, so the editor only
  // sees the rest, and they are re-attached at the end whenever it saves.
  const items = allItems.filter((i) => !i.pinned);
  const pinned = allItems.filter((i) => i.pinned);
  const onChange = (next: ResolvedNavItem[]) => onChangeAll([...next, ...pinned]);

  // Non-null only while a drag is in flight.
  const [dragOrder, setDragOrder] = useState<ResolvedNavItem[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOrderRef = useRef<ResolvedNavItem[] | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const shown = dragOrder ?? items;
  const visibleCount = shown.filter((i) => !i.hidden).length;

  // Re-ordering moves DOM nodes, which can drop keyboard focus. Put it back on
  // the control that was just used (or its sibling if that one is now disabled
  // because the row reached an end of the list).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const row = rowRefs.current.get(target.id);
    const el =
      row?.querySelector<HTMLElement>(`[data-action="${target.action}"]:not(:disabled)`) ??
      row?.querySelector<HTMLElement>("[data-action]:not(:disabled)");
    el?.focus();
  }, [items]);

  function commitMove(id: string, delta: -1 | 1, action: FocusTarget["action"]) {
    const from = items.findIndex((i) => i.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;
    pendingFocus.current = { id, action };
    onChange(moveNavItem(items, from, to));
    setAnnouncement(`${items[from].label} moved to position ${to + 1} of ${items.length}`);
  }

  function onHandleKeyDown(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      commitMove(id, e.key === "ArrowUp" ? -1 : 1, "handle");
    }
  }

  function onHandlePointerDown(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrderRef.current = items;
    setDragOrder(items);
    setDraggingId(id);
  }

  function onHandlePointerMove(e: PointerEvent<HTMLButtonElement>) {
    const current = dragOrderRef.current;
    if (!current || draggingId === null) return;
    // Swap as soon as the pointer is inside another row. Rows are equal height
    // and the dragged row moves into the slot it swapped with, so the pointer
    // stays inside the dragged row afterwards — no flip-flopping.
    const from = current.findIndex((i) => i.id === draggingId);
    for (let idx = 0; idx < current.length; idx++) {
      if (idx === from) continue;
      const rect = rowRefs.current.get(current[idx].id)?.getBoundingClientRect();
      if (rect && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const next = moveNavItem(current, from, idx);
        dragOrderRef.current = next;
        setDragOrder(next);
        break;
      }
    }
  }

  function endDrag(e: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const result = dragOrderRef.current;
    const id = draggingId;
    dragOrderRef.current = null;
    setDragOrder(null);
    setDraggingId(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (commit && result && id && result.some((r, idx) => r.id !== items[idx].id)) {
      pendingFocus.current = { id, action: "handle" };
      onChange(result);
      const pos = result.findIndex((r) => r.id === id) + 1;
      setAnnouncement(`${result[pos - 1].label} moved to position ${pos} of ${result.length}`);
    }
  }

  function setHidden(id: string, hidden: boolean) {
    const target = items.find((i) => i.id === id);
    onChange(items.map((i) => (i.id === id ? { ...i, hidden } : i)));
    if (target) setAnnouncement(`${target.label} ${hidden ? "hidden from" : "shown in"} navigation`);
  }

  function reset() {
    onChangeAll(NAV_ITEMS.map((i) => ({ ...i, hidden: false })));
    setAnnouncement("Navigation reset to the default order");
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-text-secondary">
          {visibleCount} of {shown.length} tabs shown. Drag the handle, or use the arrow buttons, to reorder.
        </p>
        <Button variant="secondary" size="sm" onClick={reset} disabled={isDefaultNavLayout(allItems)}>
          Reset to default
        </Button>
      </div>

      <ul className="space-y-1.5" aria-label="Navigation tabs">
        {shown.map((item, index) => {
          const dragging = draggingId === item.id;
          return (
            <li
              key={item.id}
              ref={(el) => {
                if (el) rowRefs.current.set(item.id, el);
                else rowRefs.current.delete(item.id);
              }}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                dragging ? "border-accent-text bg-surface shadow-md" : "border-border bg-bg"
              }`}
            >
              <button
                type="button"
                data-action="handle"
                aria-label={`Reorder ${item.label}. Press arrow up or arrow down to move it.`}
                title="Drag to reorder"
                onPointerDown={(e) => onHandlePointerDown(e, item.id)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={(e) => endDrag(e, true)}
                onPointerCancel={(e) => endDrag(e, false)}
                onKeyDown={(e) => onHandleKeyDown(e, item.id)}
                className={`touch-none shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:text-text hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text ${
                  dragging ? "cursor-grabbing" : "cursor-grab"
                }`}
              >
                <GripIcon className="w-4 h-4" />
              </button>

              <span className={`flex-1 min-w-0 truncate text-sm ${item.hidden ? "text-text-secondary" : ""}`}>
                {item.label}
              </span>
              {item.locked && <span className="text-xs text-text-secondary shrink-0">Always shown</span>}
              {item.hidden && <span className="text-xs text-text-secondary shrink-0">Hidden</span>}

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  data-action="up"
                  aria-label={`Move ${item.label} up`}
                  disabled={index === 0 || draggingId !== null}
                  onClick={() => commitMove(item.id, -1, "up")}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronIcon className="w-3 h-3 rotate-180" />
                </button>
                <button
                  type="button"
                  data-action="down"
                  aria-label={`Move ${item.label} down`}
                  disabled={index === shown.length - 1 || draggingId !== null}
                  onClick={() => commitMove(item.id, 1, "down")}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronIcon className="w-3 h-3" />
                </button>
              </div>

              <Toggle
                size="sm"
                checked={!item.hidden}
                disabled={item.locked || draggingId !== null}
                ariaLabel={item.locked ? `${item.label} is always shown` : `Show ${item.label} in navigation`}
                onChange={(show) => setHidden(item.id, !show)}
              />
            </li>
          );
        })}
      </ul>

      {pinned.length > 0 && (
        <p className="mt-3 text-xs text-text-secondary">
          {pinned.map((p) => p.label).join(", ")} is always available from the gear at the bottom of the navigation.
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
