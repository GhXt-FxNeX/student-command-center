/**
 * Scrolls a form field into view and focuses it, by element id. Used by empty
 * states whose "next step" is a form already on the same page ("Add a task"
 * focuses the title field). Instant, not smooth: a smooth scroll is motion
 * the person didn't ask for, and focus() alone already brings it into view.
 * `Input` forwards `id` to its <input>, so call sites just set `id`.
 */
export function focusField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.focus();
}
