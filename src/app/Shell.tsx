import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AssetManifest, CompanionState, UserSettings } from "@/types";
import { FloatingCompanion } from "@/features/companion/FloatingCompanion";
import { JournalOverlay } from "@/features/journal/JournalOverlay";
import { NAV_ITEMS, resolveNavLayout } from "./navItems";
import { AppLogo } from "@/components/AppLogo";
import { GearIcon } from "@/components/ui/icons";
import { ProfileAvatar } from "@/features/profile/ProfileAvatar";

const APP_NAME = "Student Command Center";

/** The nav label for the current route ("/settings/ai" -> "Settings"), used
 * for the document title and the main landmark's name. Longest matching
 * prefix wins so "/" (Dashboard) doesn't swallow every other route. */
function labelForPath(pathname: string): string {
  const match = NAV_ITEMS.filter((i) => (i.to === "/" ? pathname === "/" : pathname === i.to || pathname.startsWith(`${i.to}/`))).sort(
    (a, b) => b.to.length - a.to.length
  )[0];
  return match?.label ?? APP_NAME;
}

/** How long the panel stays open after the pointer leaves — long enough
 * that moving from the hamburger toward a nav link doesn't clip the
 * panel shut mid-move, short enough that it doesn't feel sticky
 * (future_enhancement.md §7: "Collapse shortly after pointer leaves"). */
const HOVER_COLLAPSE_DELAY_MS = 350;

/** future_enhancement.md §8's secret journal trigger: three consecutive
 * clicks on Settings within this window opens the password gate instead
 * of navigating. Purely a discovery/obscurity mechanism — never the
 * actual security boundary, which is the password itself (journal/). */
const SECRET_CLICK_WINDOW_MS = 1200;

interface ShellProps {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
  companion: { state: CompanionState | null; manifest: AssetManifest | null; error: string | null };
  children: ReactNode;
}

export function Shell({ settings, companion, children }: ShellProps) {
  // "Pinned" = the hamburger was clicked, so the panel stays open
  // regardless of hover (future_enhancement.md §7: "Clicking hamburger
  // opens/pins the panel"). Not persisted across launches — always
  // starts collapsed, matching the spec's "replace the permanently
  // expanded sidebar with a compact navigation system."
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const settingsClickTimes = useRef<number[]>([]);

  function handleSettingsClick(e: React.MouseEvent) {
    const now = Date.now();
    const recent = settingsClickTimes.current.filter((t) => now - t < SECRET_CLICK_WINDOW_MS);
    recent.push(now);
    settingsClickTimes.current = recent;
    if (recent.length >= 3) {
      e.preventDefault();
      settingsClickTimes.current = [];
      setJournalOpen(true);
    }
  }

  const expanded = pinned || hovering;

  // The user's order, minus the tabs they've hidden (Settings > Appearance >
  // Navigation). Hiding only removes the link — the routes themselves still
  // work, so in-app links (e.g. Exams -> Courses) never dead-end.
  const resolvedNav = useMemo(() => resolveNavLayout(settings.navLayout), [settings.navLayout]);
  const navItems = useMemo(() => resolvedNav.filter((i) => !i.hidden && !i.pinned), [resolvedNav]);
  // Settings is drawn separately, as a gear at the bottom of the rail.
  const settingsItem = resolvedNav.find((i) => i.pinned);

  // Route changes in a single-page app are silent to screen readers and leave
  // keyboard focus on the nav link that was just used. On each navigation
  // (not the first render) update the window title and move focus to <main>,
  // which is named after the page so it is announced ("Tasks, main").
  const { pathname } = useLocation();
  const pageLabel = labelForPath(pathname);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    document.title = pageLabel === APP_NAME ? APP_NAME : `${pageLabel} · ${APP_NAME}`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname, pageLabel]);

  function handleMouseEnter() {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setHovering(true);
  }

  function handleMouseLeave() {
    collapseTimer.current = setTimeout(() => setHovering(false), HOVER_COLLAPSE_DELAY_MS);
  }

  return (
    <div className="flex h-full bg-bg text-text">
      {/* Skip link: first tab stop, visible only when focused. A button, not
          an <a href="#main-content">, because the app uses a HashRouter and
          a hash link would be read as a route change. */}
      <button
        type="button"
        onClick={() => mainRef.current?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-text focus:shadow-lg focus:border focus:border-border"
      >
        Skip to main content
      </button>
      {/* Reserves a fixed 56px of layout space — this element's size
          NEVER changes, so `main` next to it always gets the rest of the
          width via flex-1 with zero ambiguity. The previous
          implementation instead animated *this* element's own width
          between w-14/w-56, which ran into a classic flexbox pitfall:
          flex items default to min-width:auto, so a row of
          whitespace-nowrap nav labels set an intrinsic minimum width
          that fought the shrink back to w-14 even after adding
          min-w-0. Moving the expand/collapse behavior to an
          absolutely-positioned overlay (below) sidesteps that whole
          class of bug — position:absolute content isn't a flex item of
          this row at all, so nothing here can force this rail wider. */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative w-14 shrink-0"
      >
        <div className="absolute inset-0 border-r border-border bg-surface flex flex-col items-center py-5 z-10">
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            aria-expanded={expanded}
            aria-label={pinned ? "Collapse navigation" : "Expand navigation"}
            title={pinned ? "Collapse navigation" : "Pin navigation open"}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg hover:text-text transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 4.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M2 9H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M2 13.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          {settingsItem && (
            <NavLink
              to={settingsItem.to}
              title={settingsItem.label}
              aria-label={settingsItem.label}
              onClick={handleSettingsClick}
              className={({ isActive }) =>
                `mt-auto shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
                  isActive ? "bg-accent-soft text-accent-text" : "text-text-secondary hover:bg-bg hover:text-text"
                }`
              }
            >
              <GearIcon className="w-[18px] h-[18px]" />
            </NavLink>
          )}
        </div>

        {/* The expanding panel. Always w-56 and always in the DOM (so
            focus/tab order and the transition both work), positioned
            off-screen via `transform: translateX(-100%)` when collapsed
            rather than clipped/shrunk — a transform never affects layout
            or interacts with flexbox sizing, so this can't reproduce the
            original bug no matter what the label text looks like. */}
        <div
          className={`absolute top-0 left-0 h-full w-56 border-r border-border bg-surface shadow-xl flex flex-col z-20 transition-transform duration-200 ease-out motion-reduce:transition-none focus-within:translate-x-0 ${
            expanded ? "translate-x-0" : "-translate-x-full pointer-events-none"
          }`}
        >
          <div className="flex items-center px-3 py-4 shrink-0">
            <AppLogo size={40} label="Student Command Center" />
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto overflow-x-hidden px-2 space-y-0.5">
            {navItems.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.to === "/"}
                title={item.label}
                onClick={item.to === "/settings" ? handleSettingsClick : undefined}
                className={({ isActive }) =>
                  `block rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-accent-soft text-accent-text font-medium"
                      : "text-text-secondary hover:bg-bg hover:text-text"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {settingsItem && (
            <div className="shrink-0 border-t border-border px-2 pt-3 pb-5">
              <NavLink
                to={settingsItem.to}
                title={settingsItem.label}
                onClick={handleSettingsClick}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md pr-3 text-sm whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-accent-soft text-accent-text font-medium"
                      : "text-text-secondary hover:bg-bg hover:text-text"
                  }`
                }
              >
                <span className="w-8 h-8 flex items-center justify-center shrink-0">
                  <GearIcon className="w-[18px] h-[18px]" />
                </span>
                {settingsItem.label}
              </NavLink>
            </div>
          )}
        </div>
      </div>

      {/* Everything right of the rail: a slim top bar holding the profile
          icon (top-right corner), then the page. A bar rather than a floating
          avatar so it can never sit on top of a page's own right-aligned
          controls (Calendar, Finances month picker, …). */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-12 shrink-0 flex items-center justify-end px-5">
          <Link
            to="/settings/general"
            aria-label={`Profile${settings.name ? `: ${settings.name}` : ""}. Open profile settings`}
            title={settings.name ? `${settings.name} — profile settings` : "Profile settings"}
            className="rounded-full transition-transform duration-150 hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
          >
            <ProfileAvatar iconId={settings.profileIcon} name={settings.name} size={32} />
          </Link>
        </header>
        <main ref={mainRef} id="main-content" tabIndex={-1} aria-label={pageLabel} className="flex-1 min-h-0 overflow-y-auto outline-none">
          {children}
        </main>
      </div>

      {/* Sibling of the nav rail and `main`, deliberately NOT nested inside
          the nav panel above — see FloatingCompanion.tsx's doc comment for
          why that placement matters (CSS transform containing-block
          gotcha). This is what makes the companion "global-shell": it
          lives outside <Routes>, so switching pages never unmounts or
          resets it (future_enhancement.md §2). */}
      {settings.companionEnabled && (
        <FloatingCompanion
          state={companion.state}
          manifest={companion.manifest}
          error={companion.error}
          sizePx={settings.companionBubbleSizePx}
        />
      )}

      {/* Rendered outside <Routes> and never linked from nav — the whole
          point of future_enhancement.md §8's "must NOT appear in normal
          sidebar navigation" is that there's no URL or nav item pointing
          at it at all, only the triple-click above. */}
      {journalOpen && <JournalOverlay onClose={() => setJournalOpen(false)} />}
    </div>
  );
}
