import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * A tiny stack of "layers" (the journal overlay, and any modal/drawer/dialog
 * opened on top of it) sharing ONE document-level key handler that only ever
 * talks to the topmost layer. This fixes two real problems in the previous
 * journal:
 *   - Escape was handled by the overlay alone, so pressing it inside the
 *     playback modal closed the entire journal instead of just the modal.
 *   - Nothing kept Tab inside the overlay, so keyboard focus could walk out
 *     to the app's nav rail underneath a full-screen "private" surface.
 *
 * The handler is registered in the capture phase and stops Escape from
 * propagating, so a lower layer (or an unrelated document-level Escape
 * handler elsewhere in the app) can never also react to the same keypress.
 */
interface Layer {
  ref: RefObject<HTMLElement>;
  onEscape: () => void;
}

const layers: Layer[] = [];
let listening = false;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  // getClientRects() (not offsetParent) so position:fixed descendants and
  // display:none ones are both classified correctly.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

function handleKeyDown(e: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top) return;

  if (e.key === "Escape") {
    e.stopPropagation();
    top.onEscape();
    return;
  }
  if (e.key !== "Tab") return;

  const root = top.ref.current;
  if (!root) return;
  const items = focusables(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Registers `ref`'s element as a modal layer while `active`: Escape calls
 * `onEscape` (only if this is the topmost layer), Tab is trapped inside,
 * focus moves in on open (unless something inside already claimed it, e.g.
 * an `autoFocus` input) and returns to whatever was focused before on close.
 * The element should carry `tabIndex={-1}` so it can be focused as a
 * fallback when it has no focusable children.
 */
export function useModalLayer(ref: RefObject<HTMLElement>, onEscape: () => void, active = true) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const layer: Layer = { ref, onEscape: () => escapeRef.current() };
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    layers.push(layer);
    if (!listening) {
      document.addEventListener("keydown", handleKeyDown, true);
      listening = true;
    }

    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      (focusables(root)[0] ?? root).focus();
    }

    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      if (layers.length === 0 && listening) {
        document.removeEventListener("keydown", handleKeyDown, true);
        listening = false;
      }
      previouslyFocused?.focus();
    };
  }, [ref, active]);
}
