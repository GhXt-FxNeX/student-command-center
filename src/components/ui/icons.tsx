/**
 * Shared line icons (1.6 stroke, round caps — the same language as the nav,
 * Settings and Journal icons; the app has no icon-library dependency).
 * Every icon here is DECORATIVE by default (`aria-hidden`): put it next to
 * text, or give the surrounding button an `aria-label`. Pass your own
 * `aria-hidden={false}` + `aria-label` in the rare case an icon stands alone.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

/** Down-pointing chevron; rotate with Tailwind (`rotate-90`, `-rotate-90`, `rotate-180`). */
export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7.5 10 13l5.5-5.5" />
    </Svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="14" height="10" rx="2.2" />
      <path d="M3 9.3h14" />
      <circle cx="13.3" cy="12.3" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function ListCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3.5 5.2 1.3 1.3 2.2-2.4M3.5 10.7l1.3 1.3L7 9.6M3.5 16.2h3.5" />
      <path d="M10 5.5h6.5M10 11h6.5M10 16.2h6.5" />
    </Svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 6.5C8.5 5 6 4.5 3.5 4.7v10.3c2.5-.2 5 .3 6.5 1.8 1.5-1.5 4-2 6.5-1.8V4.7C14 4.5 11.5 5 10 6.5Z" />
      <path d="M10 6.5v10.3" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
    </Svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 16V9.5M10 16V4.5M15.5 16v-5.5" />
    </Svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="4" width="11" height="13" rx="2" />
      <path d="M8 4V3h4v1M7.5 9h5M7.5 12.5h5" />
    </Svg>
  );
}

/** Six-dot drag grip, for "grab here to reorder" handles. */
export function GripIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="7.5" cy="5" r="1.4" />
      <circle cx="12.5" cy="5" r="1.4" />
      <circle cx="7.5" cy="10" r="1.4" />
      <circle cx="12.5" cy="10" r="1.4" />
      <circle cx="7.5" cy="15" r="1.4" />
      <circle cx="12.5" cy="15" r="1.4" />
    </svg>
  );
}

/** Settings cog. Eight teeth around a hub, in the same 1.6 line style as the rest. */
export function GearIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
      <circle cx="10" cy="10" r="5.6" />
    </Svg>
  );
}
